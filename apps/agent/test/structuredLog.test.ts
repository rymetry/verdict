import { describe, expect, it } from "vitest";
import { errorCode, errorLogFields, projectIdHash } from "../src/lib/structuredLog.js";
import { AuditPersistenceError } from "../src/lib/errors.js";

describe("errorCode", () => {
  it("returns the .code property when error is an Error with a string code", () => {
    const error = Object.assign(new Error("ENOENT: open '/Users/secret/x'"), {
      code: "ENOENT"
    });
    expect(errorCode(error)).toBe("ENOENT");
  });

  it("returns 'UNKNOWN' for plain Error without a code", () => {
    expect(errorCode(new Error("plain"))).toBe("UNKNOWN");
  });

  it("returns 'UNKNOWN' for non-string codes (numeric errno)", () => {
    const error = Object.assign(new Error("x"), { code: 42 });
    expect(errorCode(error)).toBe("UNKNOWN");
  });

  it("returns 'UNKNOWN' for non-Error thrown values", () => {
    expect(errorCode(null)).toBe("UNKNOWN");
    expect(errorCode(undefined)).toBe("UNKNOWN");
    expect(errorCode("string thrown")).toBe("UNKNOWN");
    expect(errorCode(42)).toBe("UNKNOWN");
  });
});

