/**
 * Best-effort secret redaction for stdout/stderr/audit log content.
 * PoC §28: trace/log/report should not leak credentials. This is *not* a
 * security boundary on its own — Workbench still excludes sensitive files
 * from AI context — but provides defense in depth for streamed output.
 */

const PATTERNS: ReadonlyArray<{ regex: RegExp; replacement: string }> = [
  { regex: /(Authorization:\s*(?:Bearer|Basic|Token)\s+)([A-Za-z0-9+/=._\-]{8,})/gi, replacement: "$1<REDACTED>" },
  { regex: /(Authorization:\s*)([A-Za-z0-9._\-+/=]{16,})/gi, replacement: "$1<REDACTED>" },
  { regex: /(api[_-]?key\s*[:=]\s*['"]?)([A-Za-z0-9._\-+/=]{16,})/gi, replacement: "$1<REDACTED>" },
  { regex: /(token\s*[:=]\s*['"]?)([A-Za-z0-9._\-+/=]{20,})/gi, replacement: "$1<REDACTED>" },
  { regex: /(password\s*[:=]\s*['"]?)([^\s'"]{6,})/gi, replacement: "$1<REDACTED>" },
  { regex: /(aws_secret_access_key\s*[:=]\s*['"]?)([A-Za-z0-9/+]{40})/gi, replacement: "$1<REDACTED>" },
  { regex: /(aws_session_token\s*[:=]\s*['"]?)([A-Za-z0-9/+=]{20,})/gi, replacement: "$1<REDACTED>" },
  // Provider-specific token prefixes:
  { regex: /\bsk-[A-Za-z0-9]{20,}\b/g, replacement: "<REDACTED>" },
  { regex: /\bghp_[A-Za-z0-9]{20,}\b/g, replacement: "<REDACTED>" },
  { regex: /\bgho_[A-Za-z0-9]{20,}\b/g, replacement: "<REDACTED>" },
  { regex: /\bghu_[A-Za-z0-9]{20,}\b/g, replacement: "<REDACTED>" },
  { regex: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, replacement: "<REDACTED>" },
  { regex: /\bnpm_[A-Za-z0-9]{20,}\b/g, replacement: "<REDACTED>" },
  { regex: /\bxox[bpoart]-[A-Za-z0-9-]{20,}\b/g, replacement: "<REDACTED>" },
  // JWT (three base64url segments separated by '.'):
  { regex: /\beyJ[A-Za-z0-9_\-]+\.eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\b/g, replacement: "<REDACTED-JWT>" },
  // PEM private keys (header line):
  { regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replacement: "<REDACTED-PEM>" }
];

export interface RedactionResult {
  readonly value: string;
  readonly replacements: number;
}

export function redactWithStats(input: string): RedactionResult {
  let out = input;
  let replacements = 0;
  for (const { regex, replacement } of PATTERNS) {
    const countRegex = new RegExp(regex.source, regex.flags);
    replacements += Array.from(out.matchAll(countRegex)).length;
    out = out.replace(regex, replacement);
  }
  return { value: out, replacements };
}

export function redact(input: string): string {
  return redactWithStats(input).value;
}
