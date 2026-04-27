// "再実行" ボタン。
// - 直前の RunRequest を保持していないとき、または mutation 進行中は disabled。
// - キーボードショートカット `r` の hint は kbd タグで表示するが、key handler 自体は別 issue。
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
      title="再実行 (r)"
      className={cn("h-8 gap-2 px-3 text-xs", className)}
    >
      <Play className="h-3.5 w-3.5" aria-hidden />
      <span>{isRunning ? "実行中…" : "再実行"}</span>
      {/* キーボードヒント。実装は別 issue だが UI として hint だけ出す */}
      <kbd
        aria-hidden
        className="ml-0.5 rounded-sm border border-white/30 bg-white/15 px-1 py-px font-mono text-[10px] text-white/90"
      >
        R
      </kbd>
    </Button>
  );
}
