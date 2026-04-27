// QA / Developer / Insights を切り替える segmented control。
// shadcn/ui Tabs (Radix UI) を使用するため、role="tablist" / role="tab" / aria-selected が
// 自動付与される (PR #4 のフィードバック反映: aria-pressed ではなく aria-selected)。
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

export function PersonaToggle({
  value,
  onValueChange,
  className
}: PersonaToggleProps): React.ReactElement {
  return (
    <Tabs
      value={value}
      // Tabs の onValueChange は string を渡してくる。invalid 値は guard で弾き、
      // 想定外の persona が store にコミットされるサイレント不整合を防ぐ。
      onValueChange={(raw) => {
        if (isPersonaView(raw)) onValueChange(raw);
      }}
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
