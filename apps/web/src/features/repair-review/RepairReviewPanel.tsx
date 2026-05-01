import * as React from "react";
import { useEffect, useState } from "react";
import {
  CheckCircle2,
  FileDiff,
  GitCompareArrows,
  Play,
  RotateCcw,
  SearchCheck,
  XCircle
} from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import type {
  PatchApplyResponse,
  PatchCheckResponse,
  PatchRevertResponse,
  RepairComparison,
  RepairRerunResponse
} from "@pwqa/shared";

import {
  applyPatchTemporary,
  checkPatch,
  fetchRepairComparison,
  revertPatchTemporary,
  startRepairRerun
} from "@/api/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMutationError } from "@/lib/mutation-error";

type ReviewState =
  | "draft"
  | "checked"
  | "applied"
  | "rerun-started"
  | "comparison-ready"
  | "approved"
  | "rejected";

interface RepairReviewPanelProps {
  runId: string;
  projectId: string;
  patch: string;
}

export function RepairReviewPanel({
  runId,
  projectId,
  patch
}: RepairReviewPanelProps): React.ReactElement {
  const [reviewState, setReviewState] = useState<ReviewState>("draft");
  const [checkResult, setCheckResult] = useState<PatchCheckResponse | null>(null);
  const [applyResult, setApplyResult] = useState<PatchApplyResponse | null>(null);
  const [revertResult, setRevertResult] = useState<PatchRevertResponse | null>(null);
  const [rerun, setRerun] = useState<RepairRerunResponse | null>(null);
  const [comparison, setComparison] = useState<RepairComparison | null>(null);
  const [comparisonPending, setComparisonPending] = useState(false);

  useEffect(() => {
    setReviewState("draft");
    setCheckResult(null);
    setApplyResult(null);
    setRevertResult(null);
    setRerun(null);
    setComparison(null);
    setComparisonPending(false);
  }, [runId, projectId, patch]);

  const checkMutation = useMutation({
    mutationFn: () => checkPatch(projectId, patch),
    onSuccess: (result) => {
      setCheckResult(result);
      setReviewState(result.ok ? "checked" : "draft");
    }
  });

  const applyMutation = useMutation({
    mutationFn: () => applyPatchTemporary(projectId, patch),
    onSuccess: (result) => {
      setApplyResult(result);
      if (result.applied) setReviewState("applied");
    }
  });

  const rerunMutation = useMutation({
    mutationFn: () => startRepairRerun(runId),
    onSuccess: (result) => {
      setRerun(result);
      setComparison(null);
      setComparisonPending(false);
      setReviewState("rerun-started");
    }
  });

  const comparisonMutation = useMutation({
    mutationFn: () => {
      if (!rerun) throw new Error("Repair rerun has not started.");
      return fetchRepairComparison(runId, rerun.rerunId);
    },
    onSuccess: (result) => {
      setComparisonPending(result === null);
      if (result) {
        setComparison(result);
        setReviewState("comparison-ready");
      }
    }
  });

  const revertMutation = useMutation({
    mutationFn: () => revertPatchTemporary(projectId, patch),
    onSuccess: (result) => {
      setRevertResult(result);
      if (result.reverted) setReviewState("rejected");
    }
  });

  const currentError =
    checkMutation.error ??
    applyMutation.error ??
    rerunMutation.error ??
    comparisonMutation.error ??
    revertMutation.error;

  const reviewTerminal = reviewState === "approved" || reviewState === "rejected";
  const applied = applyResult?.applied === true && reviewState !== "rejected";
  const canApply = checkResult?.ok === true && !applied;
  const canRerun = applied && !rerunMutation.isPending;
  const canLoadComparison = rerun !== null && !reviewTerminal;
  const canApprove = comparison !== null && !reviewTerminal;
  const canReject = applyResult?.applied === true && !reviewTerminal;

  return (
    <section className="rounded-sm border border-[var(--line-faint)] bg-[var(--bg-0)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="m-0 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase text-[var(--ink-3)]">
          <FileDiff className="size-3.5" aria-hidden="true" />
          Proposed patch
        </h4>
        <Badge variant={badgeVariantFor(reviewState)}>{labelFor(reviewState)}</Badge>
      </div>

      <DiffPreview patch={patch} />

      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => checkMutation.mutate()}
          disabled={checkMutation.isPending}
        >
          <SearchCheck aria-hidden="true" />
          {checkMutation.isPending ? "Checking…" : "Check"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => applyMutation.mutate()}
          disabled={!canApply || applyMutation.isPending}
        >
          <CheckCircle2 aria-hidden="true" />
          {applyMutation.isPending ? "Applying…" : "Apply temp"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => rerunMutation.mutate()}
          disabled={!canRerun || rerunMutation.isPending}
        >
          <Play aria-hidden="true" />
          {rerunMutation.isPending ? "Starting…" : "Rerun"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => comparisonMutation.mutate()}
          disabled={!canLoadComparison || comparisonMutation.isPending}
        >
          <GitCompareArrows aria-hidden="true" />
          {comparisonMutation.isPending ? "Loading…" : "Compare"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setReviewState("approved")}
          disabled={!canApprove}
        >
          <CheckCircle2 aria-hidden="true" />
          Mark approved
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => revertMutation.mutate()}
          disabled={!canReject || revertMutation.isPending}
        >
          <RotateCcw aria-hidden="true" />
          {revertMutation.isPending ? "Reverting…" : "Reject"}
        </Button>
      </div>

      <ReviewFeedback
        checkResult={checkResult}
        applyResult={applyResult}
        revertResult={revertResult}
        rerun={rerun}
        comparison={comparison}
        comparisonPending={comparisonPending}
      />

      {currentError ? (
        <Alert variant="destructive" className="mt-3">
          <AlertTitle>Repair review failed</AlertTitle>
          <AlertDescription>
            {formatMutationError(currentError, "Repair review を実行できませんでした")}
          </AlertDescription>
        </Alert>
      ) : null}

      {reviewState === "approved" ? (
        <div className="mt-3 inline-flex items-center gap-2 text-xs font-medium text-[var(--pass)]">
          <CheckCircle2 className="size-3.5" aria-hidden="true" />
          Approved for the next review step.
        </div>
      ) : null}
      {reviewState === "rejected" ? (
        <div className="mt-3 inline-flex items-center gap-2 text-xs font-medium text-[var(--fail)]">
          <XCircle className="size-3.5" aria-hidden="true" />
          Rejected and temporary patch reverted.
        </div>
      ) : null}
    </section>
  );
}

