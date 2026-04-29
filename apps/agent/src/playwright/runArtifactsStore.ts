import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
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

  /**
   * Phase 1.2 / T203-2: archive step of the detect/archive/copy lifecycle
   * (PLAN.v2 §22). Moves the entries currently in `sourceAbs` (the user's
   * `allure-results/*` from the previous run) into a fresh timestamped
   * subdirectory under `workbenchPaths(projectRoot).archiveDir`, leaving
   * `sourceAbs` empty (or non-existent) so the upcoming run starts clean.
   * Returns warnings (path-redacted) for the caller to surface via the
   * structured logger with `artifactKind: "allure-results"`. Caller is
   * responsible for invoking this only when the project uses Allure and
   * before launching the test process — race conditions during a live run
   * are not handled here.
   */
  archiveAllureResultsDir(
    projectRoot: string,
    sourceAbs: string
  ): Promise<ArchiveAllureOutcome>;

  /**
   * Phase 1.2 / T203-2: copy step of the detect/archive/copy lifecycle.
   * Recursively copies regular files from `sourceAbs` (the user's
   * `allure-results/*` produced during the just-completed run) to
   * `destAbs` (the run-scoped `allure-results/` per `runPathsFor`).
   * Symlinks are skipped with a warning (PLAN.v2 §28 path-redaction
   * policy: never follow symlinks blindly); non-regular files (devices,
   * sockets) are also skipped.
   */
  copyAllureResultsDir(
    sourceAbs: string,
    destAbs: string
  ): Promise<CopyAllureOutcome>;
}

export interface RedactionOutcome {
  applied: boolean;
  /** True if redaction actually changed the contents. */
  modified: boolean;
  replacements: number;
}

export interface ArchiveAllureOutcome {
  /** True iff at least one entry was moved out of `sourceAbs`. */
  archived: boolean;
  /** Absolute path of the timestamped archive directory; only set when
   *  `archived === true`. */
  archivePath?: string;
  /** Path-redacted operational warnings (e.g. skipped symlink count, partial
   *  failures). The caller emits the structured log entry with the run
   *  context and `artifactKind: "allure-results"`. */
  warnings: string[];
}

export interface CopyAllureOutcome {
  /** True iff at least one regular file was copied to `destAbs`. */
  copied: boolean;
  /** Number of regular files written under `destAbs`. */
  fileCount: number;
  /** Path-redacted operational warnings (skipped symlink count, partial
   *  failures, etc). */
  warnings: string[];
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
  },

  async archiveAllureResultsDir(projectRoot, sourceAbs) {
    return archiveAllureResultsImpl(projectRoot, sourceAbs);
  },

  async copyAllureResultsDir(sourceAbs, destAbs) {
    return copyAllureResultsImpl(sourceAbs, destAbs);
  }
};

/* ------------------------------------------------------------------------ */
/* Phase 1.2 helpers (T203-2): detect/archive/copy lifecycle implementation */
/* ------------------------------------------------------------------------ */

/**
 * Operational error codes that abort the archive/copy loop instead of being
 * accumulated into per-entry warnings. Mirrors `allureResultsReader.ts`
 * `FATAL_READ_CODES` precedent (extended for write-side fatals): when one
 * of these codes fires, the next entry will fail too, and aggregating into
 * a generic "N of M failed" warning hides the operator-action condition
 * (disk full / permission misconfig / FD exhaustion). Single throw → caller
 * emits one structured log with `errorLogFields(error)` + the appropriate
 * artifactKind.
 */
const FATAL_OPERATIONAL_CODES = new Set([
  // Read-side (also in allureResultsReader.ts)
  "EMFILE",
  "ENFILE",
  "EACCES",
  "EIO",
  // Write-side (additional, since archive/copy mutate filesystem)
  "ENOSPC", // out of disk
  "EDQUOT", // disk quota exceeded
  "EROFS"   // read-only filesystem
]);

function errorCodeOf(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? (error as NodeJS.ErrnoException).code
    : undefined;
}

