// Developer View 左カラム: 関連ファイルツリー (Phase 1.2 で接続予定の placeholder)。
//
// Phase 1.2 で実データ接続する際の差分:
//  - props を `useQuery(["dev-view", "file-tree", projectId])` の結果に置換
//  - active spec / Page Object / Fixture / Config を Phase 1.2 の inventory + run context から導出
//  - active item は store の active spec id 等から派生
import * as React from "react";
import { File as FileIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  DEVELOPER_VIEW_LABELS,
  PHASE_1_2_PLACEHOLDER_LABEL,
  type FileTreeGroup
} from "./types";

interface FileTreeCardProps {
  /**
   * 関連ファイルツリーのグループ群。
   *
   * INVARIANT (Phase 1.2 移行時):
   *  - loading / error / empty は呼び出し側 (route component) で分岐し、
   *    このコンポーネントには「描画する実データ (or placeholder fixture)」のみを渡すこと。
   *  - 空配列を許容すると "API 障害" と "本当にゼロ件" の区別がつかなくなる (silent failure)。
   */
  groups: ReadonlyArray<FileTreeGroup>;
}

export function FileTreeCard({ groups }: FileTreeCardProps): React.ReactElement {
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
                    // ファイルツリー内の現在地を示すため WAI-ARIA 1.2 の "location" を採用。
                    // 値非依存の test (`[aria-current]` selector) でも検出可能。
                    aria-current={item.current ? "location" : undefined}
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
