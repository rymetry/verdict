import type { GateDecision, MergeGateInput } from "./types.js";

export function evaluateMergeGate(input: MergeGateInput): GateDecision {
  const reasons: string[] = [];
  if (input.ci !== "pass") reasons.push(`CI is ${input.ci}`);
  if (input.qa === "skipped") reasons.push("QA was skipped");
  if (input.qa === "fail") reasons.push("QA failed");
  if (input.review === "p0-p1") reasons.push("AI review found P0/P1 issues");
  if (input.review === "fail") reasons.push("AI review failed");
  if (input.scope !== "pass") reasons.push("scope check failed");
  if (input.workingTree !== "clean") reasons.push("working tree is dirty");
  return { allowed: reasons.length === 0, reasons };
}

export function evaluateDeployGate(input: {
  environment: "preview" | "staging" | "production";
  productionPolicy?: "approval" | "auto";
  approvalGranted?: boolean;
}): GateDecision {
  if (input.environment !== "production") {
    return { allowed: true, reasons: [] };
  }
  if (input.productionPolicy === "auto") {
    return { allowed: true, reasons: [] };
  }
  if (input.approvalGranted) {
    return { allowed: true, reasons: [] };
  }
  return {
    allowed: false,
    reasons: ["production deploy requires approval unless productionPolicy is auto"]
  };
}

export function isHighRiskChange(text: string, patterns: string[] = []): boolean {
  const lowered = text.toLowerCase();
  return patterns.some((pattern) => lowered.includes(pattern.toLowerCase()));
}
