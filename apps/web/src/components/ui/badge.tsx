// テスト結果ステータスを表現する Badge。色相分離 (pass=142° / fail=27° / flaky=75°) を維持し、
// 形 (枠線の太さ) でも識別できるようアイコン枠と組み合わせて使う前提。
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-[var(--bg-2)] text-[var(--ink-1)]",
        accent:
          "border-transparent bg-[var(--accent-soft)] text-[var(--accent)]",
        pass:
          "border-transparent bg-[var(--pass-soft)] text-[var(--pass)]",
        fail:
          "border-transparent bg-[var(--fail-soft)] text-[var(--fail)]",
        flaky:
          "border-transparent bg-[var(--flaky-soft)] text-[var(--flaky)]",
        skip:
          "border-transparent bg-[var(--skip-soft)] text-[var(--ink-2)]",
        info:
          "border-transparent bg-[var(--info-soft)] text-[var(--info)]",
        outline:
          "border-[var(--line-strong)] bg-transparent text-[var(--ink-1)]"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
