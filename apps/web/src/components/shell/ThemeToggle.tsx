// Light / System / Dark の 3-way テーマ切替。
// ToggleGroup type="single" は Radix が role="group" + aria-pressed を出力するが、
// このユースケースは「3 値から 1 値を選ぶ」radio セマンティクスが正しい。
// PR #4 のフィードバックを反映し、カスタム実装で role="radiogroup" + aria-checked を確実に付ける。
//
// なぜ ToggleGroup を流用しないか:
// - ToggleGroup の aria-pressed は「押下状態」のセマンティクスで、3 値から 1 値選択には不適切
// - Radix RadioGroup を新規依存追加するほどの規模ではない (3 ボタンの単純な mutually-exclusive UI)
// - 自前実装でも矢印キーナビゲーション + roving tabindex で WAI-ARIA 準拠を確保できる
import * as React from "react";
import { Monitor, Moon, Sun } from "lucide-react";

import { cn } from "@/lib/utils";
import { isDev } from "@/store/env";
import type { ThemePreference } from "@/store/app-store";

interface ThemeToggleProps {
  value: ThemePreference;
  onValueChange: (next: ThemePreference) => void;
  className?: string;
}

interface ThemeOption {
  value: ThemePreference;
  label: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}

const THEME_OPTIONS: ReadonlyArray<ThemeOption> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "auto", label: "System", icon: Monitor },
  { value: "dark", label: "Dark", icon: Moon }
];

export function ThemeToggle({
  value,
  onValueChange,
  className
}: ThemeToggleProps): React.ReactElement {
  // option 毎の DOM ref。矢印キー操作後にフォーカスを次の選択肢へ移動する WAI-ARIA Radio Group 要件。
  // useRef を要素数分用意するため固定長配列を一度だけ初期化する。
  const optionRefs = React.useRef<Array<HTMLButtonElement | null>>(
    Array(THEME_OPTIONS.length).fill(null)
  );

  // 矢印キーナビゲーション。WAI-ARIA Radio Group pattern に従い ←↑ で前、→↓ で次へ循環し、
  // 同時に新しい選択肢へフォーカスを移動する (focus 移動なしだとスクリーンリーダーが追従しない)。
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const key = event.key;
    if (key !== "ArrowLeft" && key !== "ArrowRight" && key !== "ArrowUp" && key !== "ArrowDown") {
      return;
    }
    event.preventDefault();
    const currentIndex = THEME_OPTIONS.findIndex((o) => o.value === value);
    if (currentIndex < 0) {
      // value が型外に逸脱している = invariant 違反。silent 無視せず dev で可視化する。
      if (isDev) {
        // eslint-disable-next-line no-console -- 開発時の診断目的に限定
        console.error(`[ThemeToggle] value="${value}" は THEME_OPTIONS 値域外`);
      }
      return;
    }
    const direction = key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1;
    const nextIndex = (currentIndex + direction + THEME_OPTIONS.length) % THEME_OPTIONS.length;
    onValueChange(THEME_OPTIONS[nextIndex].value);
    // フォーカス移動: 次の radio へ。re-render を待たず同期的に移動する。
    optionRefs.current[nextIndex]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      onKeyDown={handleKeyDown}
      className={cn(
        "inline-flex items-center rounded-full border border-[var(--line)] bg-[var(--bg-1)] p-[3px]",
        className
      )}
    >
      {THEME_OPTIONS.map((opt, index) => {
        const Icon = opt.icon;
        const checked = opt.value === value;
        return (
          <button
            key={opt.value}
            ref={(node) => {
              optionRefs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            // roving tabindex: 選択中のみフォーカス可。矢印キーで他要素へ移動する WAI-ARIA pattern。
            tabIndex={checked ? 0 : -1}
            title={opt.label}
            aria-label={opt.label}
            onClick={() => onValueChange(opt.value)}
            className={cn(
              "grid h-7 w-7 place-items-center rounded-full transition-colors",
              "text-[var(--ink-3)] hover:text-[var(--ink-0)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-1)]",
              checked && "bg-[var(--bg-elev)] text-[var(--ink-0)] shadow-sm"
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
