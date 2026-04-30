import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";

/**
 * §1.6 Allure CLI version probe.
 *
 * The scanner detects `allure` / `allure-commandline` in package.json, but
 * either package can resolve to an Allure 2 binary. Phase 1.2 was tested
 * against Allure 3.x — running with 2.x silently produces incompatible
 * `quality-gate` output and broken history JSON. We probe the resolved
 * binary at project-open time so the operator gets a concrete warning
 * instead of a confusing run failure later.
 *
 * Security:
 *   - No shell. `spawn` with the resolved binary path and a fixed argv,
 *     mirroring NodeCommandRunner's safe-by-default policy.
 *   - Bounded stdout buffer. `--version` should print one short line; we
 *     cap at 16 KiB so a runaway binary cannot exhaust memory.
 *   - 5s wall-clock timeout. The probe runs once per project-open, so a
 *     hung binary cannot stall scan indefinitely.
 */

const STDOUT_CAP_BYTES = 16 * 1024;
const PROBE_TIMEOUT_MS = 5_000;

const ALLURE_VERSION_PATTERN = /(\d+)\.(\d+)\.(\d+)(?:[-+][\w.-]+)?/;

export interface AllureCliVersionResult {
  /**
   * Parsed semver string (`"3.6.2"`) when the probe succeeded and the
   * stdout contained a recognisable version. `undefined` when the probe
   * could not run or the output was not parseable; in either case the
   * reason is appended to `warnings`.
   */
  version?: string;
  warnings: string[];
}

export type AllureCliVersionProbe = (
  projectRoot: string
) => Promise<AllureCliVersionResult>;

function parseAllureVersion(stdout: string): string | undefined {
  const match = ALLURE_VERSION_PATTERN.exec(stdout);
  if (!match) return undefined;
  return `${match[1]}.${match[2]}.${match[3]}`;
}

function nodeBinAllurePath(projectRoot: string): string {
  return path.join(projectRoot, "node_modules", ".bin", "allure");
}

function classifyVersion(version: string): "supported" | "unsupported" {
  return version.startsWith("3.") ? "supported" : "unsupported";
}

export const probeAllureCliVersion: AllureCliVersionProbe = async (
  projectRoot
) => {
  const binPath = nodeBinAllurePath(projectRoot);
  if (!existsSync(binPath)) {
    return {
      warnings: [
        `Allure CLI binary not found at ${path.join(
          "node_modules",
          ".bin",
          "allure"
        )}; package.json declares the dependency but install may be incomplete.`,
      ],
    };
  }

  return new Promise<AllureCliVersionResult>((resolve) => {
    const stdoutChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrSummary = "";
    let settled = false;

    const child = spawn(binPath, ["--version"], {
      cwd: projectRoot,
      shell: false,
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      if (settled) return;
      child.kill("SIGKILL");
      settle({
        warnings: [
          `Allure CLI version probe timed out after ${PROBE_TIMEOUT_MS}ms.`,
        ],
      });
    }, PROBE_TIMEOUT_MS);

    function settle(result: AllureCliVersionResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      const remaining = STDOUT_CAP_BYTES - stdoutBytes;
      if (remaining <= 0) return;
      const slice = chunk.length <= remaining ? chunk : chunk.subarray(0, remaining);
      stdoutChunks.push(slice);
      stdoutBytes += slice.length;
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderrSummary.length >= 200) return;
      stderrSummary += chunk.toString("utf8").slice(0, 200 - stderrSummary.length);
    });

    child.on("error", (error) => {
      const code =
        error instanceof Error && "code" in error && typeof error.code === "string"
          ? error.code
          : "SPAWN_ERROR";
      settle({
        warnings: [`Allure CLI version probe failed: ${code}`],
      });
    });

    child.on("close", (exitCode) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const version = parseAllureVersion(stdout);
      if (exitCode !== 0) {
        settle({
          warnings: [
            `Allure CLI version probe exited with code ${exitCode}${
              stderrSummary ? `: ${stderrSummary.trim()}` : ""
            }`,
          ],
        });
        return;
      }
      if (!version) {
        settle({
          warnings: [
            `Allure CLI version output not recognised: ${stdout
              .trim()
              .slice(0, 200) || "(empty)"}`,
          ],
        });
        return;
      }
      if (classifyVersion(version) === "unsupported") {
        settle({
          version,
          warnings: [
            `Allure CLI version is ${version}; Phase 1.2 is tested against 3.x.`,
          ],
        });
        return;
      }
      settle({ version, warnings: [] });
    });
  });
};
