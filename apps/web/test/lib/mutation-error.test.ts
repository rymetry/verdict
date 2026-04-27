// formatMutationError は WorkbenchApiError / Error / それ以外で表示文字列を変える純粋関数。
import { describe, expect, it } from "vitest";

import { WorkbenchApiError } from "@/api/client";
import { formatMutationError } from "@/lib/mutation-error";

describe("formatMutationError", () => {
  it("WorkbenchApiError は code: message 形式に整形する", () => {
    const err = new WorkbenchApiError("Run is blocked", "RUN_BLOCKED", 409);
    expect(formatMutationError(err, "fallback")).toBe("RUN_BLOCKED: Run is blocked");
  });

  it("通常 Error は message を返す", () => {
    const err = new Error("network down");
    expect(formatMutationError(err, "fallback")).toBe("network down");
  });

  it("Error 以外 (string throw など) は fallback を返す", () => {
    expect(formatMutationError("oops", "再実行に失敗しました")).toBe("再実行に失敗しました");
    expect(formatMutationError(null, "再実行に失敗しました")).toBe("再実行に失敗しました");
    expect(formatMutationError(undefined, "再実行に失敗しました")).toBe("再実行に失敗しました");
    expect(formatMutationError(42, "再実行に失敗しました")).toBe("再実行に失敗しました");
  });

  it("空 message の Error は fallback に倒す", () => {
    const err = new Error("");
    expect(formatMutationError(err, "再実行に失敗しました")).toBe("再実行に失敗しました");
  });

  it("空 message の WorkbenchApiError は code: fallback の形式にする", () => {
    const err = new WorkbenchApiError("", "TIMEOUT", 408);
    expect(formatMutationError(err, "再実行に失敗しました")).toBe("TIMEOUT: 再実行に失敗しました");
  });
});
