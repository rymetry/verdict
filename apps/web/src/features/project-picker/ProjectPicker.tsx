// プロジェクトを開くフォーム + 開いたプロジェクトの要約 (PM / Status / Errors / Warnings) を出すパネル。
// δ (Issue #11) で Tailwind + shadcn primitives へ移植した。設計トークンは
// `docs/design/concept-b-refined.html` の QA View カラム header / chips パターンを踏襲している。
import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ProjectSummary } from "@pwqa/shared";

import { openProject, WorkbenchApiError } from "@/api/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCurrentProjectQuery } from "@/hooks/use-current-project-query";
import { formatMutationError } from "@/lib/mutation-error";

export function ProjectPicker(): React.ReactElement {
  const queryClient = useQueryClient();
  const [path, setPath] = React.useState("");

  // 「現在開いているプロジェクト」は __root.tsx 含め複数箇所が読むため共通フック経由で取得する。
  const currentQuery = useCurrentProjectQuery();

  const openMutation = useMutation({
    mutationFn: (rootPath: string) => openProject(rootPath),
    onSuccess: (summary) => {
      // 現在のプロジェクト query を mutate 経由で同期する (refetch を待たずに UI 反映)。
      queryClient.setQueryData(["projects", "current"], summary);
    },
    onError: (error) => {
      // caller (UI) は openMutation.error を formatMutationError で表示する契約。
      // 同 silent failure 防衛として hook 側でも本番 console.error する (vite.config.ts の console drop 防衛と組合せ)。
      // eslint-disable-next-line no-console -- 本番でも痕跡を残す
      console.error("[ProjectPicker] openProject failed", error);
    }
  });

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = path.trim();
    if (trimmed.length === 0) return;
    openMutation.mutate(trimmed);
  }

  // 入力編集で前回 error を解除し、UI に「直前の失敗」が固着するのを避ける。
  function clearErrorOnEdit(): void {
    if (openMutation.error !== null) {
      openMutation.reset();
    }
  }

  const project = currentQuery.data ?? null;
  const errorMessage = openMutation.error
    ? formatMutationError(openMutation.error, "プロジェクトを開けませんでした")
    : null;

  // WorkbenchApiError は `code: message` で alert title に code を出す方が原因分類が早い。
  // formatMutationError と二重表示を避けるため、ここでは AlertTitle を「エラー」に固定して
  // formatMutationError 結果を AlertDescription に流す方針。
  const errorIsApi = openMutation.error instanceof WorkbenchApiError;

  return (
    <Card>
      <CardHeader>
        <CardTitle>プロジェクト</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form className="flex flex-col gap-2" onSubmit={handleSubmit}>
          <Label htmlFor="project-root">Absolute path to a Playwright project</Label>
          <div className="flex gap-2">
            <Input
              id="project-root"
              placeholder="/path/to/playwright-project"
              value={path}
              onChange={(event) => {
                setPath(event.target.value);
                clearErrorOnEdit();
              }}
              autoComplete="off"
              spellCheck={false}
            />
            <Button type="submit" disabled={openMutation.isPending}>
              {openMutation.isPending ? "Opening…" : "Open"}
            </Button>
          </div>
        </form>

        {project ? (
          <ProjectFacts summary={project} />
        ) : (
          <p className="text-sm text-[var(--ink-3)]">
            プロジェクト未オープン。上のフォームに root パスを入力してください。
          </p>
        )}

        {errorMessage ? (
          <Alert variant="destructive">
            <AlertTitle>{errorIsApi ? "API エラー" : "エラー"}</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}

interface ProjectFactsProps {
  summary: ProjectSummary;
}

/** 開いたプロジェクトの要約。Root / PackageManager / Status / Errors / Warnings を縦並びで出す。 */
function ProjectFacts({ summary }: ProjectFactsProps): React.ReactElement {
  return (
    <dl className="flex flex-col gap-3 text-sm">
      <Fact label="Root">
        <span className="font-mono text-xs break-all text-[var(--ink-1)]">{summary.rootPath}</span>
      </Fact>
      <Fact label="Package manager">
        <span className="font-medium text-[var(--ink-0)]">{summary.packageManager.name}</span>
        <span className="ml-2 text-xs text-[var(--ink-3)]">
          ({summary.packageManager.confidence})
        </span>
      </Fact>
      <Fact label="Status">
        {summary.blockingExecution ? (
          <Badge variant="fail">Blocked</Badge>
        ) : (
          <Badge variant="pass">Ready</Badge>
        )}
      </Fact>
      {summary.packageManager.errors.length > 0 ? (
        <Fact label="Errors">
          <ul className="m-0 list-disc pl-4 text-[var(--fail)]">
            {summary.packageManager.errors.map((err) => (
              <li key={err}>{err}</li>
            ))}
          </ul>
        </Fact>
      ) : null}
      {summary.packageManager.warnings.length > 0 ? (
        <Fact label="Warnings">
          <ul className="m-0 list-disc pl-4 text-[var(--flaky)]">
            {summary.packageManager.warnings.map((warn) => (
              <li key={warn}>{warn}</li>
            ))}
          </ul>
        </Fact>
      ) : null}
    </dl>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex flex-col gap-1 border-b border-[var(--line-faint)] pb-2 last:border-b-0 last:pb-0">
      <dt className="text-[10px] font-bold uppercase tracking-wider text-[var(--ink-3)]">
        {label}
      </dt>
      <dd className="m-0 text-[var(--ink-0)]">{children}</dd>
    </div>
  );
}