function rethrowIfFatal(error: unknown): void {
  const code = errorCodeOf(error);
  if (code && FATAL_OPERATIONAL_CODES.has(code)) {
    throw error;
  }
  // Non-Error throws are programmer errors (a future code change passing
  // a non-Error accidentally). Always re-throw — there is no operational
  // code that can recover from `throw "string"`. Mirrors T202 review fix
  // (PR #36) for `JSON.parse` catch narrowing.
  if (!(error instanceof Error)) {
    throw error;
  }
}

function timestampSegment(): string {
  // ISO-8601 with `:` and `.` replaced for cross-platform safety. Sort
  // order in directory listings matches chronological order, which is
  // useful for operators eyeballing the archive directory.
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function readDirOrUndefined(dir: string): Promise<fsSync.Dirent[] | undefined> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }
}

async function archiveAllureResultsImpl(
  projectRoot: string,
  sourceAbs: string
): Promise<ArchiveAllureOutcome> {
  // Use `lstat` so a symlink at sourceAbs itself is not silently followed
  // into project-external territory (PLAN.v2 §28).
  let sourceStat: fsSync.Stats;
  try {
    sourceStat = await fs.lstat(sourceAbs);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      // Common case: previous run never wrote anything (or user wiped it).
      // Nothing to archive.
      return { archived: false, warnings: [] };
    }
    throw error;
  }
  if (sourceStat.isSymbolicLink()) {
    return {
      archived: false,
      warnings: [
        "allure-results source is a symlink; refusing to archive (path-redaction policy)."
      ]
    };
  }
  if (!sourceStat.isDirectory()) {
    return {
      archived: false,
      warnings: [
        "allure-results source exists but is not a directory; nothing archived."
      ]
    };
  }

  const entries = (await readDirOrUndefined(sourceAbs)) ?? [];
  if (entries.length === 0) {
    return { archived: false, warnings: [] };
  }

  const { archiveDir } = workbenchPaths(projectRoot);
  await fs.mkdir(archiveDir, { recursive: true });

  // Resolve a unique timestamped subdir. In the rare same-millisecond
  // collision (e.g. fast successive calls) append `-2`, `-3`, ...
  const baseChild = path.join(archiveDir, timestampSegment());
  let archiveChild = baseChild;
  for (let attempt = 2; attempt <= 99; attempt += 1) {
    try {
      await fs.mkdir(archiveChild);
      break;
    } catch (error) {
      const code = error instanceof Error && "code" in error
        ? (error as NodeJS.ErrnoException).code
        : undefined;
      if (code !== "EEXIST") throw error;
      archiveChild = `${baseChild}-${attempt}`;
    }
  }

  const warnings: string[] = [];
  let movedCount = 0;
  let symlinkSkipCount = 0;
  let failureCount = 0;
  let firstFailureCode: string | undefined;
  for (const entry of entries) {
    const srcEntry = path.join(sourceAbs, entry.name);
    const destEntry = path.join(archiveChild, entry.name);
    if (entry.isSymbolicLink()) {
      symlinkSkipCount += 1;
      continue;
    }
    try {
      await fs.rename(srcEntry, destEntry);
      movedCount += 1;
      continue;
    } catch (error) {
      // FATAL_OPERATIONAL_CODES (ENOSPC / EACCES / EIO / FD-exhaustion etc)
      // mean the next entry will fail too. Propagate so the caller sees one
      // actionable error rather than a flood of "N of M failed" warnings
      // that hide the operator-action condition. Mirrors T202 reader's
      // FATAL_READ_CODES precedent.
      rethrowIfFatal(error);
      const code = errorCodeOf(error);
      if (code === "EXDEV") {
        // Cross-device link: fall back to copy + unlink. Use the same
        // walk-based copier as the run-time copy step so symlinks inside
        // a directory subtree are skipped consistently (rather than
        // preserved verbatim by `fs.cp` `dereference: false`).
        const cpResult = await safeCpForArchive(srcEntry, destEntry, entry);
        if (cpResult.ok) {
          symlinkSkipCount += cpResult.symlinkSkipCount;
          try {
            await fs.rm(srcEntry, { recursive: true, force: true });
            movedCount += 1;
            continue;
          } catch (rmError) {
            // Source still has data; rollback the destination to avoid
            // leaving a half-moved entry on operator's filesystem.
            await fs.rm(destEntry, { recursive: true, force: true }).catch(() => undefined);
            rethrowIfFatal(rmError);
            failureCount += 1;
            if (!firstFailureCode) {
              firstFailureCode = errorCodeOf(rmError) ?? "EXDEV_RM_FAILED";
            }
            continue;
          }
        }
        // cp failed: roll back any partial dest before recording.
        await fs.rm(destEntry, { recursive: true, force: true }).catch(() => undefined);
        failureCount += 1;
        if (!firstFailureCode) firstFailureCode = cpResult.firstCode ?? "EXDEV_FALLBACK_FAILED";
        continue;
      }
      failureCount += 1;
      if (!firstFailureCode) firstFailureCode = code ?? "ARCHIVE_RENAME_FAILED";
    }
  }

  if (symlinkSkipCount > 0) {
    warnings.push(
      `Skipped ${symlinkSkipCount} symlink entr${symlinkSkipCount === 1 ? "y" : "ies"} during allure-results archive (path-redaction policy).`
    );
  }
  if (failureCount > 0) {
    warnings.push(
      `Failed to archive ${failureCount} of ${entries.length} entries during allure-results archive. firstCode=${firstFailureCode ?? "UNKNOWN"}.`
    );
  }

  // Total-failure cleanup: if nothing was moved, the timestamped subdir is
  // empty and would otherwise accumulate as orphaned data on every retry
  // (1000 empty dirs after 1000 runs of a recurring failure). Best-effort
  // rmdir; ignore errors since the failure path is already emitting a
  // warning and we don't want to mask it.
  if (movedCount === 0) {
    await fs.rmdir(archiveChild).catch(() => undefined);
  }

  return {
    archived: movedCount > 0,
    archivePath: movedCount > 0 ? archiveChild : undefined,
    warnings
  };
}

