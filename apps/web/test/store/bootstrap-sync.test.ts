// index.html の同期 FOUC bootstrap script は app-store.ts のキー / 値域 / 解決アルゴリズムを
// 手書きでミラーしている。リネームや値追加で片方だけ更新された場合の "サイレント FOUC 後退" を
// 検出するため、ファイル文字列レベルで同期 invariant を検査する。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { THEME_STORAGE_KEY } from "@/store/app-store";

const indexHtml = fs.readFileSync(
  path.resolve(__dirname, "../../index.html"),
  "utf8"
);

describe("index.html bootstrap synchronization", () => {
  it("THEME_STORAGE_KEY が bootstrap script に literal で含まれる", () => {
    expect(indexHtml).toContain(`"${THEME_STORAGE_KEY}"`);
  });

  it.each(["light", "dark", "auto"])("VALID_PREFERENCE %s が条件分岐に登場する", (pref) => {
    // bootstrap の値域チェック: `raw === "light" || raw === "dark" || raw === "auto"`
    expect(indexHtml).toMatch(new RegExp(`raw\\s*===\\s*"${pref}"`));
  });

  it("auto モード時に prefers-color-scheme:dark をクエリしている", () => {
    expect(indexHtml).toMatch(/matchMedia\s*\(\s*["']\(prefers-color-scheme:\s*dark\)["']\s*\)/);
  });

  it("resolved=='dark' のときだけ .dark クラスを付与する分岐がある", () => {
    expect(indexHtml).toMatch(/resolved\s*===\s*"dark"[\s\S]*classList\.add\s*\(\s*"dark"\s*\)/);
  });

  it("Private Mode 等の throw で white/light fixed に縮退する catch がある", () => {
    expect(indexHtml).toMatch(/catch\s*\(/);
  });
});
