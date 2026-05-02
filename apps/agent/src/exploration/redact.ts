import {
  ExplorationScreenModelDraftSchema,
  type ExplorationScreenModelDraft
} from "@pwqa/shared";
import { redact } from "../commands/redact.js";

const SENSITIVE_QUERY_PARAM_PATTERN =
  /([?&][^=\s"'<>]*(?:token|secret|password|api[_-]?key|auth|credential|session)[^=\s"'<>]*=)[^&\s"'<>]+/gi;

const TOKEN_PATTERNS: ReadonlyArray<RegExp> = [
  /\bsk-(?:proj|svcacct)-[A-Za-z0-9_-]{10,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g
];

const LOCAL_PATH_PATTERNS: ReadonlyArray<{ regex: RegExp; replacement: string }> = [
  {
    regex:
      /(^|[\s"'(=<>])\/(?:Users|home|tmp|private|var|etc|root|opt|mnt|Volumes|srv|usr|bin|sbin|lib|System|Applications)\/[^\s"'<>)]*/g,
    replacement: "$1<REDACTED_PATH>"
  },
  {
    regex:
      /\/(?:Users|home|tmp|private|var|etc|root|opt|mnt|Volumes|srv|usr|bin|sbin|lib|System|Applications)\/[^\s"'<>)]*/g,
    replacement: "<REDACTED_PATH>"
  },
  { regex: /[A-Za-z]:\\[^\s"'<>)]*/g, replacement: "<REDACTED_PATH>" },
  { regex: /\\\\[A-Za-z0-9._$-]+\\[^\s"'<>)]*/g, replacement: "<REDACTED_PATH>" },
  { regex: /\\(?:Users|home|tmp|private|var|etc|root|opt|mnt|Volumes|srv|usr)\\[^\s"'<>)]*/g, replacement: "<REDACTED_PATH>" }
];

const PASSWORD_INPUT_PATTERNS: ReadonlyArray<RegExp> = [
  /(<input\b[^>]*\btype=["']password["'][^>]*\bvalue=["'])([^"']*)(["'][^>]*>)/gi,
  /(<input\b[^>]*\bvalue=["'])([^"']*)(["'][^>]*\btype=["']password["'][^>]*>)/gi
];

export function sanitizeExplorationScreenModel(
  screenModel: ExplorationScreenModelDraft,
  projectRoot?: string
): ExplorationScreenModelDraft {
  const sanitized = deepMapStrings(screenModel, (value) =>
    redactExplorationString(value, projectRoot)
  );
  return ExplorationScreenModelDraftSchema.parse(sanitized);
}

function deepMapStrings(value: unknown, map: (value: string) => string): unknown {
  if (typeof value === "string") return map(value);
  if (Array.isArray(value)) return value.map((entry) => deepMapStrings(entry, map));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [map(key), deepMapStrings(nested, map)])
    );
  }
  return value;
}

function redactExplorationString(value: string, projectRoot: string | undefined): string {
  let output = redact(value).replace(SENSITIVE_QUERY_PARAM_PATTERN, "$1<REDACTED>");
  for (const pattern of TOKEN_PATTERNS) {
    output = output.replace(pattern, "<REDACTED>");
  }
  if (projectRoot) {
    output = output.split(projectRoot).join("<REDACTED_PATH>");
  }
  for (const { regex, replacement } of LOCAL_PATH_PATTERNS) {
    output = output.replace(regex, replacement);
  }
  for (const pattern of PASSWORD_INPUT_PATTERNS) {
    output = output.replace(pattern, "$1<REDACTED>$3");
  }
  return output;
}
