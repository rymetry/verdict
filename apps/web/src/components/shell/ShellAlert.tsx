// app-shell 直下で出すインライン通知バンド。
// `rerunMutation.error` や `activeRunQuery.error` のようにユーザ操作に直結するが
// trim された UI (TopBar) には埋め込めないエラーを伝えるための簡易 surface。
//
// PoC 段階では toast を別途導入せず、TopBar 直下に banner を出すことで:
//  - silent failure を最低限可視化する
//  - 後段で react-hot-toast 等を入れる時に置換しやすい単一コンポーネントに閉じ込める
//
// 現状は fail (赤系) 単一スタイル。将来 degraded warning 等の severity 拡張が必要になったら
// `severity?: "fail" | "warning"` props と `AlertVariant` 型を導入する (今は YAGNI)。
import * as React from "react";
import { AlertCircle, X } from "lucide-react";

import { cn } from "@/lib/utils";

interface ShellAlertProps {
  message: string;
  /** ユーザ操作で閉じる UI が必要な場合に注入。null/undefined なら閉じるボタンを描画しない */
  onDismiss?: () => void;
  className?: string;
}

export function ShellAlert({ message, onDismiss, className }: ShellAlertProps): React.ReactElement {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-3 border-b border-[var(--line)] bg-[var(--fail-soft)] px-6 py-2 text-sm text-[var(--fail)]",
        className
      )}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <p className="flex-1 break-words">{message}</p>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="通知を閉じる"
          className="rounded-sm p-0.5 text-[var(--fail)]/80 hover:bg-[var(--fail-soft)] hover:text-[var(--fail)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
