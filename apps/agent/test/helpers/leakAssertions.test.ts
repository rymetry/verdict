import { describe, expect, it } from "vitest";
import { expectNoPathLeak } from "./leakAssertions.js";

// Issue #30 項目 B follow-up: 本 helper は path-redaction の最後の砦として
// 既存テストに組み込まれるため、デフォルト挙動と明示時の置換セマンティクス
// (extend ではなく replace) を unit test で凍結する。
//
// 失敗時に AssertionError が投げられることを確認するためには `expect(() => ...).toThrow()`
// で wrap する必要がある。helper 内部の `expect(...)` 呼び出しは vitest のグローバル
// expect を使うため、negative case でも throw でテスト可能。

describe("expectNoPathLeak", () => {
  describe("default forbiddenKeys = ['err']", () => {
    it("passes when payloads contain none of the given paths and no 'err' field", () => {
      const payloads = [
        { runId: "r1", code: "ENOENT", artifactKind: "stdout-log" },
        { runId: "r1", code: "EBADF", artifactKind: "stderr-log" }
      ];
      expect(() =>
        expectNoPathLeak(payloads, ["/Users/secret", "/private/x"])
      ).not.toThrow();
    });

    it("fails when any payload's JSON contains a forbidden path", () => {
      const payloads = [
        { runId: "r1", path: "/Users/secret/file.json" } as Record<string, unknown>
      ];
      expect(() => expectNoPathLeak(payloads, ["/Users/secret"])).toThrow();
    });

    it("checks each path independently (single leak in collection is enough to fail)", () => {
      const payloads = [
        { runId: "r1", clean: "ok" },
        { runId: "r2", leak: "/leaked/path" } as Record<string, unknown>
      ];
      // Path "/missing" is absent (clean); "/leaked/path" leaks. Helper must fail.
      expect(() =>
        expectNoPathLeak(payloads, ["/missing", "/leaked/path"])
      ).toThrow();
    });

    it("fails by default when any entry has an 'err' field", () => {
      const payloads = [
        { runId: "r1", code: "ENOENT" },
        { runId: "r1", code: "EBADF", err: "some message" }
      ];
      expect(() => expectNoPathLeak(payloads, [])).toThrow();
    });
  });

  describe("explicit forbiddenKeys: replace, not extend", () => {
    it("with forbiddenKeys: ['playwrightJsonPath'], does NOT enforce 'err' (proves replace semantics)", () => {
      // If the helper extended the default (instead of replacing), this would
      // fail because 'err' is present. Replacing means the caller's array is
      // exhaustive — useful here as a footgun-detector regression.
      const payloads = [{ runId: "r1", err: "explicitly-allowed" }];
      expect(() =>
        expectNoPathLeak(payloads, [], { forbiddenKeys: ["playwrightJsonPath"] })
      ).not.toThrow();
    });

    it("with forbiddenKeys: ['err', 'playwrightJsonPath'], catches both keys (typical site usage)", () => {
      const payloads = [{ runId: "r1", playwrightJsonPath: "/leaked.json" }];
      expect(() =>
        expectNoPathLeak(payloads, [], {
          forbiddenKeys: ["err", "playwrightJsonPath"]
        })
      ).toThrow();
    });

    it("with forbiddenKeys: [], skips per-entry key checks entirely", () => {
      // Empty array is a valid contract — caller has opted out of all key
      // enforcement. Useful for "JSON-only" path checks (info-level logs).
      const payloads = [{ runId: "r1", err: "intentionally allowed" }];
      expect(() => expectNoPathLeak(payloads, [], { forbiddenKeys: [] })).not.toThrow();
    });
  });

  describe("nullish coalescing for forbiddenKeys", () => {
    it("undefined options falls back to default ['err']", () => {
      const payloads = [{ runId: "r1", err: "leak" }];
      expect(() => expectNoPathLeak(payloads, [])).toThrow();
    });

    it("undefined forbiddenKeys (explicit) falls back to default ['err']", () => {
      const payloads = [{ runId: "r1", err: "leak" }];
      expect(() =>
        expectNoPathLeak(payloads, [], { forbiddenKeys: undefined })
      ).toThrow();
    });
  });

  describe("empty inputs", () => {
    it("passes for empty payloads regardless of paths", () => {
      expect(() => expectNoPathLeak([], ["/anywhere"])).not.toThrow();
    });

    it("passes for empty paths if no entry has forbidden keys", () => {
      expect(() => expectNoPathLeak([{ runId: "r1" }], [])).not.toThrow();
    });
  });
});
