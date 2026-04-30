// `GET /api/runs/:runId/qmo-summary` の TanStack Query フック (Phase 1.2 / T208-2).
//
// Insights View が Phase 1.2 完了後に表示する Release Readiness Summary を fetch する。
// 410 / 409 (NO_QMO_SUMMARY) は実装上「まだ生成されていない」シグナルとして
// `client.fetchQmoSummary` が `null` を返す → useQuery 上は `data: null` で扱う。
// それ以外の失敗 (404 NOT_FOUND, 500 INVALID_QMO_SUMMARY 等) は throw されるため
// `query.error` で表面化する。
//
// silent failure 防衛: `useCurrentProjectQuery` と同じ pattern で `query.error` を
// effect で console.error する。production でも痕跡を残し、PR review で indirection
// が増えても original signal が消えないようにする。
//
// polling: 409 NO_QMO_SUMMARY は一時状態として扱う。`data === null` の間だけ
// 短周期 polling し、200 の QMO summary を取得したら止める。

import { useEffect } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { QmoSummary } from "@pwqa/shared";

import { fetchQmoSummary } from "@/api/client";

/**
 * `runId` を渡すと Release Readiness Summary を fetch する hook。
 *
 * - `runId === undefined`: query disabled (data === undefined)
 * - 200: data === QmoSummary
 * - 409 NO_QMO_SUMMARY: data === null (T208-1 の契約)
 * - その他失敗: status === "error" + console.error 出力 + UI 側で error boundary に届く
 */
export function useQmoSummaryQuery(
  runId: string | undefined
): UseQueryResult<QmoSummary | null, Error> {
  const query = useQuery({
    queryKey: ["runs", runId, "qmo-summary"],
    queryFn: () => fetchQmoSummary(runId!),
    enabled: typeof runId === "string" && runId.length > 0,
    refetchInterval: (query) => (query.state.data === null ? 1_000 : false)
  });

  useEffect(() => {
    if (query.status === "error" && query.error) {
      // eslint-disable-next-line no-console -- QMO summary fetch failure を本番でも痕跡を残す
      console.error("[useQmoSummaryQuery] fetchQmoSummary failed", query.error);
    }
  }, [query.status, query.error]);

  return query;
}
