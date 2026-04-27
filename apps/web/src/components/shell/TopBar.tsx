// app-shell の上端 TopBar。Brand / Breadcrumbs / Persona+Rerun+Theme actions を 3 段組で並べる。
// store からの state 取得は呼び出し側 (main.tsx) で selector を介して注入する設計とし、
// TopBar 自体は純粋な presentational component に保つ (テスト容易性 + γ 移行時の流用性)。
import * as React from "react";
import type { RunStatus } from "@pwqa/shared";

import { Brand } from "@/components/shell/Brand";
import { Breadcrumbs } from "@/components/shell/Breadcrumbs";
import { PersonaToggle } from "@/components/shell/PersonaToggle";
import { RerunButton } from "@/components/shell/RerunButton";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { cn } from "@/lib/utils";
import type { ThemePreference } from "@/store/app-store";
import type { PersonaView } from "@/store/persona-store";

interface TopBarProps {
  // Brand
  appVersion?: string;

  // Breadcrumbs
  projectName?: string | null;
  branch?: string | null;
  activeRunId?: string | null;
  activeRunStatus?: RunStatus | null;

  // Persona
  persona: PersonaView;
  onPersonaChange: (next: PersonaView) => void;

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
  onPersonaChange,
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
        "sticky top-0 z-50 grid grid-cols-[auto_1fr_auto] items-center gap-5 border-b border-[var(--line)] px-6 py-3",
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

      <div className="flex items-center gap-2">
        <PersonaToggle value={persona} onValueChange={onPersonaChange} />
        <RerunButton onRerun={onRerun} canRerun={canRerun} isRunning={isRunning} />
        <ThemeToggle value={theme} onValueChange={onThemeChange} />
      </div>
    </header>
  );
}
