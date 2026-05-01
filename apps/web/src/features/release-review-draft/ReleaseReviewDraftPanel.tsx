import * as React from "react";
import { useEffect, useState } from "react";
import { Clipboard, FileText } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import type {
  CiArtifactImportSource,
  CiArtifactSource,
  GitHubIssueLink,
  GitHubPullRequestLink,
  QmoSummary,
  ReleaseReviewDraft,
  ReleaseReviewDraftRequest
} from "@pwqa/shared";

import { createReleaseReviewDraft, importCiArtifacts } from "@/api/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMutationError } from "@/lib/mutation-error";

interface ReleaseReviewDraftPanelProps {
  readonly summary: QmoSummary | null | undefined;
  readonly isError: boolean;
  readonly isEmpty: boolean;
}

interface FormState {
  prUrl: string;
  prRepository: string;
  prNumber: string;
  prTitle: string;
  prAuthor: string;
  prHeadSha: string;
  issueUrl: string;
  issueRepository: string;
  issueNumber: string;
  issueTitle: string;
  issueState: "open" | "closed";
  ciName: string;
  ciUrl: string;
  ciSource: CiArtifactSource;
}

interface DraftMutationInput {
  request: Omit<ReleaseReviewDraftRequest, "ciArtifacts">;
  ciArtifact?: CiArtifactImportSource;
}

interface DraftMutationResult {
  draft: ReleaseReviewDraft | null;
  importedArtifactCount: number;
  skippedArtifactNames: string[];
}

const INITIAL_FORM: FormState = {
  prUrl: "",
  prRepository: "",
  prNumber: "",
  prTitle: "",
  prAuthor: "",
  prHeadSha: "",
  issueUrl: "",
  issueRepository: "",
  issueNumber: "",
  issueTitle: "",
  issueState: "open",
  ciName: "",
  ciUrl: "",
  ciSource: "github-actions"
};

