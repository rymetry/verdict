// 最新 run の QMO Release Readiness Summary を fetch する composite hook (Phase 1.2 / T208-2).
//
// 設計:
//  - QMO route (`/qmo`) は currently runId を URL に持たないため、最も新しい run の
//    QMO summary を「現在の Release Readiness シグナル」として表示する方針。Phase 1.2
//    後段で `/qmo/:runId` route を導入する場合は本 hook を `useQmoSummaryQuery(runId)`
//    の薄いラッパへ移行する。
//  - 内部で `fetchRuns()` + `useQmoSummaryQuery()` を順に呼ぶ二段構成。React Query が
//    `runs` list の cache を共有するため、他の view との重複 fetch にはならない。
//
// silent failure 防衛:
//  - runs list 取得失敗時は `latestRunId === undefined` で QMO query を disable する
//    (placeholder banner が表示されないだけ)。runs list の error は `useQuery` 経由で
//    surface されるので app-level error boundary に届く。
//  - QMO query 側の console.error は `useQmoSummaryQuery` で出力される。

import { useQuery } from "@tanstack/react-query";
import type { QmoSummary, RunListItem } from "@pwqa/shared";

import { fetchRuns } from "@/api/client";

import { useQmoSummaryQuery } from "./use-qmo-summary-query";

export interface UseLatestQmoSummaryResult {
  /** 取得した QMO summary (200=Summary, 409=null, fetch 前=undefined). */
  readonly summary: QmoSummary | null | undefined;
  /** runs list 取得 or QMO fetch のどちらかが error 状態か。 */
  readonly isError: boolean;
  /** 最新 run が存在しないとき true (空のプロジェクトなど)。 */
  readonly isEmpty: boolean;
}

/**
 * 最新の `RunListItem` を `startedAt` の降順で取り出すヘルパ。
 * `fetchRuns` の応答は `mergeActiveAndPersistedRuns` で既に時系列降順だが、
 * 防衛的に再ソートする (バックエンド契約変更を sliently に追従しないため
 * テストで pin)。
 */
export function pickLatestRun(runs: ReadonlyArray<RunListItem>): RunListItem | undefined {
  if (runs.length === 0) return undefined;
  // 安定 sort のため slice + sort。文字列比較で ISO 8601 の `startedAt` が
  // 期待通り並ぶ。
  return [...runs].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0];
}

export function useLatestQmoSummary(): UseLatestQmoSummaryResult {
  const runsQuery = useQuery({
    queryKey: ["runs", "list"],
    queryFn: fetchRuns
  });
  const latest = runsQuery.data ? pickLatestRun(runsQuery.data.runs) : undefined;
  const qmoQuery = useQmoSummaryQuery(latest?.runId);
  const isError = runsQuery.status === "error" || qmoQuery.status === "error";
  return {
    summary: qmoQuery.data,
    isError,
    isEmpty: runsQuery.status === "success" && (runsQuery.data?.runs.length ?? 0) === 0
  };
}
