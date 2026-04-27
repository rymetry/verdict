// デザイントークンの不変条件テスト。
// `globals.css` の oklch 値からステータス色相 (pass=142°, fail=27°, flaky=75°, accent=156°)
// が design source-of-truth から逸脱していないことを保証する。色相分離が崩れると
// 色覚多様性下での識別性が失われるため、この invariant は意図せず変えてはいけない。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const cssPath = path.resolve(here, "../../src/styles/globals.css");
const css = readFileSync(cssPath, "utf8");

/** ライトモード (`:root { ... }`) のブロック中で `--name: oklch(L C H ...)` の H を抽出 */
function extractLightHue(token: string): number | null {
  // :root { ... } の中だけを対象にする
  const rootMatch = css.match(/:root\s*\{([\s\S]*?)\n\}/);
  if (!rootMatch) return null;
  const body = rootMatch[1];
  const re = new RegExp(`--${token}:\\s*oklch\\(\\s*[\\d.]+\\s+[\\d.]+\\s+([\\d.]+)`);
  const m = body.match(re);
  return m ? Number(m[1]) : null;
}

describe("design tokens (globals.css)", () => {
  it("ライトモード --pass の hue は 142° (緑系)", () => {
    expect(extractLightHue("pass")).toBe(142);
  });

  it("ライトモード --fail の hue は 27° (赤系)", () => {
    expect(extractLightHue("fail")).toBe(27);
  });

  it("ライトモード --flaky の hue は 75° (黄系)", () => {
    expect(extractLightHue("flaky")).toBe(75);
  });

  it("ライトモード --accent と --cta の hue は 156° (ブランド ティール緑)", () => {
    expect(extractLightHue("accent")).toBe(156);
    expect(extractLightHue("cta")).toBe(156);
  });

  it("pass と accent の色相は 14° 以上離れている (色覚多様性下の識別性)", () => {
    const pass = extractLightHue("pass");
    const accent = extractLightHue("accent");
    expect(pass).not.toBeNull();
    expect(accent).not.toBeNull();
    expect(Math.abs(accent! - pass!)).toBeGreaterThanOrEqual(14);
  });
});
