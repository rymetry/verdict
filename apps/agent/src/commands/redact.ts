/**
 * Best-effort secret redaction for stdout/stderr/audit log content.
 * PoC §28: trace/log/report should not leak credentials. This is *not* a
 * security boundary on its own — Workbench still excludes sensitive files
 * from AI context — but provides defense in depth for streamed output.
 */

const PATTERNS: ReadonlyArray<{ regex: RegExp; replacement: string }> = [
  { regex: /(Bearer\s+)([A-Za-z0-9._\-+/=]{16,})/gi, replacement: "$1<REDACTED>" },
  { regex: /(Authorization:\s*)([A-Za-z0-9._\-+/=]{16,})/gi, replacement: "$1<REDACTED>" },
  { regex: /(api[_-]?key\s*[:=]\s*['"]?)([A-Za-z0-9._\-+/=]{16,})/gi, replacement: "$1<REDACTED>" },
  { regex: /(token\s*[:=]\s*['"]?)([A-Za-z0-9._\-+/=]{20,})/gi, replacement: "$1<REDACTED>" },
  { regex: /(password\s*[:=]\s*['"]?)([^\s'"]{6,})/gi, replacement: "$1<REDACTED>" },
  { regex: /\bsk-[A-Za-z0-9]{20,}\b/g, replacement: "<REDACTED>" },
  { regex: /\bghp_[A-Za-z0-9]{20,}\b/g, replacement: "<REDACTED>" }
];

export function redact(input: string): string {
  let out = input;
  for (const { regex, replacement } of PATTERNS) {
    out = out.replace(regex, replacement);
  }
  return out;
}
