import * as React from "react";
import { useEffect, useState } from "react";
import { AlertTriangle, FileCode2, Sparkles } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import type {
  AiTestGenerationMode,
  AiTestGenerationResponse
} from "@pwqa/shared";

import { runAiTestGeneration } from "@/api/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RepairReviewPanel } from "@/features/repair-review/RepairReviewPanel";
import { formatMutationError } from "@/lib/mutation-error";

interface AiTestGenerationPanelProps {
  runId: string | null;
}

const MODE_OPTIONS: ReadonlyArray<{ value: AiTestGenerationMode; label: string }> = [
  { value: "planner", label: "planner" },
  { value: "generator", label: "generator" },
  { value: "healer", label: "healer" }
];

const DEFAULT_OBJECTIVE = "Generate Playwright regression coverage from this run.";

export function AiTestGenerationPanel({ runId }: AiTestGenerationPanelProps): React.ReactElement {
  const [mode, setMode] = useState<AiTestGenerationMode>("generator");
  const [objective, setObjective] = useState(DEFAULT_OBJECTIVE);
  const [targetFiles, setTargetFiles] = useState("");

  const generationMutation = useMutation({
    mutationFn: () => {
      if (typeof runId !== "string" || runId.length === 0) {
        // eslint-disable-next-line no-console -- invariant 違反を本番でも検知
        console.error("[AiTestGenerationPanel] mutation called with invalid runId");
        throw new Error("AiTestGenerationPanel: runId が不正なまま mutation が呼ばれた");
      }
      return runAiTestGeneration(runId, {
        mode,
        objective: objective.trim(),
        targetFiles: parseTargetFiles(targetFiles)
      });
    }
  });

  useEffect(() => {
    generationMutation.reset();
  }, [runId]);

  useEffect(() => {
    if (generationMutation.status === "error" && generationMutation.error) {
      // eslint-disable-next-line no-console -- AI CLI/API 失敗を本番でも痕跡に残す
      console.error("[AiTestGenerationPanel] runAiTestGeneration failed", generationMutation.error);
    }
  }, [generationMutation.status, generationMutation.error]);

  const response = generationMutation.data;
  const canGenerate = runId !== null && objective.trim().length > 0 && !generationMutation.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3">
          <span className="inline-flex min-w-0 items-center gap-2">
            <FileCode2 className="size-4 text-[var(--accent)]" aria-hidden="true" />
            <span>AI test generation</span>
          </span>
          {response ? <ModeBadge response={response} /> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {runId === null ? (
          <p className="text-sm text-[var(--ink-3)]">
            Run を開始すると AI test generation を実行できます。
          </p>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              generationMutation.mutate();
            }}
          >
            <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ai-test-generation-mode">Mode</Label>
                <select
                  id="ai-test-generation-mode"
                  className="h-9 rounded border border-[var(--border-1)] bg-[var(--surface-1)] px-2 text-sm text-[var(--ink-1)] focus-visible:border-[var(--accent-1)] focus-visible:outline-none"
                  value={mode}
                  onChange={(event) => setMode(event.target.value as AiTestGenerationMode)}
                >
                  {MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ai-test-generation-target-files">Target files</Label>
                <Input
                  id="ai-test-generation-target-files"
                  placeholder="tests/generated.spec.ts"
                  value={targetFiles}
                  onChange={(event) => setTargetFiles(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ai-test-generation-objective">Objective</Label>
              <Input
                id="ai-test-generation-objective"
                value={objective}
                onChange={(event) => setObjective(event.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <Button
              type="submit"
              variant="outline"
              size="sm"
              className="w-fit"
              disabled={!canGenerate}
            >
              <Sparkles aria-hidden="true" />
              {generationMutation.isPending ? "Generating…" : "Generate tests"}
            </Button>
          </form>
        )}

        {generationMutation.error ? (
          <Alert variant="destructive">
            <AlertTitle>AI test generation failed</AlertTitle>
            <AlertDescription>
              {formatMutationError(
                generationMutation.error,
                "AI test generation を実行できませんでした"
              )}
            </AlertDescription>
          </Alert>
        ) : null}

        {response ? <GenerationResult response={response} runId={runId} /> : null}
      </CardContent>
    </Card>
  );
}

function ModeBadge({ response }: { response: AiTestGenerationResponse }): React.ReactElement {
  return <Badge variant={response.result.requiresHumanDecision ? "flaky" : "info"}>{response.mode}</Badge>;
}

function GenerationResult({
  response,
  runId
}: {
  response: AiTestGenerationResponse;
  runId: string | null;
}): React.ReactElement {
  const { result } = response;
  return (
    <div className="flex flex-col gap-3">
      <section className="rounded-sm border border-[var(--line-faint)] bg-[var(--bg-1)] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={result.requiresHumanDecision ? "flaky" : "pass"}>
            {result.requiresHumanDecision ? "human decision" : "review ready"}
          </Badge>
          <span className="font-mono text-[11.5px] text-[var(--ink-3)]">
            confidence {(result.confidence * 100).toFixed(0)}%
          </span>
        </div>
      </section>

      <ListSection title="Plan" items={result.plan} />
      <ListSection title="Evidence" items={result.evidence} />
      <ListSection title="Risk" items={result.risk} />
      <ListSection title="Files touched" items={result.filesTouched} monospace />

      {result.proposedPatch ? (
        <RepairReviewPanel
          runId={runId ?? response.runId}
          projectId={response.projectId}
          patch={result.proposedPatch}
        />
      ) : (
        <div className="flex items-center gap-2 text-xs text-[var(--ink-3)]">
          <AlertTriangle className="size-3.5" aria-hidden="true" />
          Generated diff is not included.
        </div>
      )}
    </div>
  );
}

function ListSection({
  title,
  items,
  monospace = false
}: {
  title: string;
  items: string[];
  monospace?: boolean;
}): React.ReactElement {
  return (
    <section className="rounded-sm border border-[var(--line-faint)] bg-[var(--bg-0)] p-3">
      <h4 className="m-0 mb-2 text-[11px] font-semibold uppercase text-[var(--ink-3)]">
        {title}
      </h4>
      {items.length > 0 ? (
        <ul className="m-0 flex list-disc flex-col gap-1 pl-4 text-xs text-[var(--ink-1)]">
          {items.map((item, index) => (
            <li
              key={`${title}-${index}-${item}`}
              className={monospace ? "break-all font-mono text-[11.5px]" : "break-words"}
            >
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-xs text-[var(--ink-3)]">None</p>
      )}
    </section>
  );
}

function parseTargetFiles(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
