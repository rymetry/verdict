// shadcn/ui Button をベースに、Workbench のトークン (cta / accent / fail) に合わせた variant を提供する。
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // 共通: 視認性とアクセシビリティ重視。focus-visible でリングを濃く出す。
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-0)] [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // 主 CTA。モード横断で同じダークグリーンを使う (ブランド一貫性)
        default:
          "bg-[var(--cta)] text-[var(--cta-fg)] shadow-sm hover:bg-[var(--cta-hover)]",
        // 二次操作: ベース面に縁取り
        outline:
          "border border-[var(--line-strong)] bg-[var(--bg-elev)] text-[var(--ink-0)] hover:bg-[var(--bg-1)]",
        // 静かな操作 (削除以外の二次操作)
        ghost:
          "bg-transparent text-[var(--ink-1)] hover:bg-[var(--bg-2)] hover:text-[var(--ink-0)]",
        // 破壊的操作。前景色は `--color-destructive-foreground` トークン経由
        destructive:
          "bg-[var(--fail)] text-[var(--color-destructive-foreground)] shadow-sm hover:bg-[oklch(from_var(--fail)_calc(l-0.06)_c_h)]",
        // テキストリンク
        link:
          "text-[var(--accent)] underline-offset-4 hover:underline"
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-6",
        icon: "h-9 w-9"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
