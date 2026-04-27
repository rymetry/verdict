// status.ts の純粋関数を網羅的に検証する。
// RunStatus enum を全件カバーすることで、将来 enum が拡張された際に
// switch の網羅違反を CI で検出できる (TS の `as never` 罠を tests でも担保)。
import { describe, expect, it } from "vitest";
import type { RunStatus } from "@pwqa/shared";

import {
  agentDotColorClass,
  runStatusBadgeVariant,
  runStatusLabel,
  type AgentDotState
} from "@/components/shell/status";

const ALL_STATUSES: RunStatus[] = [
  "queued",
  "running",
  "passed",
  "failed",
  "cancelled",
  "error"
];

describe("runStatusBadgeVariant", () => {
  it("passed は pass バリアント", () => {
    expect(runStatusBadgeVariant("passed")).toBe("pass");
  });
  it("failed / error は fail バリアント", () => {
    expect(runStatusBadgeVariant("failed")).toBe("fail");
    expect(runStatusBadgeVariant("error")).toBe("fail");
  });
  it("running は info バリアント", () => {
    expect(runStatusBadgeVariant("running")).toBe("info");
  });
  it("queued / cancelled は default バリアント", () => {
    expect(runStatusBadgeVariant("queued")).toBe("default");
    expect(runStatusBadgeVariant("cancelled")).toBe("default");
  });
  it("全 RunStatus に対し未定義 (undefined) を返さない", () => {
    for (const s of ALL_STATUSES) {
      expect(runStatusBadgeVariant(s)).toBeTruthy();
    }
  });
});

describe("runStatusLabel", () => {
  it("各 RunStatus に対し空文字以外の表示ラベルを返す", () => {
    for (const s of ALL_STATUSES) {
      const label = runStatusLabel(s);
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });
  it("passed は Passed を返す (代表値)", () => {
    expect(runStatusLabel("passed")).toBe("Passed");
  });
});

describe("agentDotColorClass", () => {
  it("reachable は --pass トークンを使う", () => {
    expect(agentDotColorClass("reachable")).toContain("var(--pass)");
  });
  it("unreachable は --fail トークンを使う", () => {
    expect(agentDotColorClass("unreachable")).toContain("var(--fail)");
  });
  it("pending は --skip トークンを使う", () => {
    expect(agentDotColorClass("pending")).toContain("var(--skip)");
  });
  it("全 state に対し空文字以外を返す", () => {
    const states: AgentDotState[] = ["reachable", "pending", "unreachable"];
    for (const s of states) {
      expect(agentDotColorClass(s).length).toBeGreaterThan(0);
    }
  });
});
