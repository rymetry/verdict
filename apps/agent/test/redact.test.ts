import { describe, it, expect } from "vitest";
import { redact, redactWithStats } from "../src/commands/redact.js";

describe("redactWithStats", () => {
  it("returns unchanged value and zero replacements for empty input", () => {
    const result = redactWithStats("");
    expect(result).toEqual({ value: "", replacements: 0 });
  });

  it("returns unchanged value and zero replacements when no secrets match", () => {
    const input = "hello world, no secrets here";
    const result = redactWithStats(input);
    expect(result).toEqual({ value: input, replacements: 0 });
  });

  it("counts a single GitHub PAT replacement", () => {
    const result = redactWithStats("token=ghp_abcdefghijklmnopqrstuvwxyz1234");
    expect(result.replacements).toBe(1);
    expect(result.value).not.toContain("ghp_");
    expect(result.value).toContain("<REDACTED>");
  });

  it("counts multiple distinct secrets", () => {
    const input = [
      "Authorization: Bearer abc123def456ghij",
      "api_key=sk-proj12345678901234567890"
    ].join("\n");
    const result = redactWithStats(input);
    expect(result.replacements).toBeGreaterThanOrEqual(2);
    expect(result.value).not.toContain("abc123def456ghij");
    expect(result.value).not.toContain("sk-proj12345678901234567890");
  });

  it("redact() wrapper returns only the string value", () => {
    const input = "api_key=ghp_abcdefghijklmnopqrstuvwxyz1234";
    const result = redact(input);
    expect(typeof result).toBe("string");
    expect(result).not.toContain("ghp_");
  });

  it("redacts JWT tokens", () => {
    // Avoid `token:` prefix here because the generic `token` pattern matches
    // before the JWT-specific one and would short-circuit the JWT replacement.
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const result = redactWithStats(`payload ${jwt} suffix`);
    expect(result.replacements).toBeGreaterThanOrEqual(1);
    expect(result.value).not.toContain(jwt);
    expect(result.value).toContain("<REDACTED-JWT>");
  });

  it("locks in pattern ordering: generic 'token:' wins over JWT-specific pattern", () => {
    // Pattern order in `PATTERNS` is load-bearing. The generic `token=...`
    // regex precedes the JWT-specific one, so `token: <jwt>` is replaced with
    // the generic `<REDACTED>` token rather than `<REDACTED-JWT>`. If a future
    // maintainer reorders patterns or loosens char classes, this test forces
    // a deliberate decision on whether the new classification is intended.
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const result = redactWithStats(`token: ${jwt}`);
    expect(result.value).not.toContain(jwt);
    expect(result.value).toContain("<REDACTED>");
    expect(result.value).not.toContain("<REDACTED-JWT>");
  });

  it("redacts PEM private key blocks", () => {
    const pem = [
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEowIBAAKCAQEA1234567890abcdef",
      "-----END RSA PRIVATE KEY-----"
    ].join("\n");
    const result = redactWithStats(`leaked:\n${pem}\nend`);
    expect(result.replacements).toBeGreaterThanOrEqual(1);
    expect(result.value).not.toContain("MIIEowIBAAKCAQEA1234567890abcdef");
    expect(result.value).toContain("<REDACTED-PEM>");
  });
});