describe("errorLogFields", () => {
  describe("fail-closed default (Issue #27): drops error.message", () => {
    it("drops message from ErrnoException-style errors that carry filesystem paths", () => {
      const error = Object.assign(
        new Error("ENOENT: no such file or directory, open '/Users/rym/secret/file.json'"),
        { code: "ENOENT" }
      );
      const result = errorLogFields(error);
      expect(result).toEqual({ code: "ENOENT", errorName: "Error" });
      expect(result).not.toHaveProperty("err");
      // Defense in depth: nothing in the JSON form should hint at the path.
      expect(JSON.stringify(result)).not.toContain("/Users/rym/secret");
    });

    it("drops message from plain Error with path-bearing message (no .code)", () => {
      // M-1 regression case: persistAuditEntry throws plain Error with path.
      const error = new Error(
        "audit directory is not a safe directory: /Users/rym/Dev/.../.playwright-workbench"
      );
      const result = errorLogFields(error);
      expect(result).toEqual({ code: "UNKNOWN", errorName: "Error" });
      expect(JSON.stringify(result)).not.toContain("/Users/rym/Dev");
      expect(result).not.toHaveProperty("err");
    });

    it("drops message from domain errors carrying static error codes (and surfaces cause code)", () => {
      const cause = Object.assign(new Error("EACCES: permission denied, open '/x'"), {
        code: "EACCES"
      });
      const wrapped = new AuditPersistenceError(cause);
      const result = errorLogFields(wrapped);
      // causeCode surfacing is exercised here; full coverage in the dedicated
      // `error.cause surfacing (causeCode)` describe block below.
      expect(result).toEqual({
        code: "AUDIT_PERSIST_FAILED",
        errorName: "AuditPersistenceError",
        causeCode: "EACCES"
      });
      expect(result).not.toHaveProperty("err");
    });

    it("preserves errorName for class-level operator triage", () => {
      class CustomError extends Error {
        override readonly name = "CustomError";
      }
      expect(errorLogFields(new CustomError("ignored"))).toEqual({
        code: "UNKNOWN",
        errorName: "CustomError"
      });
    });

    it("returns errorName='Error' for plain Error", () => {
      expect(errorLogFields(new Error("ignored"))).toEqual({
        code: "UNKNOWN",
        errorName: "Error"
      });
    });

    it("returns errorName as typeof for non-Error thrown values", () => {
      expect(errorLogFields(null)).toEqual({ code: "UNKNOWN", errorName: "object" });
      expect(errorLogFields("oops")).toEqual({ code: "UNKNOWN", errorName: "string" });
      expect(errorLogFields(42)).toEqual({ code: "UNKNOWN", errorName: "number" });
      expect(errorLogFields(undefined)).toEqual({ code: "UNKNOWN", errorName: "undefined" });
    });
  });

  describe("opt-in keepMessage: true", () => {
    it("preserves message for Error when keepMessage: true", () => {
      const error = new Error("validation failed: sequence: Required");
      expect(errorLogFields(error, { keepMessage: true })).toEqual({
        code: "UNKNOWN",
        errorName: "Error",
        err: "validation failed: sequence: Required"
      });
    });

    it("preserves message AND code for Error with .code when keepMessage: true", () => {
      const error = Object.assign(new Error("bad request"), { code: "VALIDATION_FAILED" });
      expect(errorLogFields(error, { keepMessage: true })).toEqual({
        code: "VALIDATION_FAILED",
        errorName: "Error",
        err: "bad request"
      });
    });

    it("stringifies non-Error thrown values when keepMessage: true", () => {
      expect(errorLogFields("string thrown", { keepMessage: true })).toEqual({
        code: "UNKNOWN",
        errorName: "string",
        err: "string thrown"
      });
      expect(errorLogFields(42, { keepMessage: true })).toEqual({
        code: "UNKNOWN",
        errorName: "number",
        err: "42"
      });
      expect(errorLogFields(null, { keepMessage: true })).toEqual({
        code: "UNKNOWN",
        errorName: "object",
        err: "null"
      });
    });
  });

  describe("spread-safety", () => {
    it("returns a fresh object on each call (no mutation aliasing)", () => {
      const a = errorLogFields(new Error("a"));
      const b = errorLogFields(new Error("b"));
      expect(a).not.toBe(b);
    });

    it("merges cleanly via object spread without losing surrounding fields", () => {
      const error = Object.assign(new Error("ignored"), { code: "ENOENT" });
      const payload = { runId: "run-1", artifactKind: "playwright-json", ...errorLogFields(error) };
      expect(payload).toEqual({
        runId: "run-1",
        artifactKind: "playwright-json",
        code: "ENOENT",
        errorName: "Error"
      });
    });
  });

  describe("error.cause surfacing (causeCode)", () => {
    it("surfaces inner cause code when wrapped error has Error cause with .code", () => {
      const cause = Object.assign(new Error("EACCES: open '/secret'"), { code: "EACCES" });
      const wrapper = new AuditPersistenceError(cause);
      const result = errorLogFields(wrapper);
      expect(result).toEqual({
        code: "AUDIT_PERSIST_FAILED",
        errorName: "AuditPersistenceError",
        causeCode: "EACCES"
      });
      expect(result).not.toHaveProperty("err");
      expect(JSON.stringify(result)).not.toContain("/secret");
    });

    it("omits causeCode when cause has no recognizable code", () => {
      const cause = new Error("plain inner");
      const wrapper = new AuditPersistenceError(cause);
      const result = errorLogFields(wrapper);
      expect(result).not.toHaveProperty("causeCode");
    });

    it("omits causeCode for non-Error cause values", () => {
      const wrapper = new Error("outer");
      // Force non-Error cause shape that the helper should not surface.
      Object.assign(wrapper, { cause: "literal cause" });
      const result = errorLogFields(wrapper);
      expect(result).not.toHaveProperty("causeCode");
    });

    it("preserves cause surfacing alongside keepMessage: true", () => {
      const cause = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      const wrapper = new AuditPersistenceError(cause);
      const result = errorLogFields(wrapper, { keepMessage: true });
      expect(result).toEqual({
        code: "AUDIT_PERSIST_FAILED",
        errorName: "AuditPersistenceError",
        err: "Audit persistence failed",
        causeCode: "ENOENT"
      });
    });
  });
});

describe("projectIdHash", () => {
  it("returns a deterministic 8-character hex token", () => {
    const projectId = "/Users/rym/Dev/foo";
    const hash = projectIdHash(projectId);
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
    expect(projectIdHash(projectId)).toBe(hash);
  });

  it("produces different outputs for different inputs", () => {
    expect(projectIdHash("/Users/a/x")).not.toBe(projectIdHash("/Users/b/x"));
    expect(projectIdHash("")).not.toBe(projectIdHash("a"));
  });

  it("does not leak any character of the input path", () => {
    const projectId = "/Users/rym/Dev/secret-project";
    const hash = projectIdHash(projectId);
    expect(hash).not.toContain("/");
    expect(hash).not.toContain("Users");
    expect(hash).not.toContain("rym");
    expect(hash).not.toContain("secret");
  });

  it("handles empty string without throwing", () => {
    expect(() => projectIdHash("")).not.toThrow();
    expect(projectIdHash("")).toMatch(/^[0-9a-f]{8}$/);
  });
});
