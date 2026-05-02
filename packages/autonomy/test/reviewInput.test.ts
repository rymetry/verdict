import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadReviewInput } from "../src/reviewInput.js";

let workdir: string;

beforeEach(() => {
  workdir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agent-autonomy-review-")));
});

afterEach(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

describe("loadReviewInput", () => {
  it("loads subagent review gate input with expected reviewers", () => {
    fs.writeFileSync(
      path.join(workdir, "reviews.json"),
      JSON.stringify({
        expectedReviewers: ["architecture", "release"],
        reviews: [
          { reviewer: "architecture", status: "pass" },
          {
            reviewer: "release",
            status: "pass",
            findings: [{ priority: 3, title: "Follow-up cleanup" }]
          }
        ]
      })
    );

    expect(loadReviewInput(workdir, "reviews.json")).toEqual({
      expectedReviewers: ["architecture", "release"],
      reviews: [
        { reviewer: "architecture", status: "pass", findings: undefined, summary: undefined },
        {
          reviewer: "release",
          status: "pass",
          findings: [{ priority: 3, title: "Follow-up cleanup", body: undefined, source: undefined }],
          summary: undefined
        }
      ]
    });
  });

  it("rejects invalid finding priorities", () => {
    fs.writeFileSync(
      path.join(workdir, "reviews.json"),
      JSON.stringify([{ reviewer: "security", status: "pass", findings: [{ priority: 4, title: "bad" }] }])
    );

    expect(() => loadReviewInput(workdir, "reviews.json")).toThrow(/priority/);
  });
});
