// app-shell の上端 TopBar。Brand / Breadcrumbs / Persona+Rerun+Theme actions を 3 段組で並べる。
// store からの state 取得は呼び出し側 (__root.tsx) で selector を介して注入する設計とし、
// TopBar 自体は純粋な presentational component に保つ (テスト容易性のため)。
//
// γ で `onPersonaChange` を撤去した: persona は URL segment が Source of Truth となり、
// PersonaToggle 内部で `useNavigate` を直接呼び出す。TopBar は active 表示用に persona 値だけ受け取る。
import * as React from "react";
import type { RunStatus } from "@pwqa/shared";

import { Brand } from "@/components/shell/Brand";
import { Breadcrumbs } from "@/components/shell/Breadcrumbs";
import { PersonaToggle } from "@/components/shell/PersonaToggle";
import { RerunButton } from "@/components/shell/RerunButton";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { cn } from "@/lib/utils";
import type { PersonaView } from "@/lib/persona-view";
import type { ThemePreference } from "@/store/app-store";

interface TopBarProps {
  // Brand
  appVersion?: string;

  // Breadcrumbs
  projectName?: string | null;
  branch?: string | null;
  activeRunId?: string | null;
  activeRunStatus?: RunStatus | null;

  // Persona (active 表示専用 — 切替は PersonaToggle 内の navigate に委譲)
  persona: PersonaView;

  // Rerun
  onRerun: () => void;
  canRerun: boolean;
  isRunning?: boolean;

  // Theme
  theme: ThemePreference;
  onThemeChange: (next: ThemePreference) => void;

  className?: string;
}

export function TopBar({
  appVersion,
  projectName,
  branch,
  activeRunId,
  activeRunStatus,
  persona,
  onRerun,
  canRerun,
  isRunning,
  theme,
  onThemeChange,
  className
}: TopBarProps): React.ReactElement {
  return (
    <header
      aria-label="Workbench top bar"
      className={cn(
        // sticky で常時表示。z-index は overlay より下、modal より上の中間層 (50)。
        "sticky top-0 z-50 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-5 border-b border-[var(--line)] px-6 py-3",
        // 半透明 + backdrop-blur でデザインモック準拠 (var(--bg-overlay) は light/dark 両モード定義済)
        "bg-[var(--bg-overlay)] backdrop-blur-md",
        className
      )}
    >
      <Brand version={appVersion} />

      <Breadcrumbs
        projectName={projectName}
        branch={branch}
        runId={activeRunId}
        runStatus={activeRunStatus}
      />

      <div className="flex shrink-0 items-center gap-2">
        <PersonaToggle value={persona} />
        <RerunButton onRerun={onRerun} canRerun={canRerun} isRunning={isRunning} />
        <ThemeToggle value={theme} onValueChange={onThemeChange} />
      </div>
    </header>
  );
}
