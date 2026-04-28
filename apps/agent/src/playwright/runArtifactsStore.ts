import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { type RunMetadata } from "@pwqa/shared";
import { workbenchPaths } from "../storage/paths.js";
import { redactWithStats } from "../commands/redact.js";

/**
 * All filesystem mutations for a run live behind this interface so that
 * `runManager` orchestrates lifecycle/events without knowing about file
 * layout (SRP). Tests can mock this without spawning processes.
 */
export interface RunArtifactsStore {
  ensureDirs(projectRoot: string, runDir: string, htmlReportDir: string): void;
  writeMetadata(metadataPath: string, metadata: RunMetadata): Promise<void>;
  openLogStreams(stdoutPath: string, stderrPath: string): Promise<RunLogStreams>;
  /**
   * Reads the Playwright JSON reporter output, applies secret redaction
   * patterns to scrub leaked secrets out of test titles / error messages /
   * stacks, and writes the scrubbed body back. PLAN.v2 §28 / security
   * review #8. No-op when the file is absent (run failed before reporter
   * could emit).
   */
  redactPlaywrightResults(playwrightJsonPath: string): Promise<RedactionOutcome>;
}

export interface RedactionOutcome {
  applied: boolean;
  /** True if redaction actually changed the contents. */
  modified: boolean;
  replacements: number;
}

export interface RunLogStreams {
  stdout: FileHandle;
  stderr: FileHandle;
  closeAll(): Promise<void>;
}

export const runArtifactsStore: RunArtifactsStore = {
  ensureDirs(projectRoot, runDir, htmlReportDir) {
    const wb = workbenchPaths(projectRoot);
    fsSync.mkdirSync(runDir, { recursive: true });
    fsSync.mkdirSync(htmlReportDir, { recursive: true });
    fsSync.mkdirSync(wb.runsDir, { recursive: true });
    fsSync.mkdirSync(wb.reportsDir, { recursive: true });
    fsSync.mkdirSync(wb.configDir, { recursive: true });
  },

  async writeMetadata(metadataPath, metadata) {
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf8");
  },

  async openLogStreams(stdoutPath, stderrPath) {
    const stdout = await fs.open(stdoutPath, "w");
    let stderr: FileHandle;
    try {
      stderr = await fs.open(stderrPath, "w");
    } catch (error) {
      // First handle already opened — close it before propagating.
      await stdout.close().catch(() => undefined);
      throw error;
    }
    return {
      stdout,
      stderr,
      async closeAll() {
        await stdout.close().catch(() => undefined);
        await stderr.close().catch(() => undefined);
      }
    };
  },

  async redactPlaywrightResults(playwrightJsonPath) {
    let raw: string;
    try {
      raw = await fs.readFile(playwrightJsonPath, "utf8");
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return { applied: false, modified: false, replacements: 0 };
      }
      throw error;
    }
    const scrubbed = redactWithStats(raw);
    if (scrubbed.value === raw) {
      return { applied: true, modified: false, replacements: 0 };
    }
    await fs.writeFile(playwrightJsonPath, scrubbed.value, "utf8");
    return { applied: true, modified: true, replacements: scrubbed.replacements };
  }
};