/**
 * Walk-based copy for archive's EXDEV fallback. For a file entry, does
 * `fs.copyFile`. For a directory entry, recursively walks via the same
 * `walkAndCopy` helper used by the run-time copy step (so symlinks
 * inside the subtree are skipped consistently rather than preserved
 * verbatim by `fs.cp`'s `dereference: false`).
 *
 * Returns `{ ok: false, firstCode }` on any per-file failure (caller
 * rolls back the partial dest) or `{ ok: true, symlinkSkipCount }`.
 */
async function safeCpForArchive(
  srcEntry: string,
  destEntry: string,
  entry: fsSync.Dirent
): Promise<
  | { ok: true; symlinkSkipCount: number }
  | { ok: false; firstCode: string | undefined }
> {
  if (!entry.isDirectory()) {
    // Regular file (the archive caller already filtered out symlinks at
    // this entry level).
    try {
      await fs.copyFile(srcEntry, destEntry);
      return { ok: true, symlinkSkipCount: 0 };
    } catch (error) {
      rethrowIfFatal(error);
      return { ok: false, firstCode: errorCodeOf(error) ?? "COPY_FAILED" };
    }
  }
  // Directory: walk recursively so symlinks inside are skipped consistently.
  let symlinkSkipCount = 0;
  let firstCode: string | undefined;
  let aborted = false;

  try {
    await fs.mkdir(destEntry, { recursive: true });
    await walkAndCopy(srcEntry, destEntry, {
      onFileCopied: () => undefined,
      onSymlinkSkipped: () => { symlinkSkipCount += 1; },
      onNonRegularSkipped: () => undefined,
      onFailure: (code) => {
        aborted = true;
        if (!firstCode) firstCode = code;
      }
    });
  } catch (error) {
    rethrowIfFatal(error);
    aborted = true;
    if (!firstCode) firstCode = errorCodeOf(error) ?? "WALK_FAILED";
  }

  if (aborted) return { ok: false, firstCode };
  return { ok: true, symlinkSkipCount };
}

