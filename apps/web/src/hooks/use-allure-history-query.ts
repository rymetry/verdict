// §1.3 Allure history query hook.
//
// `<projectRoot>/.playwright-workbench/reports/allure-history.jsonl` is
// the source of truth for cross-run trend data. The Allure CLI appends
// to it on each `allure history --history-path` invocation, so the hook keeps
// a stable polling cadence (poller-friendly) instead of subscribing to
// a WS event — history file is touched only at run completion which is
// already invalidated by `useRunStore` anyway, but a soft refetch makes
// the trend card responsive when a run finishes outside the active tab.
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { AllureHistoryResponse } from "@pwqa/shared";

import { fetchAllureHistory } from "@/api/client";

export const ALLURE_HISTORY_QUERY_KEY = ["allure-history"] as const;

export function useAllureHistoryQuery(
  projectId: string | null
): UseQueryResult<AllureHistoryResponse, Error> {
  return useQuery({
    queryKey: [...ALLURE_HISTORY_QUERY_KEY, projectId],
    queryFn: () => {
      // `enabled: projectId !== null` already gates this branch; the
      // explicit invariant is for the type narrow only.
      if (projectId === null) {
        throw new Error("useAllureHistoryQuery: projectId must not be null when enabled");
      }
      return fetchAllureHistory(projectId);
    },
    enabled: projectId !== null,
    // Run history changes only after the post-run Allure history step. A 30s
    // refetch keeps the trend card warm without hammering the agent.
    refetchInterval: 30_000,
    staleTime: 5_000,
  });
}
