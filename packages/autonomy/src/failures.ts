import type { FailureClass } from "./types.js";

export function classifyToolFailure(stderr: string): FailureClass {
  const text = stderr.toLowerCase();
  if (text.includes("etimedout") || text.includes("timed out waiting for agent")) {
    return "CODEX_HANG";
  }
  if (/\b(auth|authentication|login|logged in|credential|permission denied)\b/.test(text)) {
    return "TOOL_AUTH_FAILURE";
  }
  if (
    text.includes("could not resolve host") ||
    text.includes("network") ||
    text.includes("econnreset") ||
    text.includes("enotfound") ||
    text.includes("timeout") ||
    text.includes("timed out") ||
    text.includes("error connecting to api.github.com")
  ) {
    return "TOOL_NETWORK_FAILURE";
  }
  if (text.includes("typecheck") || text.includes("tsc") || text.includes("type error")) {
    return "RECURRING_TYPE_ERROR";
  }
  if (text.includes("scope") || text.includes("out of scope")) {
    return "RECURRING_SCOPE_VIOLATION";
  }
  return "UNCLASSIFIED";
}