export function ReleaseReviewDraftPanel({
  summary,
  isError,
  isEmpty
}: ReleaseReviewDraftPanelProps): React.ReactElement | null {
  if (summary === undefined && !isError && !isEmpty) return null;
  return (
    <Card data-testid="release-review-draft-panel" aria-label="Release review draft">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3 text-sm font-semibold">
          <span className="inline-flex min-w-0 items-center gap-2">
            <FileText className="size-4 text-[var(--accent)]" aria-hidden="true" />
            <span>Release review draft</span>
          </span>
          {summary ? <Badge variant={summary.outcome === "not-ready" ? "fail" : "info"}>{summary.outcome}</Badge> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {isError ? (
          <span data-testid="release-review-draft-error" className="text-destructive">
            Release readiness summary unavailable
          </span>
        ) : null}
        {!isError && isEmpty ? (
          <span data-testid="release-review-draft-no-runs" className="text-[var(--ink-3)]">
            No runs yet.
          </span>
        ) : null}
        {!isError && !isEmpty && summary === null ? (
          <span data-testid="release-review-draft-pending" className="text-[var(--ink-3)]">
            QMO summary not yet generated for this run.
          </span>
        ) : null}
        {!isError && !isEmpty && summary ? <ReleaseReviewDraftForm summary={summary} /> : null}
      </CardContent>
    </Card>
  );
}

function ReleaseReviewDraftForm({ summary }: { summary: QmoSummary }): React.ReactElement {
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const draftMutation = useMutation({
    mutationFn: async (input: DraftMutationInput): Promise<DraftMutationResult> => {
      const importResult = input.ciArtifact
        ? await importCiArtifacts(summary.runId, { artifacts: [input.ciArtifact] })
        : undefined;
      const draft = await createReleaseReviewDraft(summary.runId, {
        ...input.request,
        ciArtifacts: importResult?.imported ?? []
      });
      return {
        draft,
        importedArtifactCount: importResult?.imported.length ?? 0,
        skippedArtifactNames: importResult?.skipped.map((artifact) => artifact.name) ?? []
      };
    }
  });

  useEffect(() => {
    if (draftMutation.status === "error" && draftMutation.error) {
      // eslint-disable-next-line no-console -- draft 生成失敗は operator action に直結する
      console.error("[ReleaseReviewDraftPanel] draft generation failed", draftMutation.error);
    }
  }, [draftMutation.status, draftMutation.error]);

  const draft = draftMutation.data?.draft ?? null;

  function update<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((current) => ({ ...current, [key]: value }));
    setValidationError(null);
    setCopyState("idle");
  }

  function handleGenerate(): void {
    const parsed = buildMutationInput(form);
    if ("error" in parsed) {
      setValidationError(parsed.error);
      return;
    }
    draftMutation.mutate(parsed.value);
  }

  async function handleCopy(): Promise<void> {
    if (!draft) return;
    if (!navigator.clipboard?.writeText) {
      setCopyState("failed");
      return;
    }
    try {
      await navigator.clipboard.writeText(draft.markdown);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <fieldset className="grid gap-3 border-0 p-0 md:grid-cols-3">
        <LabeledInput
          id="release-review-pr-url"
          label="PR URL"
          value={form.prUrl}
          onChange={(value) => update("prUrl", value)}
        />
        <LabeledInput
          id="release-review-pr-repository"
          label="PR repository"
          value={form.prRepository}
          onChange={(value) => update("prRepository", value)}
        />
        <LabeledInput
          id="release-review-pr-number"
          label="PR number"
          inputMode="numeric"
          value={form.prNumber}
          onChange={(value) => update("prNumber", value)}
        />
        <LabeledInput
          id="release-review-pr-title"
          label="PR title"
          value={form.prTitle}
          onChange={(value) => update("prTitle", value)}
        />
        <LabeledInput
          id="release-review-pr-author"
          label="PR author"
          value={form.prAuthor}
          onChange={(value) => update("prAuthor", value)}
        />
        <LabeledInput
          id="release-review-pr-head-sha"
          label="PR head SHA"
          value={form.prHeadSha}
          onChange={(value) => update("prHeadSha", value)}
        />
      </fieldset>

      <fieldset className="grid gap-3 border-0 p-0 md:grid-cols-4">
        <LabeledInput
          id="release-review-issue-url"
          label="Issue URL"
          value={form.issueUrl}
          onChange={(value) => update("issueUrl", value)}
        />
        <LabeledInput
          id="release-review-issue-repository"
          label="Issue repository"
          value={form.issueRepository}
          onChange={(value) => update("issueRepository", value)}
        />
        <LabeledInput
          id="release-review-issue-number"
          label="Issue number"
          inputMode="numeric"
          value={form.issueNumber}
          onChange={(value) => update("issueNumber", value)}
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="release-review-issue-state">Issue state</Label>
          <select
            id="release-review-issue-state"
            className="h-9 rounded-md border border-[var(--line-strong)] bg-[var(--bg-elev)] px-3 text-sm text-[var(--ink-0)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            value={form.issueState}
            onChange={(event) => update("issueState", event.currentTarget.value as FormState["issueState"])}
          >
            <option value="open">open</option>
            <option value="closed">closed</option>
          </select>
        </div>
        <LabeledInput
          id="release-review-issue-title"
          label="Issue title"
          className="md:col-span-2"
          value={form.issueTitle}
          onChange={(value) => update("issueTitle", value)}
        />
      </fieldset>

      <fieldset className="grid gap-3 border-0 p-0 md:grid-cols-3">
        <LabeledInput
          id="release-review-ci-name"
          label="CI artifact"
          value={form.ciName}
          onChange={(value) => update("ciName", value)}
        />
        <LabeledInput
          id="release-review-ci-url"
          label="CI artifact URL"
          value={form.ciUrl}
          onChange={(value) => update("ciUrl", value)}
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="release-review-ci-source">CI source</Label>
          <select
            id="release-review-ci-source"
            className="h-9 rounded-md border border-[var(--line-strong)] bg-[var(--bg-elev)] px-3 text-sm text-[var(--ink-0)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            value={form.ciSource}
            onChange={(event) => update("ciSource", event.currentTarget.value as CiArtifactSource)}
          >
            <option value="github-actions">github-actions</option>
            <option value="allure">allure</option>
            <option value="playwright">playwright</option>
            <option value="external">external</option>
          </select>
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleGenerate}
          disabled={draftMutation.isPending}
        >
          <FileText aria-hidden="true" />
          {draftMutation.isPending ? "Generating…" : "Generate draft"}
        </Button>
        {draft ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => void handleCopy()}>
            <Clipboard aria-hidden="true" />
            Copy
          </Button>
        ) : null}
      </div>

      {validationError ? (
        <Alert variant="warning">
          <AlertTitle>Draft input incomplete</AlertTitle>
          <AlertDescription>{validationError}</AlertDescription>
        </Alert>
      ) : null}

      {draftMutation.error ? (
        <Alert variant="destructive">
          <AlertTitle>Release review draft failed</AlertTitle>
          <AlertDescription>
            {formatMutationError(draftMutation.error, "Release review draft を生成できませんでした")}
          </AlertDescription>
        </Alert>
      ) : null}

      {draftMutation.data?.draft === null ? (
        <Alert variant="warning">
          <AlertTitle>QMO summary pending</AlertTitle>
          <AlertDescription>QMO summary is required before a draft can be generated.</AlertDescription>
        </Alert>
      ) : null}

      {draftMutation.data?.skippedArtifactNames.length ? (
        <p data-testid="release-review-draft-skipped" className="text-xs text-[var(--ink-3)]">
          Skipped CI artifact: {draftMutation.data.skippedArtifactNames.join(", ")}
        </p>
      ) : null}
      {draftMutation.data && draftMutation.data.importedArtifactCount > 0 ? (
        <p data-testid="release-review-draft-imported" className="text-xs text-[var(--ink-3)]">
          Imported CI artifacts: {draftMutation.data.importedArtifactCount}
        </p>
      ) : null}
      {copyState === "copied" ? (
        <p className="text-xs text-[var(--pass)]">Copied</p>
      ) : null}
      {copyState === "failed" ? (
        <p className="text-xs text-[var(--fail)]">Copy failed</p>
      ) : null}

      {draft ? (
        <textarea
          aria-label="Release review markdown"
          className="min-h-72 w-full resize-y rounded-md border border-[var(--line-strong)] bg-[var(--bg-0)] p-3 font-mono text-xs text-[var(--ink-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
          readOnly
          value={draft.markdown}
        />
      ) : null}
    </div>
  );
}

