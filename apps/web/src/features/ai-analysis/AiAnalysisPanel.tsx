import * as React from "react";
import { useEffect } from "react";
import { AlertTriangle, Bot, FileDiff, Sparkles } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import type { AiAnalysisOutput } from "@pwqa/shared";

import { runAiAnalysis } from "@/api/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMutationError } from "@/lib/mutation-error";

interface AiAnalysisPanelProps {
  runId: string | null;
}

export function AiAnalysisPanel({ runId }: AiAnalysisPanelProps): React.ReactElement {
  const analysisMutation = useMutation({
    mutationFn: () => {
      if (typeof runId !== "string" || runId.length === 0) {
        // eslint-disable-next-line no-console -- invariant 違反を本番でも検知
        console.error("[AiAnalysisPanel] mutation called with invalid runId");
        throw new Error("AiAnalysisPanel: runId が不正なまま mutation が呼ばれた");
      }
      return runAiAnalysis(runId);
    }
  });

  useEffect(() => {
    if (analysisMutation.status === "error" && analysisMutation.error) {
      // eslint-disable-next-line no-console -- AI CLI/API 失敗を本番でも痕跡に残す
      console.error("[AiAnalysisPanel] runAiAnalysis failed", analysisMutation.error);
    }
  }, [analysisMutation.status, analysisMutation.error]);

  const analysis = analysisMutation.data?.analysis;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3">
          <span className="inline-flex min-w-0 items-center gap-2">
            <Bot className="size-4 text-[var(--accent)]" aria-hidden="true" />
            <span>AI analysis</span>
          </span>
          {analysis ? <ClassificationBadge analysis={analysis} /> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {runId === null ? (
          <p className="text-sm text-[var(--ink-3)]">
            Run を開始すると AI analysis を実行できます。
          </p>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => analysisMutation.mutate()}
            disabled={analysisMutation.isPending}
          >
            <Sparkles aria-hidden="true" />
            {analysisMutation.isPending ? "Analyzing…" : "Analyze failure"}
          </Button>
        )}

        {analysisMutation.error ? (
          <Alert variant="destructive">
            <AlertTitle>AI analysis failed</AlertTitle>
            <AlertDescription>
              {formatMutationError(analysisMutation.error, "AI analysis を実行できませんでした")}
            </AlertDescription>
          </Alert>
        ) : null}

        {analysis ? <AnalysisResult analysis={analysis} /> : null}
      </CardContent>
    </Card>
  );
}

function ClassificationBadge({ analysis }: { analysis: AiAnalysisOutput }): React.ReactElement {
  const variant = analysis.classification === "product-bug" ? "fail" : "info";
  return <Badge variant={variant}>{analysis.classification}</Badge>;
}

function AnalysisResult({ analysis }: { analysis: AiAnalysisOutput }): React.ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <section className="rounded-sm border border-[var(--line-faint)] bg-[var(--bg-1)] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={analysis.requiresHumanDecision ? "flaky" : "pass"}>
            {analysis.requiresHumanDecision ? "human decision" : "review ready"}
          </Badge>
          <span className="font-mono text-[11.5px] text-[var(--ink-3)]">
            confidence {(analysis.confidence * 100).toFixed(0)}%
          </span>
        </div>
        <p className="m-0 mt-2 break-words text-sm font-medium text-[var(--ink-0)]">
          {analysis.rootCause}
        </p>
      </section>

      <ListSection title="Evidence" items={analysis.evidence} />
      <ListSection title="Risk" items={analysis.risk} />
      <ListSection title="Files touched" items={analysis.filesTouched} monospace />

      {analysis.rerunCommand ? (
        <section className="rounded-sm border border-[var(--line-faint)] bg-[var(--bg-0)] p-3">
          <h4 className="m-0 mb-2 text-[11px] font-semibold uppercase text-[var(--ink-3)]">
            Rerun
          </h4>
          <code className="break-all font-mono text-[11.5px] text-[var(--ink-1)]">
            {analysis.rerunCommand}
          </code>
        </section>
      ) : null}

      {analysis.proposedPatch ? (
        <section className="rounded-sm border border-[var(--line-faint)] bg-[var(--bg-0)] p-3">
          <h4 className="m-0 mb-2 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase text-[var(--ink-3)]">
            <FileDiff className="size-3.5" aria-hidden="true" />
            Proposed patch
          </h4>
          <pre className="m-0 max-h-[28vh] overflow-auto whitespace-pre-wrap break-words rounded-sm bg-[var(--bg-2)] p-2 font-mono text-[11.5px] text-[var(--ink-1)]">
            {analysis.proposedPatch}
          </pre>
        </section>
      ) : (
        <div className="flex items-center gap-2 text-xs text-[var(--ink-3)]">
          <AlertTriangle className="size-3.5" aria-hidden="true" />
          Patch proposal is not included.
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
