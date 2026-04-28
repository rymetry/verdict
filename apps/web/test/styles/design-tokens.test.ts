// デザイントークンの不変条件テスト。
// `globals.css` の oklch 値からステータス色相 (pass=142°, fail=27°, flaky=75°, accent=156°)
// が design source-of-truth から逸脱していないことを保証する。色相分離が崩れると
// 色覚多様性下での識別性が失われるため、この invariant は意図せず変えてはいけない。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const cssPath = path.resolve(here, "../../src/styles/globals.css");
const srcRoot = path.resolve(here, "../../src");
const css = readFileSync(cssPath, "utf8");

function extractBlock(selector: ":root" | ".dark"): string {
  const escaped = selector === ":root" ? ":root" : "\\.dark";
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`));
  return match?.[1] ?? "";
}

function extractTokenValue(block: string, token: string): string | null {
  const re = new RegExp(`--${token}:\\s*([^;]+);`);
  return block.match(re)?.[1]?.trim() ?? null;
}

function extractHue(block: string, token: string): number | null {
  const re = new RegExp(`--${token}:\\s*oklch\\(\\s*[\\d.]+\\s+[\\d.]+\\s+([\\d.]+)`);
  const m = block.match(re);
  return m ? Number(m[1]) : null;
}

/** ライトモード (`:root { ... }`) のブロック中で `--name: oklch(L C H ...)` の H を抽出 */
function extractLightHue(token: string): number | null {
  return extractHue(extractBlock(":root"), token);
}

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) return listFiles(fullPath);
    return [fullPath];
  });
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

  it("主要 token はデザインモックの exact value から逸脱していない", () => {
    const light = extractBlock(":root");
    const dark = extractBlock(".dark");
    expect(extractTokenValue(light, "accent")).toBe("oklch(0.52 0.11 156)");
    expect(extractTokenValue(dark, "accent")).toBe("oklch(0.75 0.10 154)");
    expect(extractTokenValue(light, "cta")).toBe("oklch(0.45 0.10 156)");
    expect(extractTokenValue(dark, "cta")).toBe("oklch(0.45 0.10 156)");
    expect(extractTokenValue(light, "bg-0")).toBe("#fafafa");
    expect(extractTokenValue(dark, "bg-0")).toBe("#09090b");
  });

  it("feature/component code にモック外の直書き色を増やさない", () => {
    const offenders: string[] = [];
    const directColor =
      /(?:bg|text|border|from|to|via|fill|stroke)-\[#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\]|#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?\b|rgba?\(|oklch\(\s*[\d.]/;
    for (const filePath of listFiles(srcRoot)) {
      if (!/\.(ts|tsx|css)$/.test(filePath)) continue;
      if (filePath === cssPath) continue;
      const rel = path.relative(srcRoot, filePath);
      const lines = readFileSync(filePath, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (directColor.test(line)) offenders.push(`${rel}:${index + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
