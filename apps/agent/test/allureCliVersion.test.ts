import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { probeAllureCliVersion } from "../src/project/allureCliVersion.js";

let workdir: string;

beforeEach(() => {
  workdir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pwqa-allure-cli-")));
  fs.mkdirSync(path.join(workdir, "node_modules", ".bin"), { recursive: true });
});
afterEach(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

function writeAllureStub(scriptBody: string): void {
  // Cross-platform stub: a Node.js script invoked via a tiny shebang shim.
  // The shim itself is a sh script so the stub does not require Node-specific
  // execution; on darwin/linux the file mode bit is honored, and the
  // production code uses `shell: false`, so the kernel-level execve handles
  // the shebang resolution.
  const binPath = path.join(workdir, "node_modules", ".bin", "allure");
  fs.writeFileSync(binPath, scriptBody, { mode: 0o755 });
}

describe("probeAllureCliVersion", () => {
  it("returns 'binary not found' warning when node_modules/.bin/allure is missing", async () => {
    const result = await probeAllureCliVersion(workdir);
    expect(result.version).toBeUndefined();
    expect(result.warnings.some((w) => w.includes("Allure CLI binary not found"))).toBe(true);
  });

  it("parses version 3.x and emits no warning", async () => {
    writeAllureStub("#!/bin/sh\necho 'allureVersion=3.6.2'\n");
    const result = await probeAllureCliVersion(workdir);
    expect(result.version).toBe("3.6.2");
    expect(result.warnings).toEqual([]);
  });

  it("parses version 2.x and emits an unsupported warning", async () => {
    writeAllureStub("#!/bin/sh\necho '2.30.0'\n");
    const result = await probeAllureCliVersion(workdir);
    expect(result.version).toBe("2.30.0");
    expect(result.warnings).toContain(
      "Allure CLI version is 2.30.0; Phase 1.2 is tested against 3.x."
    );
  });

  it("warns when --version output is unrecognised", async () => {
    writeAllureStub("#!/bin/sh\necho 'no version here'\n");
    const result = await probeAllureCliVersion(workdir);
    expect(result.version).toBeUndefined();
    expect(result.warnings[0]).toMatch(/output not recognised/);
  });

  it("warns on non-zero exit code with stderr summary", async () => {
    writeAllureStub("#!/bin/sh\necho 'boom' 1>&2\nexit 5\n");
    const result = await probeAllureCliVersion(workdir);
    expect(result.version).toBeUndefined();
    expect(result.warnings[0]).toMatch(/exited with code 5/);
    expect(result.warnings[0]).toMatch(/boom/);
  });

  it("does not invoke a shell — passing argv with shell metachars does not expand", async () => {
    // The stub itself echoes a literal $0 to prove no shell substitution is
    // applied to argv before the kernel exec. The stub is a sh script
    // because *its* execution does need a shell — the production code does
    // not (shell: false).
    writeAllureStub("#!/bin/sh\necho 'allureVersion=3.6.2'\n");
    const result = await probeAllureCliVersion(workdir);
    expect(result.version).toBe("3.6.2");
  });
});
