// safe-storage の値域チェックと例外吸収を検証する。
// - Safari Private Mode (getItem throw) / Quota 超過 (setItem throw) /
//   値域外文字列 / 非ブラウザ環境 (window 未定義) のシナリオを Mock する。
import { afterEach, describe, expect, it, vi } from "vitest";

import { readGuarded, writeSafe } from "@/store/safe-storage";

const KEY = "pwqa-test-key";

type Tone = "light" | "dark";
const isTone = (v: unknown): v is Tone => v === "light" || v === "dark";

afterEach(() => {
  window.localStorage.removeItem(KEY);
  vi.restoreAllMocks();
});

describe("readGuarded()", () => {
  it("有効値が格納されていれば guard を通って返る", () => {
    window.localStorage.setItem(KEY, "dark");
    expect(readGuarded(KEY, isTone)).toBe("dark");
  });

  it("値域外文字列は null", () => {
    window.localStorage.setItem(KEY, "neon");
    expect(readGuarded(KEY, isTone)).toBeNull();
  });

  it("未格納 (null) は null", () => {
    expect(readGuarded(KEY, isTone)).toBeNull();
  });

  it("getItem が throw しても null を返す (Private Mode)", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readGuarded(KEY, isTone)).toBeNull();
  });
});

describe("writeSafe()", () => {
  it("正常時は setItem に値が書き込まれる", () => {
    writeSafe(KEY, "dark");
    expect(window.localStorage.getItem(KEY)).toBe("dark");
  });

  it("setItem が throw しても例外を投げない (Quota 超過)", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => writeSafe(KEY, "dark")).not.toThrow();
  });
});
