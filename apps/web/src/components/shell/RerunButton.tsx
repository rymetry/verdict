// "再実行" ボタン。
// - 直前の RunRequest を保持していないとき、または mutation 進行中は disabled。
// - キーボードショートカット `r` の hint は kbd タグで表示。
//   key handler 本体は ε (TopBar 全体の keymap 層) で実装予定。それまでは UI hint のみ。
// - ε 完了時には `SHORTCUT_KEY` 定数を keymap registry へ寄せ、本コンポーネントは
//   display key 名を props で受け取る形にリファクタする (定数の二重定義を防ぐため)。
// - shadcn Button (variant="default" = CTA ダーク緑) + lucide Play icon。
import * as React from "react";
import { Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface RerunButtonProps {
  onRerun: () => void;
  isRunning?: boolean;
  /** false: 直前の RunRequest が無い等、再実行できない (UI を disabled に固定) */
  canRerun: boolean;
  className?: string;
}

// キーボードショートカット表示。本体実装と表記の drift を避けるため定数化。
const SHORTCUT_KEY = "R";

export function RerunButton({
  onRerun,
  isRunning = false,
  canRerun,
  className
}: RerunButtonProps): React.ReactElement {
  const disabled = isRunning || !canRerun;
  return (
    <Button
      type="button"
      onClick={onRerun}
      disabled={disabled}
      title={`再実行 (${SHORTCUT_KEY.toLowerCase()})`}
      className={cn("h-8 gap-2 px-3 text-xs", className)}
    >
      <Play className="h-3.5 w-3.5" aria-hidden />
      <span>{isRunning ? "実行中…" : "再実行"}</span>
      {/* キーボードヒント。色は `--cta-fg` トークン経由で variant 変更にも追従させる。 */}
      <kbd
        aria-hidden
        className="ml-0.5 rounded-sm border border-[var(--cta-fg)]/30 bg-[var(--cta-fg)]/15 px-1 py-px font-mono text-[10px] text-[var(--cta-fg)]/90"
      >
        {SHORTCUT_KEY}
      </kbd>
    </Button>
  );
}
