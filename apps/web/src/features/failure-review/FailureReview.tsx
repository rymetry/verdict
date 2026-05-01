// post-run の失敗テスト詳細 + attachments を出すパネル。
// δ (Issue #11) で Tailwind + shadcn primitives へ移植した。
//
// silent failure ガード:
//  - error は formatMutationError 経由で正規化する (`instanceof Error` 判定は
//    `lib/mutation-error.ts` に集約済)。本ファイル内では `as Error` cast を使わない。
//  - error は production でも console.error する
//  - run が null のとき query を発火しない (enabled で gate)
//
// 注意: qa.tsx 側は project がある間は本パネルを 3-col の右列に常に mount する設計
//       (列数の揺らぎを避けるため)。`runId === null` の場合は本コンポーネント自身が
//       ガード文言を出すので、caller 側で render を gate する必要は無い。
import * as React from "react";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { FailureReviewTest } from "@pwqa/shared";

import { fetchFailureReview } from "@/api/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMutationError } from "@/lib/mutation-error";
import { RunWarningsAlert } from "@/features/run-console/RunWarningsAlert";

interface FailureReviewProps {
  /** active run の id。null のときは empty state を出す (caller が render を gate しても良い)。 */
  runId: string | null;
}

export function FailureReview({ runId }: FailureReviewProps): React.ReactElement {
  const runQuery = useQuery({
    queryKey: ["runs", runId],
    queryFn: () => {
      if (typeof runId !== "string" || runId.length === 0) {
        // enabled=false で queryFn は本来呼ばれない。invariant 違反は production でも痕跡を残す。
        // eslint-disable-next-line no-console -- invariant 違反を本番でも検知
        console.error("[FailureReview] queryFn called with invalid runId");
        throw new Error("FailureReview: runId が不正なまま queryFn が呼ばれた");
      }
      return fetchFailureReview(runId);
    },
    enabled: typeof runId === "string" && runId.length > 0,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "running" || status === "queued" ? 2_000 : false;
    }
  });

  // silent failure 防衛: error の存在を本番でも痕跡を残す。
  useEffect(() => {
    if (runQuery.status === "error" && runQuery.error) {
      // eslint-disable-next-line no-console -- run 取得失敗を本番でも痕跡を残す
      console.error("[FailureReview] fetchRun failed", runQuery.error);
    }
  }, [runQuery.status, runQuery.error]);

  if (runId === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Failure review</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[var(--ink-3)]">
            Run を開始すると失敗詳細がここに表示されます。
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>Failure review</span>
          {runQuery.data?.failedTests?.length ? (
            <Badge variant="fail">{runQuery.data.failedTests.length} failed</Badge>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {runQuery.isLoading ? (
          <p className="text-sm text-[var(--ink-3)]">Loading run metadata…</p>
        ) : runQuery.error ? (
          <Alert variant="destructive">
            <AlertTitle>取得失敗</AlertTitle>
            <AlertDescription>
              {formatMutationError(runQuery.error, "Run 情報を取得できませんでした")}
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <RunWarningsAlert warnings={runQuery.data?.warnings ?? []} />
            {runQuery.data?.failedTests?.length ? (
              <FailedTestList failedTests={runQuery.data.failedTests} />
            ) : (
              <p className="mt-3 text-sm text-[var(--ink-3)]">
                {emptyFailureReviewMessage(runQuery.data?.status)}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function emptyFailureReviewMessage(status: string | undefined): string {
  if (status === "passed") return "全テストが成功しました。";
  if (status === "running" || status === "queued" || status === undefined) {
    return "Run の完了を待機中…";
  }
  return "このランに失敗テストはありません。";
}

function FailedTestList({
  failedTests
}: {
  failedTests: FailureReviewTest[];
}): React.ReactElement {
  return (
    <ul className="flex flex-col gap-4">
      {failedTests.map((entry, index) => (
        <FailedTestRow
          key={`${entry.test.testId ?? entry.test.fullTitle ?? entry.test.title}-${index}`}
          entry={entry}
        />
      ))}
    </ul>
  );
}

function FailedTestRow({ entry }: { entry: FailureReviewTest }): React.ReactElement {
  const { test } = entry;
  return (
    <li className="flex flex-col gap-2 rounded-md border border-[var(--line-faint)] bg-[var(--bg-1)] p-3">
      <div>
        <h3 className="m-0 break-words text-sm font-semibold text-[var(--ink-0)]">
          {test.fullTitle ?? test.title}
        </h3>
        <p className="m-0 mt-1 font-mono text-[11.5px] text-[var(--ink-3)]">
          {test.filePath ?? "unknown"}
          {test.line ? `:${test.line}` : ""}
          {test.durationMs !== undefined ? ` · ${(test.durationMs / 1000).toFixed(1)}s` : ""}
        </p>
      </div>
      {test.message ? (
        <pre className="m-0 max-h-[20vh] overflow-auto whitespace-pre-wrap break-words rounded-sm bg-[var(--fail-soft)] p-2 font-mono text-[11.5px] text-[var(--fail)]">
          {test.message}
        </pre>
      ) : null}
      {test.stack ? (
        <details>
          <summary className="cursor-pointer text-xs font-medium text-[var(--ink-2)]">
            stack
          </summary>
          <pre className="m-0 mt-1 max-h-[20vh] overflow-auto whitespace-pre-wrap break-words rounded-sm bg-[var(--bg-2)] p-2 font-mono text-[11.5px] text-[var(--ink-1)]">
            {test.stack}
          </pre>
        </details>
      ) : null}
      {test.attachments.length > 0 ? (
        <ul className="flex flex-col gap-1.5" aria-label="Artifacts">
          {test.attachments.map((attachment) => (
            <li key={attachment.path} className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="default">{attachment.kind}</Badge>
              <span className="text-[var(--ink-1)]">{attachment.label}</span>
              <code className="break-all font-mono text-[11px] text-[var(--ink-3)]">
                {attachment.path}
              </code>
            </li>
          ))}
        </ul>
      ) : null}
      <FailureSignals entry={entry} />
    </li>
  );
}

function FailureSignals({ entry }: { entry: FailureReviewTest }): React.ReactElement {
  return (
    <div className="grid grid-cols-1 gap-2 border-t border-[var(--line-faint)] pt-2 text-xs md:grid-cols-3">
      <SignalPanel title="Allure history">
        {entry.history.length > 0 ? (
          <ol className="flex flex-col gap-1">
            {entry.history.slice(-4).map((history) => (
              <li
                key={`${history.generatedAt}-${history.status}`}
                className="flex items-center justify-between gap-2"
              >
                <span className="font-mono text-[11px] text-[var(--ink-3)]">
                  {history.generatedAt.replace("T", " ").slice(0, 16)}
                </span>
                <Badge variant={history.status === "passed" ? "pass" : "fail"}>
                  {history.status}
                </Badge>
              </li>
            ))}
          </ol>
        ) : (
          <p className="m-0 text-[var(--ink-3)]">No per-test history</p>
        )}
      </SignalPanel>
      <SignalPanel title="Known issue">
        {entry.knownIssues.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {entry.knownIssues.map((issue) => (
              <li key={issue.id} className="flex flex-col gap-0.5">
                <span className="font-medium text-[var(--ink-1)]">
                  {issue.title ?? issue.id}
                </span>
                {issue.status ? (
                  <span className="font-mono text-[11px] text-[var(--ink-3)]">
                    {issue.status}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-[var(--ink-3)]">No known issue match</p>
        )}
      </SignalPanel>
      <SignalPanel title="Flaky signal">
        {entry.flaky.recentStatuses.length > 0 ? (
          <div className="flex flex-col gap-1">
            <Badge variant={entry.flaky.isCandidate ? "flaky" : "default"}>
              {entry.flaky.isCandidate ? "flaky candidate" : "stable pattern"}
            </Badge>
            <span className="font-mono text-[11px] text-[var(--ink-3)]">
              pass {entry.flaky.passedRuns} / fail {entry.flaky.failedRuns + entry.flaky.brokenRuns}
            </span>
          </div>
        ) : (
          <p className="m-0 text-[var(--ink-3)]">No history signal</p>
        )}
      </SignalPanel>
    </div>
  );
}

function SignalPanel({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="min-w-0 rounded-sm border border-[var(--line-faint)] bg-[var(--bg-0)] p-2">
      <h4 className="m-0 mb-1 text-[11px] font-semibold uppercase text-[var(--ink-3)]">
        {title}
      </h4>
      {children}
    </section>
  );
}
