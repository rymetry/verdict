import { describe, expect, it } from "vitest";
import { evaluateDeployGate, evaluateMergeGate, isHighRiskChange } from "../src/policy.js";

describe("evaluateMergeGate", () => {
  it("allows merge only when all gates pass", () => {
    expect(
      evaluateMergeGate({
        ci: "pass",
        qa: "pass",
        review: "pass",
        scope: "pass",
        workingTree: "clean"
      })
    ).toEqual({ allowed: true, reasons: [] });
  });

  it("rejects red CI, P0/P1 review, QA failure, scope failure, and dirty worktree", () => {
    const decision = evaluateMergeGate({
      ci: "fail",
      qa: "fail",
      review: "p0-p1",
      scope: "fail",
      workingTree: "dirty"
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toEqual([
      "CI is fail",
      "QA failed",
      "AI review found P0/P1 issues",
      "scope check failed",
      "working tree is dirty"
    ]);
  });

  it("rejects skipped QA for auto-merge decisions", () => {
    const decision = evaluateMergeGate({
      ci: "pass",
      qa: "skipped",
      review: "pass",
      scope: "pass",
      workingTree: "clean"
    });

    expect(decision).toEqual({ allowed: false, reasons: ["QA was skipped"] });
  });
});

describe("evaluateDeployGate", () => {
  it("allows preview and staging deploys by default", () => {
    expect(evaluateDeployGate({ environment: "preview" })).toEqual({ allowed: true, reasons: [] });
    expect(evaluateDeployGate({ environment: "staging" })).toEqual({ allowed: true, reasons: [] });
  });

  it("requires approval for production unless auto policy is explicit", () => {
    expect(evaluateDeployGate({ environment: "production" })).toEqual({
      allowed: false,
      reasons: ["production deploy requires approval unless productionPolicy is auto"]
    });
    expect(evaluateDeployGate({ environment: "production", productionPolicy: "auto" })).toEqual({
      allowed: true,
      reasons: []
    });
  });
});

describe("isHighRiskChange", () => {
  it("detects configured high-risk terms", () => {
    expect(isHighRiskChange("Add billing webhook integration", ["billing", "auth"])).toBe(true);
    expect(isHighRiskChange("Fix empty state copy", ["billing", "auth"])).toBe(false);
  });
});
