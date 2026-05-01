// QA View 中央列の上半分: spec path / grep / Run ボタン。
// δ (Issue #11) で routes/qa.tsx 内の inline 定義を `apps/web/src/features/run-controls/` へ抽出した。
// ε (Issue #12) の Developer View からも同一コンポーネントを mount できる構造を意図している。
//
// silent failure ガード:
//  - mutation.error は React Query が保持し、UI banner で表示 (formatMutationError 経由)
//  - mutation 自体は useStartRunMutation 内で console.error 済 (defense-in-depth)
//  - 入力編集で前回 error を reset し、stale error の固着を避ける
import * as React from "react";
import { Clipboard, Code2, FileArchive, Play } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import type {
  CommandTemplate,
  PlaywrightLaunchCommandRequest,
  PlaywrightLaunchCommandResponse,
  PlaywrightLaunchKind,
  ProjectSummary,
  RunRequest
} from "@pwqa/shared";

import { createPlaywrightLaunchCommand } from "@/api/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useStartRunMutation } from "@/hooks/use-start-run-mutation";
import { formatMutationError } from "@/lib/mutation-error";

interface RunControlsProps {
  /** 現在開いているプロジェクト。null の間は controls を disabled 表示にする。 */
  project: ProjectSummary | null;
}

type QualityGateProfile = "local-review" | "release-smoke" | "full-regression";

const QUALITY_GATE_PROFILE_OPTIONS: ReadonlyArray<{
  value: QualityGateProfile;
  label: string;
  hint: string;
}> = [
  {
    value: "local-review",
    label: "local-review",
    hint: "lenient (CLI defaults; ad-hoc dev)",
  },
  {
    value: "release-smoke",
    label: "release-smoke",
    hint: "zero failures, 100% pass, fast-fail",
  },
  {
    value: "full-regression",
    label: "full-regression",
    hint: "≥95% pass, fail-soft",
  },
];

