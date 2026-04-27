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
  // 矢印キーナビゲーション。WAI-ARIA Radio Group pattern に従い ←↑ で前、→↓ で次へ循環。
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const key = event.key;
    if (key !== "ArrowLeft" && key !== "ArrowRight" && key !== "ArrowUp" && key !== "ArrowDown") {
      return;
    }
    event.preventDefault();
    const currentIndex = THEME_OPTIONS.findIndex((o) => o.value === value);
    if (currentIndex < 0) return;
    const direction = key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1;
    const nextIndex = (currentIndex + direction + THEME_OPTIONS.length) % THEME_OPTIONS.length;
    onValueChange(THEME_OPTIONS[nextIndex].value);
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
      {THEME_OPTIONS.map((opt) => {
        const Icon = opt.icon;
        const checked = opt.value === value;
        return (
          <button
            key={opt.value}
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