function DiffPreview({ patch }: { patch: string }): React.ReactElement {
  const lines = patch.split(/\r?\n/);
  return (
    <pre className="mt-3 max-h-[30vh] overflow-auto rounded-sm bg-[var(--bg-2)] p-2 font-mono text-[11.5px] leading-5 text-[var(--ink-1)]">
      {lines.map((line, index) => (
        <span
          key={`${index}-${line}`}
          className={diffLineClass(line)}
        >
          {line.length > 0 ? line : " "}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

function ReviewFeedback({
  checkResult,
  applyResult,
  revertResult,
  rerun,
  comparison,
  comparisonPending
}: {
  checkResult: PatchCheckResponse | null;
  applyResult: PatchApplyResponse | null;
  revertResult: PatchRevertResponse | null;
  rerun: RepairRerunResponse | null;
  comparison: RepairComparison | null;
  comparisonPending: boolean;
}): React.ReactElement {
  return (
    <div className="mt-3 flex flex-col gap-2 text-xs text-[var(--ink-2)]">
      {checkResult ? (
        <StatusLine
          label={checkResult.ok ? "Patch check passed" : "Patch check blocked"}
          detail={
            checkResult.ok
              ? `${checkResult.filesTouched.length} files touched`
              : checkResult.diagnostics
          }
          variant={checkResult.ok ? "pass" : "fail"}
        />
      ) : null}
      {checkResult?.dirtyFiles.length ? (
        <code className="break-all rounded-sm bg-[var(--fail-soft)] px-2 py-1 font-mono text-[11px] text-[var(--fail)]">
          dirty: {checkResult.dirtyFiles.join(", ")}
        </code>
      ) : null}
      {applyResult?.applied ? (
        <StatusLine label="Temporary patch applied" detail={applyResult.diagnostics} variant="pass" />
      ) : null}
      {rerun ? (
        <StatusLine label="Repair rerun started" detail={rerun.rerunId} variant="info" />
      ) : null}
      {comparisonPending ? (
        <StatusLine label="Comparison pending" detail="rerun is still producing evidence" variant="info" />
      ) : null}
      {comparison ? <ComparisonSummary comparison={comparison} /> : null}
      {revertResult?.reverted ? (
        <StatusLine label="Temporary patch reverted" detail={revertResult.diagnostics} variant="fail" />
      ) : null}
    </div>
  );
}

function ComparisonSummary({ comparison }: { comparison: RepairComparison }): React.ReactElement {
  return (
    <section className="rounded-sm border border-[var(--line-faint)] bg-[var(--bg-1)] p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-[var(--ink-0)]">Before / after</span>
        <Badge variant={comparison.verdict === "regressed" ? "fail" : "pass"}>
          {comparison.verdict}
        </Badge>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-[11px]">
        <Metric label="resolved" value={comparison.resolvedFailures.length} />
        <Metric label="remaining" value={comparison.remainingFailures.length} />
        <Metric label="new" value={comparison.newFailures.length} />
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }): React.ReactElement {
  return (
    <span className="rounded-sm bg-[var(--bg-0)] px-2 py-1">
      {label} {value}
    </span>
  );
}

function StatusLine({
  label,
  detail,
  variant
}: {
  label: string;
  detail: string;
  variant: "pass" | "fail" | "info";
}): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant={variant}>{label}</Badge>
      <span className="break-words text-[var(--ink-3)]">{detail}</span>
    </div>
  );
}

function labelFor(state: ReviewState): string {
  switch (state) {
    case "checked":
      return "checked";
    case "applied":
      return "applied";
    case "rerun-started":
      return "rerun";
    case "comparison-ready":
      return "evidence";
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    default:
      return "draft";
  }
}

function badgeVariantFor(state: ReviewState): "default" | "info" | "pass" | "fail" | "flaky" {
  if (state === "approved") return "pass";
  if (state === "rejected") return "fail";
  if (state === "applied" || state === "rerun-started" || state === "comparison-ready") return "info";
  if (state === "checked") return "flaky";
  return "default";
}

function diffLineClass(line: string): string {
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return "block whitespace-pre-wrap break-words text-[var(--pass)]";
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return "block whitespace-pre-wrap break-words text-[var(--fail)]";
  }
  if (line.startsWith("@@")) {
    return "block whitespace-pre-wrap break-words text-[var(--accent)]";
  }
  return "block whitespace-pre-wrap break-words";
}
