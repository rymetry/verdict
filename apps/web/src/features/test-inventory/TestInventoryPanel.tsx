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
import type { ProjectSummary, SpecFile, TestCase, TestInventory, TestStep } from "@pwqa/shared";

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
          <TestRow key={test.id} test={test} />
        ))}
      </ul>
    </li>
  );
}

function TestRow({ test }: { test: TestCase }): React.ReactElement {
  return (
    <li className="rounded-sm border border-[var(--line-faint)] bg-[var(--bg-elev)] p-2">
      <div className="flex flex-wrap items-baseline gap-1.5 text-sm">
        <span className="text-[var(--ink-0)]">{test.title}</span>
        <span className="font-mono text-[11px] text-[var(--ink-3)]">L{test.line}</span>
        {test.tags.length > 0 ? (
          <span className="font-mono text-[11px] text-[var(--accent)]">
            {test.tags.join(" ")}
          </span>
        ) : null}
      </div>
      <QaMetadataView test={test} />
    </li>
  );
}

function QaMetadataView({ test }: { test: TestCase }): React.ReactElement {
  const { qaMetadata } = test;
  const hasSteps = qaMetadata.steps.length > 0;
  const hasExpectations = qaMetadata.expectations.length > 0;
  const normalizedPurpose = qaMetadata.purpose.toLocaleLowerCase();
  const normalizedTitle = test.title.toLocaleLowerCase();
  const shouldShowPurpose =
    !normalizedTitle.includes(normalizedPurpose) &&
    (qaMetadata.confidence !== "low" || !normalizedPurpose.includes(normalizedTitle));

  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-[var(--line-faint)] pt-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        {shouldShowPurpose ? (
          <div className="min-w-0 flex-1">
            <p className="m-0 break-words text-sm text-[var(--ink-1)]">
              <span className="text-[11px] font-semibold uppercase tracking-normal text-[var(--ink-3)]">
                Purpose ·{" "}
              </span>
              {qaMetadata.purpose}
            </p>
          </div>
        ) : null}
        <Badge variant={qaMetadata.confidence === "low" ? "outline" : "info"}>
          {qaMetadata.source} · {qaMetadata.confidence}
        </Badge>
      </div>
      {hasSteps || hasExpectations ? (
        <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
          {hasSteps ? (
            <QaStepList title="Steps" steps={qaMetadata.steps} />
          ) : null}
          {hasExpectations ? (
            <QaStepList title="Expected" steps={qaMetadata.expectations} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function QaStepList({
  title,
  steps
}: {
  title: string;
  steps: TestStep[];
}): React.ReactElement {
  return (
    <section className="rounded-sm bg-[var(--bg-2)] p-2">
      <h4 className="m-0 text-[11px] font-semibold uppercase tracking-normal text-[var(--ink-3)]">
        {title}
      </h4>
      <ol className="m-0 mt-1 flex list-decimal flex-col gap-1 pl-4 text-[var(--ink-1)]">
        {steps.map((step, index) => (
          <li key={`${step.title}-${step.line ?? index}`} className="break-words">
            <span>{step.title}</span>
            {step.line ? (
              <span className="ml-1 font-mono text-[10.5px] text-[var(--ink-3)]">
                L{step.line}
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
