import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { type QualityGateProfile } from "@pwqa/shared";

/**
 * §1.4 Profile-driven Quality Gate rules.
 *
 * Three built-in profiles (PLAN.v2 §23):
 *   - `local-review`: zero failed tests and at least one test. Default for
 *     ad-hoc runs.
 *   - `release-smoke`: zero tolerance — `maxFailures=0`, `successRate=100`,
 *     `fastFail=true`. Used when validating a release candidate.
 *   - `full-regression`: ≥95% pass rate, fail soft (no fast-fail). Used
 *     for nightly regression runs that surface multiple issues at once.
 *
 * Operators can override any field via
 * `<projectRoot>/.playwright-workbench/config/quality-gate-profiles.json`.
 * The file is optional — absence means built-in defaults apply.
 */

export interface QualityGateRules {
  maxFailures?: number;
  minTestsCount?: number;
  successRate?: number;
  fastFail?: boolean;
}

const QualityGateRulesSchema = z.object({
  maxFailures: z.number().int().nonnegative().optional(),
  minTestsCount: z.number().int().nonnegative().optional(),
  successRate: z.number().min(0).max(100).optional(),
  fastFail: z.boolean().optional(),
});

// `z.object().strict()` rejects unknown keys (e.g. typos like "release_smoke")
// while keeping each profile field optional, so an override file may
// supply rules for one or many profiles in any combination.
const QualityGateProfileConfigSchema = z
  .object({
    "local-review": QualityGateRulesSchema.optional(),
    "release-smoke": QualityGateRulesSchema.optional(),
    "full-regression": QualityGateRulesSchema.optional(),
  })
  .strict();

export type QualityGateProfileConfig = z.infer<
  typeof QualityGateProfileConfigSchema
>;

const BUILT_IN_DEFAULTS: Record<QualityGateProfile, QualityGateRules> = {
  "local-review": {
    maxFailures: 0,
    minTestsCount: 1,
  },
  "release-smoke": {
    maxFailures: 0,
    successRate: 100,
    fastFail: true,
  },
  "full-regression": {
    successRate: 95,
  },
};

export const QUALITY_GATE_PROFILE_CONFIG_REL = path.join(
  ".playwright-workbench",
  "config",
  "quality-gate-profiles.json",
);

const CONFIG_SIZE_CAP_BYTES = 64 * 1024;

export interface ResolvedQualityGateRules {
  profile: QualityGateProfile;
  rules: QualityGateRules;
  warnings: string[];
}

/**
 * Read + validate the optional override file. Returns undefined when the
 * file is absent (no warning). Surfaces structured warnings for
 * malformed / oversized / unreadable files so the operator gets a single
 * clear cause; the run still proceeds with built-in defaults.
 */
export async function loadQualityGateProfileConfig(
  projectRoot: string,
): Promise<{
  config?: QualityGateProfileConfig;
  warnings: string[];
}> {
  const file = path.join(projectRoot, QUALITY_GATE_PROFILE_CONFIG_REL);
  let raw: string;
  try {
    const stat = await fs.stat(file);
    if (stat.size > CONFIG_SIZE_CAP_BYTES) {
      return {
        warnings: [
          `Quality-gate profile config exceeds ${CONFIG_SIZE_CAP_BYTES} bytes; ignoring.`,
        ],
      };
    }
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    const code =
      error instanceof Error && "code" in error && typeof error.code === "string"
        ? error.code
        : undefined;
    if (code === "ENOENT") {
      return { warnings: [] };
    }
    return {
      warnings: [
        `Quality-gate profile config could not be read. code=${code ?? "READ_FAILED"}`,
      ],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      warnings: [
        "Quality-gate profile config is not valid JSON; using built-in defaults.",
      ],
    };
  }

  const result = QualityGateProfileConfigSchema.safeParse(parsed);
  if (!result.success) {
    return {
      warnings: [
        `Quality-gate profile config has unexpected shape: ${result.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
      ],
    };
  }
  return { config: result.data, warnings: [] };
}

/**
 * Resolve the effective rules for a profile by merging built-in defaults
 * with the optional override file. Override fields take precedence; any
 * field absent from the override falls through to the built-in.
 */
export async function resolveQualityGateRules(
  projectRoot: string,
  profile: QualityGateProfile,
): Promise<ResolvedQualityGateRules> {
  const { config, warnings } = await loadQualityGateProfileConfig(projectRoot);
  const builtIn = BUILT_IN_DEFAULTS[profile];
  const override = config?.[profile];
  const rules: QualityGateRules = override
    ? { ...builtIn, ...override }
    : { ...builtIn };
  return { profile, rules, warnings };
}

/**
 * Static accessor for the built-in defaults. Exposed for tests and for
 * UI rendering (so the profile selector can show what each profile means).
 */
export function defaultRulesForProfile(
  profile: QualityGateProfile,
): QualityGateRules {
  return { ...BUILT_IN_DEFAULTS[profile] };
}
