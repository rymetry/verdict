// cn() ヘルパのスモークテスト。
// tailwind-merge の "後勝ち" 挙動はライブラリ更新で変わると影響範囲が広いため、
// 1 ケースだけ retainer として保持する。
import { describe, expect, it } from "vitest";

import { cn } from "@/lib/utils";

describe("cn()", () => {
  it("条件付きクラスを結合する", () => {
    expect(cn("a", false && "b", "c")).toBe("a c");
  });

  it("競合する Tailwind クラスは後勝ちで統合される (tailwind-merge)", () => {
    // p-2 と p-4 が両方残らず、後者だけが残ること
    expect(cn("p-2", "p-4")).toBe("p-4");
  });
});
