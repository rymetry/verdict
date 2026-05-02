import { describe, expect, it } from "vitest";
import { reviewPullRequestDiff } from "../src/prReview.js";

describe("reviewPullRequestDiff", () => {
  it("passes clean autonomy diffs with only advisory coverage findings", () => {
    const result = reviewPullRequestDiff({
      diff: [
        "diff --git a/packages/autonomy/src/config.ts b/packages/autonomy/src/config.ts",
        "+++ b/packages/autonomy/src/config.ts",
        "+export const value = true;"
      ].join("\n")
    });

    expect(result.expectedReviewers).toEqual(["diff-review"]);
    expect(result.reviews[0]).toMatchObject({
      reviewer: "diff-review",
      status: "pass"
    });
    expect(result.reviews[0]?.findings).toEqual([
      expect.objectContaining({
        priority: 3,
        title: "Autonomy source changed without focused tests"
      })
    ]);
  });

  it("blocks focused tests and agent state artifacts", () => {
    const result = reviewPullRequestDiff({
      diff: [
        "diff --git a/.agents/state/review-1.json b/.agents/state/review-1.json",
        "+++ b/.agents/state/review-1.json",
        "+{}",
        "diff --git a/packages/autonomy/test/example.test.ts b/packages/autonomy/test/example.test.ts",
        "+++ b/packages/autonomy/test/example.test.ts",
        "+it.only(\"runs one case\", () => {});"
      ].join("\n")
    });

    expect(result.reviews[0]?.status).toBe("fail");
    expect(result.reviews[0]?.findings).toEqual([
      expect.objectContaining({
        priority: 1,
        title: "Agent state artifact is part of the PR"
      }),
      expect.objectContaining({
        priority: 1,
        title: "Focused test was committed"
      })
    ]);
  });

  it("blocks secret-like values and local absolute paths", () => {
    const secret = `${"sk_"}${"live_"}1234567890abcdef`;
    const localPath = `${"/"}Users/rym/tmp/output.json`;
    const result = reviewPullRequestDiff({
      diff: [
        "diff --git a/packages/autonomy/src/example.ts b/packages/autonomy/src/example.ts",
        "+++ b/packages/autonomy/src/example.ts",
        `+const apiKey = "${secret}";`,
        `+const localPath = "${localPath}";`
      ].join("\n")
    });

    expect(result.reviews[0]?.status).toBe("fail");
    expect(result.reviews[0]?.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ priority: 0, title: "Potential secret was added" }),
        expect.objectContaining({ priority: 1, title: "Absolute local path was added" })
      ])
    );
  });
});
