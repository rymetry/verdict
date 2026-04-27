// QA / Developer / Insights を切り替える segmented control。
// γ (Issue #10) で persona は URL segment が Single Source of Truth になったため、
// クリック時は store 更新ではなく `useNavigate` で `/qa` `/dev` `/qmo` へ遷移する。
//
// PersonaToggle 自体は controlled component であり続ける:
//  - active 表示 (`value`) は URL から派生して props で渡される
//  - クリックは内部で navigate を呼び、URL 更新が再描画経由で `value` を更新する
// これにより「URL → UI 表示」が一方向のフローに保たれる。
//
// 視覚的セマンティクスは Tabs のまま (排他選択 + 表示切替) で、矢印キーや aria-selected の
// 挙動を Radix に任せる。Link コンポーネント直接埋め込みではなく Tab + navigate の組み合わせを
// 採る理由: Radix Tabs は矢印キー/Home/End によるロービングフォーカスを内蔵しており、
// アクセシビリティを自前実装するより安全であるため。代わりに href を持たないため、
// middle-click 等の "新規タブで開く" は機能しない。Phase 1 ではユースケースが薄いと判断し採用しない。
import * as React from "react";
import { useNavigate } from "@tanstack/react-router";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { isPersonaView, PERSONA_VIEWS, type PersonaView } from "@/lib/persona-view";

interface PersonaToggleProps {
  value: PersonaView;
  className?: string;
}

const PERSONA_LABEL: Record<PersonaView, string> = {
  qa: "QA",
  dev: "Developer",
  qmo: "Insights"
};

/** PersonaView → URL pathname 変換 (`/qa` `/dev` `/qmo`) */
const PERSONA_PATH = {
  qa: "/qa",
  dev: "/dev",
  qmo: "/qmo"
} as const satisfies Record<PersonaView, string>;

/**
 * Radix Tabs の onValueChange (任意 string を流す) を PersonaView に narrow する guard。
 * - PERSONA_VIEWS と TabsTrigger value は同期している前提なので、ここに invalid 値が来るのは
 *   invariant 違反 (typo / PERSONA_VIEWS 拡張時の未同期)。store には絶対にコミットしない。
 * - throw ではなく console.error にする理由: Radix の onValueChange は React イベントハンドラで、
 *   throw しても Error Boundary に拾われないことが多く、UI 全体を白画面化させない方を優先する。
 *   一方で「silent」は許容しない方針 (CLAUDE.md `Never silently swallow errors`) のため、
 *   production でも log は出す。
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
  className
}: PersonaToggleProps): React.ReactElement {
  const navigate = useNavigate();
  function dispatch(next: PersonaView): void {
    // navigate() は Promise を返す。`void` で握りつぶすと beforeLoad の throw / 履歴アダプタ層の
    // 失敗が production で完全 silent (window.onerror 経由) になり、CLAUDE.md の
    // `Never silently swallow errors` に反する。明示的に .catch して console.error する。
    navigate({ to: PERSONA_PATH[next] }).catch((error) => {
      // eslint-disable-next-line no-console -- 本番でも navigate 失敗を可視化
      console.error("[PersonaToggle] navigate failed", error);
    });
  }

  return (
    <Tabs
      value={value}
      onValueChange={(raw) => dispatchPersonaSafely(raw, dispatch)}
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
