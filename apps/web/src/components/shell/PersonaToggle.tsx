// QA / Developer / Insights を切り替える segmented control。
// PersonaToggle は Tabs セマンティクス (排他選択 + 表示切替) が適合するため shadcn/ui Tabs を採用。
// PR #4 で aria-pressed → aria-selected の指摘があったが、Radix Tabs は自動で
// role="tablist" / role="tab" / aria-selected を出力するため別途対応不要。
import * as React from "react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  isPersonaView,
  PERSONA_VIEWS,
  type PersonaView
} from "@/store/persona-store";

interface PersonaToggleProps {
  value: PersonaView;
  onValueChange: (next: PersonaView) => void;
  className?: string;
}

const PERSONA_LABEL: Record<PersonaView, string> = {
  qa: "QA",
  dev: "Developer",
  qmo: "Insights"
};

/**
 * Radix Tabs の onValueChange (任意 string を流す) を PersonaView に narrow する guard。
 * - PERSONA_VIEWS と TabsTrigger value は同期している前提なので、ここに invalid 値が来るのは
 *   invariant 違反 (typo / PERSONA_VIEWS 拡張時の未同期)。store には絶対にコミットしない。
 * - throw ではなく console.error にする理由: Radix の onValueChange は React イベントハンドラで、
 *   throw しても Error Boundary に拾われないことが多く、UI 全体を白画面化させない方を優先する。
 *   一方で「silent」は許容しない方針 (CLAUDE.md `Never silently swallow errors`) のため、
 *   production でも log は出す (将来運用環境のログ収集経路で拾える余地を残すため)。
 *   vite.config.ts の console drop 防衛設定 (詳細はそちらの define / esbuild / build セクション)
 *   と組み合わせて、本番 build でも console.error が drop されない invariant が成立している。
 * - test から動線を直接検証できるよう named export する。
 */
export function dispatchPersonaSafely(
  raw: string,
  onValueChange: (next: PersonaView) => void
): void {
  if (isPersonaView(raw)) {
    onValueChange(raw);
    return;
  }
  // eslint-disable-next-line no-console -- invariant 違反は production でも検出したい
  console.error(`[PersonaToggle] Tabs から想定外 value: ${String(raw)}`);
}

export function PersonaToggle({
  value,
  onValueChange,
  className
}: PersonaToggleProps): React.ReactElement {
  return (
    <Tabs
      value={value}
      onValueChange={(raw) => dispatchPersonaSafely(raw, onValueChange)}
      className={className}
    >
      {/* aria-label は role="tablist" を持つ TabsList に付ける (Radix Tabs 仕様) */}
      <TabsList
        aria-label="Persona view"
        className={cn(
          "h-auto gap-0.5 rounded-lg border border-[var(--line)] bg-[var(--bg-1)] p-[3px]"
        )}
      >
        {PERSONA_VIEWS.map((p) => (
          <TabsTrigger
            key={p}
            value={p}
            className={cn(
              "h-7 rounded-md px-3 text-xs font-medium text-[var(--ink-2)]",
              "data-[state=active]:bg-[var(--bg-elev)] data-[state=active]:text-[var(--ink-0)] data-[state=active]:shadow-sm",
              "hover:text-[var(--ink-0)]"
            )}
          >
            {PERSONA_LABEL[p]}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
