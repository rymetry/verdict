// shadcn/ui Input primitive。Workbench トークン (line / accent-ring / ink-3) で配色を統一する。
// disabled / aria-invalid / placeholder は色のみで弁別すると識別性が落ちるため、
// 形 (border 強度) でも変化させる方針。
import * as React from "react";

import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          // ベース
          "flex h-9 w-full rounded-md border border-[var(--line-strong)] bg-[var(--bg-elev)] px-3 py-1 text-sm text-[var(--ink-0)]",
          "placeholder:text-[var(--ink-3)]",
          // フォーカスリング
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg-0)]",
          // 無効
          "disabled:cursor-not-allowed disabled:opacity-55",
          // バリデーション (aria-invalid 経路で fail 系の縁取り + リング)
          "aria-invalid:border-[var(--fail)] aria-invalid:focus-visible:ring-[var(--fail-soft)]",
          className
        )}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