function LabeledInput({
  id,
  label,
  value,
  onChange,
  inputMode,
  className
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  className?: string;
}): React.ReactElement {
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        inputMode={inputMode}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </div>
  );
}

function buildMutationInput(form: FormState): { value: DraftMutationInput } | { error: string } {
  const pullRequest = buildPullRequest(form);
  if ("error" in pullRequest) return pullRequest;
  const issue = buildIssue(form);
  if ("error" in issue) return issue;
  const ciArtifact = buildCiArtifact(form);
  if ("error" in ciArtifact) return ciArtifact;
  return {
    value: {
      request: {
        ...(pullRequest.value ? { pullRequest: pullRequest.value } : {}),
        issues: issue.value ? [issue.value] : []
      },
      ...(ciArtifact.value ? { ciArtifact: ciArtifact.value } : {})
    }
  };
}

function buildPullRequest(form: FormState): { value?: GitHubPullRequestLink } | { error: string } {
  const fields = [
    form.prUrl,
    form.prRepository,
    form.prNumber,
    form.prTitle,
    form.prAuthor,
    form.prHeadSha
  ];
  if (!hasAny(fields)) return { value: undefined };
  if (!hasAll([form.prUrl, form.prRepository, form.prNumber])) {
    return { error: "PR URL, repository, and number are required together." };
  }
  const number = parsePositiveInteger(form.prNumber);
  if (number === undefined) return { error: "PR number must be a positive integer." };
  return {
    value: {
      url: form.prUrl.trim(),
      repository: form.prRepository.trim(),
      number,
      ...(hasValue(form.prTitle) ? { title: form.prTitle.trim() } : {}),
      ...(hasValue(form.prAuthor) ? { author: form.prAuthor.trim() } : {}),
      ...(hasValue(form.prHeadSha) ? { headSha: form.prHeadSha.trim() } : {})
    }
  };
}

function buildIssue(form: FormState): { value?: GitHubIssueLink } | { error: string } {
  const fields = [form.issueUrl, form.issueRepository, form.issueNumber, form.issueTitle];
  if (!hasAny(fields)) return { value: undefined };
  if (!hasAll([form.issueUrl, form.issueRepository, form.issueNumber])) {
    return { error: "Issue URL, repository, and number are required together." };
  }
  const number = parsePositiveInteger(form.issueNumber);
  if (number === undefined) return { error: "Issue number must be a positive integer." };
  return {
    value: {
      url: form.issueUrl.trim(),
      repository: form.issueRepository.trim(),
      number,
      state: form.issueState,
      ...(hasValue(form.issueTitle) ? { title: form.issueTitle.trim() } : {})
    }
  };
}

function buildCiArtifact(form: FormState): { value?: CiArtifactImportSource } | { error: string } {
  if (!hasAny([form.ciName, form.ciUrl])) return { value: undefined };
  if (!hasAll([form.ciName, form.ciUrl])) {
    return { error: "CI artifact name and URL are required together." };
  }
  return {
    value: {
      name: form.ciName.trim(),
      url: form.ciUrl.trim(),
      source: form.ciSource
    }
  };
}

function hasValue(value: string): boolean {
  return value.trim().length > 0;
}

function hasAny(values: string[]): boolean {
  return values.some(hasValue);
}

function hasAll(values: string[]): boolean {
  return values.every(hasValue);
}

function parsePositiveInteger(value: string): number | undefined {
  if (!/^\d+$/.test(value.trim())) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}
