// app-shell (top bar) 左側のブランド表示。
// 「shell」は Playwright がクロスブラウザツールであるため Chrome ブラウザとの混同を避けて
// 採用した命名 (UI シェル / アプリケーションフレームの意)。
// - "P" 角丸 mark + ブランド名 + バージョン (vite define で `__APP_VERSION__` を注入)
// - シンボル color は `--cta` を使う (light/dark 横断で同じダーク緑、ブランド一貫性)
import * as React from "react";

import { cn } from "@/lib/utils";

interface BrandProps {
  /** バージョン文字列 (例: "0.1.0")。default は build-time 注入の `__APP_VERSION__`。 */
  version?: string;
  /** "v0.1.0 · local" の "local" 部にあたる short suffix (例: "local" / "ci") */
  environmentLabel?: string;
  className?: string;
}

// Brand を import する経路 (例: 別アプリでの再利用 / SSR ツール) で vite define が無い場合の
// ReferenceError を避けるため、typeof guard で安全な fallback を返す純粋関数にしておく。
function readAppVersion(): string {
  return typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";
}

export function Brand({
  version = readAppVersion(),
  environmentLabel = "local",
  className
}: BrandProps): React.ReactElement {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span
        aria-hidden="true"
        className={cn(
          "grid h-7 w-7 place-items-center rounded-md text-[13px] font-bold",
          "bg-[var(--cta)] text-[var(--cta-fg)] tracking-tight"
        )}
      >
        P
      </span>
      <div className="leading-tight">
        <div className="text-sm font-semibold text-[var(--ink-0)] tracking-tight">
          Playwright Workbench
        </div>
        <span className="mt-px block text-[10px] text-[var(--ink-3)] font-mono">
          v{version} · {environmentLabel}
        </span>
      </div>
    </div>
  );
}
