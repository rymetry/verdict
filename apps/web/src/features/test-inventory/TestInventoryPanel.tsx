// Playwright が認識する spec/test 一覧を表示するパネル。
// δ (Issue #11) で Tailwind + shadcn primitives へ移植した。
//
// 設計方針:
//  - error は formatMutationError 経由で正規化する (`instanceof Error` / `WorkbenchApiError`
//    判定は `lib/mutation-error.ts` に集約済)。本ファイル内では `as Error` cast を使わない。
//  - スクロールは Card 内の overflow-y-auto + max-h で実装 (shadcn ScrollArea を使うほどの操作対象でない)
//  - Phase 1 では spec/test 単体の直接実行ボタンは持たない (実行は RunControls 経由)。
//    ε (Issue #12) で Developer View へ移植する際にボタン配線を追加する。
import * as React from "react";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ProjectSummary, SpecFile, TestInventory } from "@pwqa/shared";

import { fetchInventory } from "@/api/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMutationError } from "@/lib/mutation-error";

// Phase 1 では spec/test 単体の直接実行ボタンを持たないため、Props は project のみ。
// ε で onRunSpec / onRunTest を追加する際は Type を拡張する (今は dead Props を作らない)。
interface TestInventoryProps {
  project: ProjectSummary;
}

export function TestInventoryPanel({ project }: TestInventoryProps): React.ReactElement {
  const inventoryQuery = useQuery({
    queryKey: ["inventory", project.id],
    queryFn: () => fetchInventory(project.id),
    enabled: !project.blockingExecution
  });

  // silent failure 防衛: error は production でも痕跡を残す。
  // status をトリガにすることで refetch error の重複 log を避けつつ初回失敗を逃さない。
  useEffect(() => {
    if (inventoryQuery.status === "error" && inventoryQuery.error) {
      // eslint-disable-next-line no-console -- inventory 取得失敗を本番でも痕跡を残す
      console.error("[TestInventoryPanel] fetchInventory failed", inventoryQuery.error);
    }
  }, [inventoryQuery.status, inventoryQuery.error]);

  if (project.blockingExecution) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Test inventory</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[var(--ink-3)]">
            Project execution がブロックされているため inventory は取得できません。
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>Test inventory</span>
          {inventoryQuery.data ? (
            <span className="text-xs font-medium text-[var(--ink-3)]">
              {inventoryQuery.data.totals.specFiles} files · {inventoryQuery.data.totals.tests} tests
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {inventoryQuery.isLoading ? (
          <p className="text-sm text-[var(--ink-3)]">Listing tests via Playwright CLI…</p>
        ) : inventoryQuery.error ? (
          <Alert variant="destructive">
            <AlertTitle>取得失敗</AlertTitle>
            <AlertDescription>
              {formatMutationError(inventoryQuery.error, "テスト一覧を取得できませんでした")}
            </AlertDescription>
          </Alert>
        ) : inventoryQuery.data ? (
          <InventoryView inventory={inventoryQuery.data} />
        ) : null}
      </CardContent>
    </Card>
  );
}

interface InventoryViewProps {
  inventory: TestInventory;
}

function InventoryView({ inventory }: InventoryViewProps): React.ReactElement {
  if (inventory.error) {
    // Playwright CLI 自体が error を返した (parse はできたが list 失敗) ケース。
    // formatMutationError は instanceof Error 前提のためここでは直接表示する。
    return (
      <Alert variant="destructive">
        <AlertTitle>Playwright list error</AlertTitle>
        <AlertDescription>{inventory.error}</AlertDescription>
      </Alert>
    );
  }
  if (inventory.specs.length === 0) {
    return (
      <p className="text-sm text-[var(--ink-3)]">
        Playwright が認識する spec が見つかりませんでした。
      </p>
    );
  }
  return (
    <ul className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
      {inventory.specs.map((spec) => (
        <SpecRow key={spec.relativePath} spec={spec} />
      ))}
    </ul>
  );
}

function SpecRow({ spec }: { spec: SpecFile }): React.ReactElement {
  return (
    <li className="rounded-md border border-[var(--line-faint)] bg-[var(--bg-1)] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="break-all font-mono text-xs font-semibold text-[var(--ink-0)]">
          {spec.relativePath}
        </span>
        <Badge variant="outline">{spec.tests.length}</Badge>
      </div>
      <ul className="flex flex-col gap-1.5">
        {spec.tests.map((test) => (
          <li key={test.id} className="flex flex-wrap items-baseline gap-1.5 text-sm">
            <span className="text-[var(--ink-0)]">{test.title}</span>
            <span className="font-mono text-[11px] text-[var(--ink-3)]">L{test.line}</span>
            {test.tags.length > 0 ? (
              <span className="font-mono text-[11px] text-[var(--accent)]">
                {test.tags.join(" ")}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </li>
  );
}