export function RunControls({ project }: RunControlsProps): React.ReactElement {
  const [specPath, setSpecPath] = React.useState("");
  const [grep, setGrep] = React.useState("");
  const [projectNames, setProjectNames] = React.useState("");
  const [headed, setHeaded] = React.useState(false);
  const [retries, setRetries] = React.useState("");
  const [workers, setWorkers] = React.useState("");
  const [qualityGateProfile, setQualityGateProfile] =
    React.useState<QualityGateProfile>("local-review");

  // useStartRunMutation は呼び出し毎に独立した React Query mutation instance を作る (別の error /
  // pending state を持つ)。__root の rerun mutation と本コンポーネントの form submit mutation が
  // 別 banner に流れるよう、ここで独立 instance を取得する。
  const startMutation = useStartRunMutation();

  const errorMessage = startMutation.error
    ? formatMutationError(startMutation.error, "Failed to start run")
    : null;

  // 入力編集で前回 error を解除する (dismiss UX dead-end 回避)。
  function clearErrorOnEdit(): void {
    if (startMutation.error) {
      startMutation.reset();
    }
  }

  if (!project) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Run controls</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[var(--ink-3)]">プロジェクトを開くと実行できます。</p>
        </CardContent>
      </Card>
    );
  }

  const blocked = project.blockingExecution;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    // 上の `if (!project) return <Card>...` 分岐で project は実行時には non-null。
    // しかし TypeScript は handleSubmit closure に対して narrow を保てないため、
    // 明示的に invariant ガードを置く。null 到達は invariant 違反なので silent return せず log する。
    if (project === null) {
      // eslint-disable-next-line no-console -- 到達不能経路を本番でも検知
      console.error("[RunControls] handleSubmit reached with project=null (invariant violation)");
      return;
    }
    const request: RunRequest = {
      projectId: project.id,
      specPath: specPath.trim() || undefined,
      grep: grep.trim() || undefined,
      projectNames: parseProjectNames(projectNames),
      headed,
      retries: parseOptionalInteger(retries),
      workers: parseOptionalInteger(workers),
      // Only include the profile when it deviates from the agent default
      // ("local-review"). Sending the default explicitly is harmless but the
      // field is conceptually "override default", so omitting it keeps the
      // request shape minimal in the common case.
      qualityGateProfile:
        qualityGateProfile === "local-review" ? undefined : qualityGateProfile
    };
    startMutation.mutate(request);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Run controls</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="spec-path">Spec path (relative; optional)</Label>
            <Input
              id="spec-path"
              placeholder="tests/auth.spec.ts"
              value={specPath}
              onChange={(event) => {
                setSpecPath(event.target.value);
                clearErrorOnEdit();
              }}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="grep">Grep pattern (optional)</Label>
            <Input
              id="grep"
              placeholder="@smoke"
              value={grep}
              onChange={(event) => {
                setGrep(event.target.value);
                clearErrorOnEdit();
              }}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-names">Project names (comma-separated; optional)</Label>
            <Input
              id="project-names"
              placeholder="chromium, webkit"
              value={projectNames}
              onChange={(event) => {
                setProjectNames(event.target.value);
                clearErrorOnEdit();
              }}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="retries">Retries</Label>
              <Input
                id="retries"
                type="number"
                min={0}
                step={1}
                placeholder="default"
                value={retries}
                onChange={(event) => {
                  setRetries(event.target.value);
                  clearErrorOnEdit();
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="workers">Workers</Label>
              <Input
                id="workers"
                type="number"
                min={1}
                step={1}
                placeholder="default"
                value={workers}
                onChange={(event) => {
                  setWorkers(event.target.value);
                  clearErrorOnEdit();
                }}
              />
            </div>
            <label
              htmlFor="headed"
              className="flex h-9 items-center gap-2 self-end rounded-md border border-[var(--line-strong)] bg-[var(--bg-elev)] px-3 text-sm text-[var(--ink-1)]"
            >
              <input
                id="headed"
                type="checkbox"
                checked={headed}
                onChange={(event) => {
                  setHeaded(event.target.checked);
                  clearErrorOnEdit();
                }}
              />
              Headed
            </label>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="quality-gate-profile">Quality Gate profile</Label>
            <select
              id="quality-gate-profile"
              data-testid="run-controls-quality-gate-profile"
              className="h-9 rounded border border-[var(--border-1)] bg-[var(--surface-1)] px-2 text-sm text-[var(--ink-1)] focus-visible:border-[var(--accent-1)] focus-visible:outline-none"
              value={qualityGateProfile}
              onChange={(event) => {
                setQualityGateProfile(event.target.value as QualityGateProfile);
                clearErrorOnEdit();
              }}
            >
              {QUALITY_GATE_PROFILE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} — {option.hint}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end pt-1">
            <Button type="submit" disabled={blocked || startMutation.isPending}>
              {startMutation.isPending ? "Starting…" : "Run Playwright"}
            </Button>
          </div>
        </form>
        {blocked ? (
          <Alert variant="warning" className="mt-3">
            <AlertTitle>実行ブロック中</AlertTitle>
            <AlertDescription>
              Package manager の状態がユーザー解決を要求しています。
            </AlertDescription>
          </Alert>
        ) : null}
        {errorMessage ? (
          <Alert variant="destructive" className="mt-3">
            <AlertTitle>起動失敗</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}
        <PlaywrightLaunchCommands project={project} blocked={blocked} />
      </CardContent>
    </Card>
  );
}

function PlaywrightLaunchCommands({
  project,
  blocked
}: {
  project: ProjectSummary;
  blocked: boolean;
}): React.ReactElement {
  const [codegenUrl, setCodegenUrl] = React.useState("");
  const [tracePath, setTracePath] = React.useState("");
  const [validationError, setValidationError] = React.useState<string | null>(null);
  const [copyState, setCopyState] = React.useState<"idle" | "copied" | "failed">("idle");
  const launchMutation = useMutation({
    mutationFn: (request: PlaywrightLaunchCommandRequest) =>
      createPlaywrightLaunchCommand(project.id, request)
  });

  const commandText = launchMutation.data ? formatCommand(launchMutation.data.command) : null;
  const errorMessage = launchMutation.error
    ? formatMutationError(launchMutation.error, "Failed to build launch command")
    : null;

  function resetFeedback(): void {
    setValidationError(null);
    setCopyState("idle");
    launchMutation.reset();
  }

  function build(kind: PlaywrightLaunchKind): void {
    resetFeedback();
    if (kind === "trace-viewer" && tracePath.trim() === "") {
      setValidationError("Trace Viewer requires a project-relative .zip path.");
      return;
    }
    const request: PlaywrightLaunchCommandRequest =
      kind === "codegen"
        ? { kind, codegenUrl: codegenUrl.trim() || undefined }
        : kind === "trace-viewer"
          ? { kind, tracePath: tracePath.trim() }
          : { kind };
    launchMutation.mutate(request);
  }

  async function copyCommand(): Promise<void> {
    if (!commandText) return;
    if (!navigator.clipboard?.writeText) {
      setCopyState("failed");
      return;
    }
    try {
      await navigator.clipboard.writeText(commandText);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <section className="mt-5 border-t border-[var(--line)] pt-4" aria-label="Playwright launch commands">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-[var(--ink-0)]">Playwright launch commands</h3>
          {launchMutation.data ? (
            <span className="text-xs text-[var(--ink-3)]">{launchKindLabel(launchMutation.data.kind)}</span>
          ) : null}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="codegen-url">Codegen URL (optional)</Label>
            <Input
              id="codegen-url"
              placeholder="https://example.com"
              value={codegenUrl}
              onChange={(event) => {
                setCodegenUrl(event.target.value);
                resetFeedback();
              }}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="trace-path">Trace zip path</Label>
            <Input
              id="trace-path"
              placeholder=".playwright-workbench/runs/run-1/trace.zip"
              value={tracePath}
              onChange={(event) => {
                setTracePath(event.target.value);
                resetFeedback();
              }}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={blocked || launchMutation.isPending}
            title="Build UI Mode command"
            onClick={() => build("ui-mode")}
          >
            <Play aria-hidden="true" />
            UI Mode
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={blocked || launchMutation.isPending}
            title="Build Codegen command"
            onClick={() => build("codegen")}
          >
            <Code2 aria-hidden="true" />
            Codegen
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={blocked || launchMutation.isPending}
            title="Build Trace Viewer command"
            onClick={() => build("trace-viewer")}
          >
            <FileArchive aria-hidden="true" />
            Trace Viewer
          </Button>
        </div>
        {validationError ? (
          <Alert variant="warning">
            <AlertTitle>入力確認</AlertTitle>
            <AlertDescription>{validationError}</AlertDescription>
          </Alert>
        ) : null}
        {errorMessage ? (
          <Alert variant="destructive">
            <AlertTitle>コマンド生成失敗</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}
        {commandText ? (
          <div className="flex flex-col gap-2 rounded-md border border-[var(--line-strong)] bg-[var(--bg-1)] p-3">
            <code
              data-testid="playwright-launch-command"
              className="break-all font-mono text-xs text-[var(--ink-0)]"
            >
              {commandText}
            </code>
            <div className="flex items-center justify-end gap-2">
              {copyState === "copied" ? (
                <span className="text-xs text-[var(--pass)]">Copied</span>
              ) : null}
              {copyState === "failed" ? (
                <span className="text-xs text-[var(--fail)]">Copy failed</span>
              ) : null}
              <Button type="button" variant="ghost" size="sm" onClick={() => void copyCommand()}>
                <Clipboard aria-hidden="true" />
                Copy
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function launchKindLabel(kind: PlaywrightLaunchCommandResponse["kind"]): string {
  switch (kind) {
    case "ui-mode":
      return "UI Mode";
    case "codegen":
      return "Codegen";
    case "trace-viewer":
      return "Trace Viewer";
  }
}

function formatCommand(command: CommandTemplate): string {
  return [command.executable, ...command.args].map(shellQuote).join(" ");
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function parseProjectNames(value: string): string[] | undefined {
  const names = value
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return names.length > 0 ? names : undefined;
}

function parseOptionalInteger(value: string): number | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : Number(trimmed);
}
