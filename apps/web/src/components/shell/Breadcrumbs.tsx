// Project / branch / Run #ID + status badge のパンくず。
// - 値が無い項目は表示しない (空 placeholder を残さない方針)
// - active な run が無いときは項目だけが並ぶ
// - run の status は Badge で表現し、色相分離原則 (pass/fail/info) を守る
import * as React from "react";
import { Clock, Folder, GitBranch } from "lucide-react";
import type { RunStatus } from "@pwqa/shared";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { runStatusBadgeVariant, runStatusLabel } from "@/components/shell/status";

// 「未指定」の正規形は呼び出し側で `null` に統一する設計 (main.tsx の selector がそう吐く)。
// ただし `undefined` で来ても guard が等価に弾けるよう `?: T | null` を許容している。
interface BreadcrumbsProps {
  projectName?: string | null;
  branch?: string | null;
  runId?: string | null;
  runStatus?: RunStatus | null;
  className?: string;
}

const itemBase = cn(
  "inline-flex items-center gap-1.5 rounded-md px-2 py-1",
  "text-[var(--ink-1)] transition-colors hover:bg-[var(--bg-2)] hover:text-[var(--ink-0)]",
  "[&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:opacity-70"
);

function Divider(): React.ReactElement {
  return (
    <span aria-hidden="true" className="px-0.5 text-xs text-[var(--ink-4)]">
      /
    </span>
  );
}

export function Breadcrumbs({
  projectName,
  branch,
  runId,
  runStatus,
  className
}: BreadcrumbsProps): React.ReactElement | null {
  const hasProject = typeof projectName === "string" && projectName.length > 0;
  const hasBranch = typeof branch === "string" && branch.length > 0;
  const hasRun = typeof runId === "string" && runId.length > 0;

  // すべて欠落していれば表示しない (Phase 1 はプロジェクト未オープンの状態が普通)
  if (!hasProject && !hasBranch && !hasRun) return null;

  return (
    <nav
      aria-label="Project context"
      className={cn(
        "flex min-w-0 items-center gap-1 border-l border-[var(--line)] pl-4 text-[13px] text-[var(--ink-1)]",
        className
      )}
    >
      {hasProject ? (
        <span className={itemBase}>
          <Folder aria-hidden />
          {/* hasProject で string 確定済 (typeof + length 検証済) */}
          <span className="truncate" title={projectName as string}>
            {projectName}
          </span>
        </span>
      ) : null}

      {hasProject && hasBranch ? <Divider /> : null}

      {hasBranch ? (
        <span className={itemBase}>
          <GitBranch aria-hidden />
          <span>{branch}</span>
        </span>
      ) : null}

      {(hasProject || hasBranch) && hasRun ? <Divider /> : null}

      {hasRun ? (
        <span className={cn(itemBase, "gap-2")}>
          <Clock aria-hidden />
          <span>Run #{runId}</span>
          {runStatus ? (
            <Badge variant={runStatusBadgeVariant(runStatus)} className="ml-1">
              {runStatusLabel(runStatus)}
            </Badge>
          ) : null}
        </span>
      ) : null}
    </nav>
  );
}
