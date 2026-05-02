import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chooseNextMergeMethod,
  createShipLearningEntries,
  evaluateCiStatus,
  evaluateReviewGate,
  evaluateShipGate,
  interpretMergeOutcome,
  recordCiPoll
} from "../src/ship.js";
import { appendLearning, createInitialProgress } from "../src/state.js";

let workdir: string;

beforeEach(() => {
  workdir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agent-autonomy-ship-")));
});

afterEach(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

describe("evaluateCiStatus", () => {
  it("passes when required checks succeed and non-required checks are skipped", () => {
    const decision = evaluateCiStatus([
      {
        name: "build",
        workflowName: "CI",
        status: "COMPLETED",
        conclusion: "SUCCESS",
        detailsUrl: "https://example.test/checks/build"
      },
      {
        name: "Dependabot Auto-Merge Expected",
        status: "COMPLETED",
        conclusion: "SKIPPED",
        required: false
      }
    ]);

    expect(decision).toMatchObject({
      ci: "pass",
      passed: ["CI: build"],
      skipped: ["Dependabot Auto-Merge Expected"],
      learningKeys: ["github-ci-skipped-nonrequired-checks"]
    });
    expect(decision.evidence).toEqual(["https://example.test/checks/build"]);
  });

  it("keeps CI pending until at least one non-skipped check passes", () => {
    const decision = evaluateCiStatus([
      {
        name: "Dependabot Auto-Merge Expected",
        status: "COMPLETED",
        conclusion: "SKIPPED",
        required: false
      }
    ]);

    expect(decision.ci).toBe("pending");
    expect(decision.pending).toEqual(["No completed successful non-skipped checks"]);
  });

  it("does not pass CI when the only completed non-skipped check is neutral", () => {
    const decision = evaluateCiStatus([
      {
        name: "advisory",
        status: "COMPLETED",
        conclusion: "NEUTRAL"
      }
    ]);

    expect(decision).toMatchObject({
      ci: "pending",
      passed: [],
      neutral: ["advisory"],
      pending: ["No completed successful non-skipped checks"]
    });
  });

  it("fails red or required-skipped checks", () => {
    const decision = evaluateCiStatus([
      {
        name: "typecheck",
        status: "COMPLETED",
        conclusion: "FAILURE"
      },
      {
        name: "release gate",
        status: "COMPLETED",
        conclusion: "SKIPPED",
        required: true
      }
    ]);

    expect(decision.ci).toBe("fail");
    expect(decision.failed).toEqual([
      "typecheck concluded failure",
      "release gate was skipped without explicit non-required status"
    ]);
  });

  it("fails skipped checks when requiredness is unknown", () => {
    const decision = evaluateCiStatus([
      {
        name: "build",
        status: "COMPLETED",
        conclusion: "SUCCESS"
      },
      {
        name: "release gate",
        status: "COMPLETED",
        conclusion: "SKIPPED"
      }
    ]);

    expect(decision.ci).toBe("fail");
    expect(decision.failed).toEqual(["release gate was skipped without explicit non-required status"]);
    expect(decision.learningKeys).toEqual([]);
  });
});

describe("recordCiPoll", () => {
  it("increments CI poll count and records a recurring CI escalation on failure", () => {
    const progress = createInitialProgress(new Date("2026-05-02T00:00:00.000Z"));
    progress.active = {
      id: "T1500-6",
      pr_number: 103,
      branch: "feat/T1500-6",
      stage: "ship",
      started_at: "2026-05-02T00:00:00.000Z",
      last_attempt_at: "2026-05-02T00:00:00.000Z"
    };

    const next = recordCiPoll(
      progress,
      {
        ci: "fail",
        passed: [],
        neutral: [],
        pending: [],
        failed: ["CI: build concluded failure"],
        skipped: [],
        evidence: [],
        learningKeys: []
      },
      new Date("2026-05-02T01:00:00.000Z")
    );

    expect(next.stats.ci_polls).toBe(1);
    expect(next.active?.last_attempt_at).toBe("2026-05-02T01:00:00.000Z");
    expect(next.escalated[0]).toMatchObject({
      id: "T1500-6",
      class: "RECURRING_CI_FAILURE",
      reason: "CI: build concluded failure"
    });
  });
});

describe("evaluateReviewGate", () => {
  it("passes only after all subagent reviews pass with no P0-P2 findings", () => {
    expect(
      evaluateReviewGate({
        expectedReviewers: ["architecture", "release"],
        reviews: [
          { reviewer: "architecture", status: "pass", findings: [{ priority: 3, title: "Minor cleanup" }] },
          { reviewer: "release", status: "pass" }
        ]
      })
    ).toEqual({
      review: "pass",
      allowed: true,
      reasons: [],
      blockerFindings: []
    });
  });

  it("blocks P2 findings as review failures before auto-merge", () => {
    const decision = evaluateReviewGate({
      expectedReviewers: ["release"],
      reviews: [
        {
          reviewer: "release",
          status: "pass",
          findings: [{ priority: 2, title: "Merge fallback is not tested" }]
        }
      ]
    });

    expect(decision).toMatchObject({
      review: "fail",
      allowed: false,
      reasons: ["AI review found P2 issues"]
    });
    expect(decision.blockerFindings).toEqual([
      { priority: 2, title: "Merge fallback is not tested", source: "release" }
    ]);
  });

  it("maps P0/P1 findings to the stricter merge gate state", () => {
    const decision = evaluateReviewGate({
      expectedReviewers: ["security"],
      reviews: [
        {
          reviewer: "security",
          status: "pass",
          findings: [{ priority: 1, title: "Auth bypass" }]
        }
      ]
    });

    expect(decision.review).toBe("p0-p1");
    expect(decision.allowed).toBe(false);
  });

  it("blocks when an expected subagent review is missing", () => {
    const decision = evaluateReviewGate({
      expectedReviewers: ["architecture", "release"],
      reviews: [{ reviewer: "architecture", status: "pass" }]
    });

    expect(decision).toMatchObject({
      review: "fail",
      allowed: false,
      reasons: ["release review is missing"]
    });
  });
});

describe("evaluateShipGate", () => {
  it("composes CI polling, QA, review, scope, and worktree into the merge gate input", () => {
    const decision = evaluateShipGate({
      ci: evaluateCiStatus([{ name: "build", status: "COMPLETED", conclusion: "SUCCESS" }]),
      qa: "pass",
      reviews: [{ reviewer: "architecture", status: "pass" }],
      expectedReviewers: ["architecture"],
      scope: "pass",
      workingTree: "clean"
    });

    expect(decision.allowed).toBe(true);
    expect(decision.mergeInput).toEqual({
      ci: "pass",
      qa: "pass",
      review: "pass",
      scope: "pass",
      workingTree: "clean"
    });
  });

  it("blocks merge while CI or subagent review gates are not ready", () => {
    const decision = evaluateShipGate({
      ci: evaluateCiStatus([{ name: "build", status: "IN_PROGRESS" }]),
      qa: "pass",
      reviews: [{ reviewer: "release", status: "pending" }],
      expectedReviewers: ["release"],
      scope: "pass",
      workingTree: "clean"
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toEqual(["release review is pending", "CI is pending"]);
  });
});

describe("merge outcome state machine", () => {
  it("starts with squash and falls back to merge when GitHub rejects squash merges", () => {
    expect(chooseNextMergeMethod([])).toBe("squash");
    expect(
      chooseNextMergeMethod([
        {
          method: "squash",
          status: "failed",
          stderr: "GraphQL: Squash merges are not allowed for this repository."
        }
      ])
    ).toBe("merge");

    expect(
      interpretMergeOutcome({
        attempted: "squash",
        exitCode: 1,
        stderr: "GraphQL: Squash merges are not allowed for this repository."
      })
    ).toEqual({
      status: "retry",
      nextMethod: "merge",
      reason: "Squash merge is disabled for this repository; retry with merge commit.",
      learningKeys: ["github-squash-merge-disabled"]
    });

    expect(
      interpretMergeOutcome({
        attempted: "squash",
        exitCode: 1,
        prState: "OPEN",
        stderr: "GraphQL: Repository does not allow squash merging."
      })
    ).toMatchObject({
      status: "retry",
      nextMethod: "merge"
    });
  });

  it("treats the local main worktree error as success after confirming the PR is merged", () => {
    expect(
      interpretMergeOutcome({
        attempted: "merge",
        exitCode: 1,
        stderr: "failed to run git: fatal: 'main' is already used by worktree at '/Users/rym/project'",
        prState: "MERGED"
      })
    ).toEqual({
      status: "merged",
      reason: "Pull request is merged even though the local merge command returned an error.",
      learningKeys: ["github-merge-local-worktree-post-merge-error"]
    });
  });

  it("waits for PR state confirmation before treating a successful command as merged", () => {
    expect(
      interpretMergeOutcome({
        attempted: "merge",
        exitCode: 0,
        prState: "OPEN"
      })
    ).toEqual({
      status: "waiting",
      reason: "Merge command completed but the pull request is still open; poll PR state before marking Ship as merged.",
      learningKeys: []
    });
  });

  it("does not let merge commit evidence override explicit non-merged PR state", () => {
    expect(
      interpretMergeOutcome({
        attempted: "merge",
        exitCode: 1,
        prState: "OPEN",
        mergeCommitOid: "abc123"
      })
    ).toMatchObject({ status: "waiting" });
    expect(
      interpretMergeOutcome({
        attempted: "merge",
        exitCode: 1,
        prState: "CLOSED",
        mergeCommitOid: "abc123"
      })
    ).toMatchObject({ status: "failed" });
  });

  it("does not treat merge commit evidence alone as final merge confirmation", () => {
    expect(
      interpretMergeOutcome({
        attempted: "merge",
        exitCode: 1,
        mergeCommitOid: "abc123"
      })
    ).toMatchObject({
      status: "failed"
    });
  });
});

describe("createShipLearningEntries", () => {
  it("creates stable Ship learning entries that state persistence can dedupe", () => {
    const entries = createShipLearningEntries([
      { key: "github-squash-merge-disabled" },
      { key: "github-merge-local-worktree-post-merge-error" }
    ]);
    for (const entry of entries) {
      appendLearning(workdir, entry);
    }
    appendLearning(workdir, entries[0]);

    const lines = fs
      .readFileSync(path.join(workdir, ".agents", "state", "learnings.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(lines).toHaveLength(2);
    expect(lines.map((line) => line.key)).toEqual([
      "github-squash-merge-disabled",
      "github-merge-local-worktree-post-merge-error"
    ]);
  });
});
