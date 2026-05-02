import * as React from "react";
import { AlertTriangle, CheckCircle2, MessageSquareText, SendHorizonal } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

import type {
  TestPlanClarificationAnswer,
  TestPlanReviewModel
} from "./types";

interface TestPlanReviewPanelProps {
  model: TestPlanReviewModel;
  onSubmitAnswers?: (answers: TestPlanClarificationAnswer[]) => void;
}

export function TestPlanReviewPanel({
  model,
  onSubmitAnswers
}: TestPlanReviewPanelProps): React.ReactElement {
  const [answers, setAnswers] = React.useState<Record<string, string>>({});
  const requiredClarifications = model.clarifications.filter((item) => item.required);
  const unansweredRequired = requiredClarifications.filter(
    (item) => (answers[item.id] ?? "").trim().length === 0
  );
  const canSubmit = model.clarifications.length === 0 || unansweredRequired.length === 0;
  const status = model.clarifications.length === 0 ? "ready" : canSubmit ? "answered" : "needs-input";

  return (
    <Card data-testid="test-plan-review-panel">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3">
          <span className="inline-flex min-w-0 items-center gap-2">
            <MessageSquareText className="size-4 text-[var(--accent)]" aria-hidden="true" />
            <span>Test plan review</span>
          </span>
          <StatusBadge status={status} />
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <section
          data-testid="test-plan-review-markdown"
          className="max-h-64 overflow-auto rounded-sm border border-[var(--line-faint)] bg-[var(--bg-1)] p-3"
        >
          <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[11.5px] leading-5 text-[var(--ink-1)]">
            {model.planMarkdown.trim() || "No test plan generated."}
          </pre>
        </section>

        {model.warnings && model.warnings.length > 0 ? (
          <section
            data-testid="test-plan-review-warnings"
            className="flex flex-col gap-2 rounded-sm border border-[var(--line-faint)] bg-[var(--fail-soft)] p-3"
          >
            <div className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--ink-1)]">
              <AlertTriangle className="size-3.5 text-[var(--fail)]" aria-hidden="true" />
              Warnings
            </div>
            <ul className="m-0 flex list-disc flex-col gap-1 pl-4 text-xs text-[var(--ink-2)]">
              {model.warnings.map((warning) => (
                <li key={warning} className="break-words">
                  {warning}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {model.clarifications.length > 0 ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!canSubmit) return;
              onSubmitAnswers?.(
                model.clarifications.map((item) => ({
                  id: item.id,
                  answer: (answers[item.id] ?? "").trim()
                }))
              );
            }}
          >
            <div className="flex flex-col gap-3" data-testid="test-plan-review-clarifications">
              {model.clarifications.map((item, index) => (
                <section
                  key={item.id}
                  className="grid gap-2 rounded-sm border border-[var(--line-faint)] bg-[var(--bg-0)] p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label htmlFor={`test-plan-clarification-${item.id}`}>
                      Clarification {index + 1}
                    </Label>
                    <Badge variant={item.required ? "flaky" : "info"}>
                      {item.required ? "required" : "optional"}
                    </Badge>
                  </div>
                  <p className="m-0 text-sm text-[var(--ink-1)]">{item.question}</p>
                  {item.reason ? (
                    <p className="m-0 text-xs text-[var(--ink-3)]">{item.reason}</p>
                  ) : null}
                  <textarea
                    id={`test-plan-clarification-${item.id}`}
                    data-testid={`test-plan-review-answer-${item.id}`}
                    className="min-h-20 resize-y rounded-md border border-[var(--line-strong)] bg-[var(--bg-elev)] px-3 py-2 text-sm text-[var(--ink-0)] outline-none transition-colors placeholder:text-[var(--ink-4)] focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                    value={answers[item.id] ?? ""}
                    onChange={(event) =>
                      setAnswers((current) => ({ ...current, [item.id]: event.target.value }))
                    }
                  />
                </section>
              ))}
            </div>
            <Button
              type="submit"
              size="sm"
              className="w-fit"
              disabled={!canSubmit}
              data-testid="test-plan-review-submit"
            >
              <SendHorizonal aria-hidden="true" />
              Submit answers
            </Button>
          </form>
        ) : (
          <div
            data-testid="test-plan-review-ready"
            className="inline-flex items-center gap-2 text-sm text-[var(--ink-2)]"
          >
            <CheckCircle2 className="size-4 text-[var(--pass)]" aria-hidden="true" />
            Ready for review.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: "ready" | "answered" | "needs-input" }): React.ReactElement {
  if (status === "ready") {
    return <Badge variant="pass">ready</Badge>;
  }
  if (status === "answered") {
    return <Badge variant="info">answered</Badge>;
  }
  return <Badge variant="flaky">needs input</Badge>;
}
