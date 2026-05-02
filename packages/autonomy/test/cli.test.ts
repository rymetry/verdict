import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isMainModule, runCli as runCliEntry } from "../src/cli.js";

let workdir: string;

beforeEach(() => {
  workdir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agent-autonomy-cli-")));
});

afterEach(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

describe("cli", () => {
  it("rejects mismatched --run-review and --ship-pr targets before side effects", () => {
    const result = runCli(["--run-review", "109", "--ship-pr", "108"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--run-review and --ship-pr must reference the same PR.");
    expect(result.stdout).toBe("");
  });

  it("rejects --run-review combined with an explicit --review-file", () => {
    const result = runCli(["--run-review", "109", "--review-file", ".agents/state/review-109.json"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--run-review cannot be combined with --review-file.");
    expect(result.stdout).toBe("");
  });

  it("recognizes symlinked package bin entrypoints", () => {
    const realCli = path.join(workdir, "dist", "cli.js");
    const linkedCli = path.join(workdir, "node_modules", ".bin", "agent-autonomy-drive");
    fs.mkdirSync(path.dirname(realCli), { recursive: true });
    fs.mkdirSync(path.dirname(linkedCli), { recursive: true });
    fs.writeFileSync(realCli, "");
    fs.symlinkSync(realCli, linkedCli);

    expect(isMainModule(pathToFileURL(realCli).href, linkedCli)).toBe(true);
  });
});

function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  let stdout = "";
  let stderr = "";
  const status = runCliEntry(args, {
    cwd: process.cwd(),
    stdout: { write: (chunk: string) => { stdout += chunk; return true; } },
    stderr: { write: (chunk: string) => { stderr += chunk; return true; } }
  });
  return {
    status,
    stdout,
    stderr
  };
}
