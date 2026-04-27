// shadcn/ui Label primitive。Phase 1 では Radix Label に依存しない最小実装で十分
// (form 内の単純な <label htmlFor=...>。disabled grouping や複合トリガは Phase 5 以降)。
// 必要になった時点で `@radix-ui/react-label` へ差し替える方針 (識別箇所コメントを残す)。
import * as React from "react";

import { cn } from "@/lib/utils";

export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>;

const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn(
        "text-xs font-medium text-[var(--ink-2)]",
        "peer-disabled:cursor-not-allowed peer-disabled:opacity-55",
        className
      )}
      {...props}
    />
  )
);
Label.displayName = "Label";

export { Label };
