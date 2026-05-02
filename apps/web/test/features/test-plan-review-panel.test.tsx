import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TestPlanReviewPanel } from "@/features/test-plan-review/TestPlanReviewPanel";
import type { TestPlanReviewModel } from "@/features/test-plan-review/types";

afterEach(() => {
  cleanup();
});

describe("TestPlanReviewPanel", () => {
  it("renders a ready state when the generated plan has no clarifications", () => {
    render(<TestPlanReviewPanel model={makeModel({ clarifications: [] })} />);

    expect(screen.getByTestId("test-plan-review-panel")).toBeInTheDocument();
    expect(screen.getByText("ready")).toBeInTheDocument();
    expect(screen.getByTestId("test-plan-review-ready")).toHaveTextContent("Ready for review.");
    expect(screen.getByText(/# Test Plan/)).toBeInTheDocument();
  });

  it("requires blocking clarification answers before submitting", async () => {
    const onSubmitAnswers = vi.fn();
    render(<TestPlanReviewPanel model={makeModel()} onSubmitAnswers={onSubmitAnswers} />);

    const submit = screen.getByTestId("test-plan-review-submit");
    expect(screen.getByText("needs input")).toBeInTheDocument();
    expect(submit).toBeDisabled();

    await userEvent.type(
      screen.getByTestId("test-plan-review-answer-checkout-risk"),
      "Cover guest checkout and saved-card checkout separately."
    );
    await userEvent.click(submit);

    expect(screen.getByText("answered")).toBeInTheDocument();
    expect(onSubmitAnswers).toHaveBeenCalledWith([
      {
        id: "checkout-risk",
        answer: "Cover guest checkout and saved-card checkout separately."
      },
      {
        id: "optional-owner",
        answer: ""
      }
    ]);
  });

  it("surfaces generator warnings without blocking optional clarifications", async () => {
    const onSubmitAnswers = vi.fn();
    render(
      <TestPlanReviewPanel
        model={makeModel({
          clarifications: [
            {
              id: "optional-owner",
              question: "Who owns payment regression triage?",
              required: false
            }
          ],
          warnings: ["Layer judgment is missing for checkout flow."]
        })}
        onSubmitAnswers={onSubmitAnswers}
      />
    );

    expect(screen.getByTestId("test-plan-review-warnings")).toHaveTextContent(
      "Layer judgment is missing for checkout flow."
    );
    expect(screen.getByText("answered")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("test-plan-review-submit"));
    expect(onSubmitAnswers).toHaveBeenCalledWith([{ id: "optional-owner", answer: "" }]);
  });
});

function makeModel(overrides: Partial<TestPlanReviewModel> = {}): TestPlanReviewModel {
  return {
    planMarkdown: "# Test Plan\n\n| Layer | Proposed coverage |\n| --- | --- |\n| e2e | Checkout payment |",
    clarifications: [
      {
        id: "checkout-risk",
        question: "Which checkout paths must block release?",
        required: true,
        reason: "The generated plan found multiple payment paths."
      },
      {
        id: "optional-owner",
        question: "Who owns payment regression triage?",
        required: false
      }
    ],
    warnings: [],
    ...overrides
  };
}
