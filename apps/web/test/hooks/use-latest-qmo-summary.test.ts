// `useLatestQmoSummary` の sort helper の純粋テスト。React Query の hook 統合は
// route smoke で間接 cover (cookies / network はスタブを使うのでフル組成は重い)。

import { describe, expect, it } from "vitest";
import type { RunListItem } from "@pwqa/shared";

import { pickLatestRun } from "@/hooks/use-latest-qmo-summary";

function makeRun(runId: string, startedAt: string): RunListItem {
  return {
    runId,
    projectId: "/p",
    status: "passed",
    startedAt,
    completedAt: startedAt,
    durationMs: 1,
    exitCode: 0,
    warnings: []
  };
}

describe("pickLatestRun", () => {
  it("returns undefined for an empty list", () => {
    expect(pickLatestRun([])).toBeUndefined();
  });

  it("returns the only run when the list has length 1", () => {
    const run = makeRun("r1", "2026-04-30T05:00:00Z");
    expect(pickLatestRun([run])).toEqual(run);
  });

  it("returns the run with the most recent startedAt regardless of input order", () => {
    const old = makeRun("r1", "2026-04-29T00:00:00Z");
    const recent = makeRun("r2", "2026-04-30T05:00:00Z");
    const middle = makeRun("r3", "2026-04-29T12:00:00Z");
    // input ordered ascending — verify it picks recent regardless
    expect(pickLatestRun([old, middle, recent])?.runId).toBe("r2");
    // descending
    expect(pickLatestRun([recent, middle, old])?.runId).toBe("r2");
    // shuffled
    expect(pickLatestRun([middle, old, recent])?.runId).toBe("r2");
  });

  it("does not mutate the input array", () => {
    const a = makeRun("r1", "2026-04-29T00:00:00Z");
    const b = makeRun("r2", "2026-04-30T00:00:00Z");
    const input = [a, b];
    const inputBefore = [...input];
    pickLatestRun(input);
    expect(input).toEqual(inputBefore);
  });
});
