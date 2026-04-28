// Developer View 左カラム: 関連ファイルツリー (Phase 1.2 で接続予定の placeholder)。
//
// Phase 1.2 で実データ接続する際の差分:
//  - sample-data.ts の `SAMPLE_FILE_TREE` を `useQuery(["dev-view", "file-tree", projectId])` に置換
//  - Failure detail から派生する spec / Page Object / Fixture を関連ファイルとして列挙
//  - active item は store の `activeSpecId` などから派生
import * as React from "react";
import { File as FileIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  DEVELOPER_VIEW_LABELS,
  PHASE_1_2_PLACEHOLDER_LABEL,
  SAMPLE_FILE_TREE,
  type FileTreeGroup
} from "./sample-data";

interface FileTreeCardProps {
  /** Phase 1.2 でクエリ結果を渡せるよう Props で差し替え可能にしておく (default は sample) */
  groups?: ReadonlyArray<FileTreeGroup>;
}

export function FileTreeCard({
  groups = SAMPLE_FILE_TREE
}: FileTreeCardProps): React.ReactElement {
  const total = groups.reduce((acc, g) => acc + g.items.length, 0);

  return (
    <Card data-testid="dev-file-tree-card">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>{DEVELOPER_VIEW_LABELS.fileTree}</span>
          <span className="flex items-center gap-2">
            <span className="text-xs font-medium text-[var(--ink-3)]">{total}</span>
            <Badge variant="info">{PHASE_1_2_PLACEHOLDER_LABEL}</Badge>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-3" aria-label={DEVELOPER_VIEW_LABELS.fileTree}>
          {groups.map((group) => (
            <li key={group.path} className="flex flex-col gap-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-3)]">
                {group.path} /
              </div>
              <ul className="flex flex-col gap-1">
                {group.items.map((item) => (
                  <li
                    key={item.name}
                    aria-current={item.current ? "true" : undefined}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1 text-sm",
                      item.current
                        ? "bg-[var(--bg-2)] text-[var(--ink-0)]"
                        : "text-[var(--ink-1)]"
                    )}
                  >
                    <FileIcon
                      className="h-3.5 w-3.5 shrink-0 text-[var(--ink-3)]"
                      aria-hidden="true"
                    />
                    <span className="truncate font-mono text-xs">{item.name}</span>
                    {item.failed ? (
                      <Badge variant="fail" className="ml-auto">
                        Failed
                      </Badge>
                    ) : item.annotation ? (
                      <span className="ml-auto text-xs text-[var(--ink-3)]">
                        {item.annotation}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