async function copyAllureResultsImpl(
  sourceAbs: string,
  destAbs: string
): Promise<CopyAllureOutcome> {
  let sourceStat: fsSync.Stats;
  try {
    sourceStat = await fs.lstat(sourceAbs);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return { copied: false, fileCount: 0, warnings: [] };
    }
    throw error;
  }
  if (sourceStat.isSymbolicLink()) {
    return {
      copied: false,
      fileCount: 0,
      warnings: [
        "allure-results source is a symlink; refusing to copy (path-redaction policy)."
      ]
    };
  }
  if (!sourceStat.isDirectory()) {
    return {
      copied: false,
      fileCount: 0,
      warnings: [
        "allure-results source exists but is not a directory; nothing copied."
      ]
    };
  }

  await fs.mkdir(destAbs, { recursive: true });

  let fileCount = 0;
  let symlinkSkipCount = 0;
  let nonRegularSkipCount = 0;
  let failureCount = 0;
  let firstFailureCode: string | undefined;

  await walkAndCopy(sourceAbs, destAbs, {
    onFileCopied: () => { fileCount += 1; },
    onSymlinkSkipped: () => { symlinkSkipCount += 1; },
    onNonRegularSkipped: () => { nonRegularSkipCount += 1; },
    onFailure: (code) => {
      failureCount += 1;
      if (!firstFailureCode) firstFailureCode = code;
    }
  });

  const warnings: string[] = [];
  if (symlinkSkipCount > 0) {
    warnings.push(
      `Skipped ${symlinkSkipCount} symlink entr${symlinkSkipCount === 1 ? "y" : "ies"} during allure-results copy (path-redaction policy).`
    );
  }
  if (nonRegularSkipCount > 0) {
    warnings.push(
      `Skipped ${nonRegularSkipCount} non-regular file entr${nonRegularSkipCount === 1 ? "y" : "ies"} during allure-results copy (devices/sockets are not artifacts).`
    );
  }
  if (failureCount > 0) {
    warnings.push(
      `Failed to copy ${failureCount} entr${failureCount === 1 ? "y" : "ies"} during allure-results copy. firstCode=${firstFailureCode ?? "UNKNOWN"}.`
    );
  }

  return { copied: fileCount > 0, fileCount, warnings };
}

interface WalkAndCopyHandlers {
  onFileCopied: () => void;
  onSymlinkSkipped: () => void;
  onNonRegularSkipped: () => void;
  onFailure: (code: string) => void;
}

async function walkAndCopy(
  srcDir: string,
  destDir: string,
  handlers: WalkAndCopyHandlers
): Promise<void> {
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcEntry = path.join(srcDir, entry.name);
    const destEntry = path.join(destDir, entry.name);
    if (entry.isSymbolicLink()) {
      handlers.onSymlinkSkipped();
      continue;
    }
    if (entry.isDirectory()) {
      try {
        await fs.mkdir(destEntry, { recursive: true });
      } catch (error) {
        // FATAL_OPERATIONAL_CODES propagate (FD exhaustion / disk full /
        // permission denied / IO fault — next mkdir will fail too).
        rethrowIfFatal(error);
        handlers.onFailure(errorCodeOf(error) ?? "MKDIR_FAILED");
        continue;
      }
      await walkAndCopy(srcEntry, destEntry, handlers);
      continue;
    }
    if (!entry.isFile()) {
      handlers.onNonRegularSkipped();
      continue;
    }
    try {
      await fs.copyFile(srcEntry, destEntry);
      handlers.onFileCopied();
    } catch (error) {
      // Process-level fatals propagate; per-file races (e.g. file
      // disappeared mid-copy) become per-entry warnings.
      rethrowIfFatal(error);
      handlers.onFailure(errorCodeOf(error) ?? "COPY_FAILED");
    }
  }
}
