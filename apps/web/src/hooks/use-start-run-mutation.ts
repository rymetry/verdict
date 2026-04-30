// `startRun` API の呼び出しを共通化するカスタムフック。
// - `__root.tsx` の rerun mutation と `routes/qa.tsx` の RunControls form submit で同型のロジックが
//   重複していたため共通化 (DRY)。
// - 成功時に useRunStore.startTracking で active run を切替え + 関連 query を invalidate する。
// - エラー時の UI 表示は呼び出し側が **必ず** `mutation.error` を `formatMutationError` 経由で
//   ShellAlert / errorBlock 等に流し込む契約。
//   ただし caller の surface 漏れを silent にしないよう、本フック側でも onError で console.error する
//   (defense-in-depth)。production でも console drop されない invariant (vite.config.ts) と組み合わせて、
//   起動失敗が完全 silent になる経路を遮断する。
//
// retry: 0 は POST /runs が副作用的 (run 起動) なので必須。
//   TanStack Query v5 では mutation の retry default も 0 だが、将来 main.tsx の QueryClient で
//   `defaultOptions.mutations.retry` が別値に上書きされた場合、ユーザの 1 click が複数 run の
//   silent な多重起動になる。defense-in-depth として明示固定する (test/hooks/use-start-run-mutation.test.tsx
//   で `retry: 3` 注入した QueryClient 上でも 1 回しか呼ばれないことを pin)。
//
// 型: 戻り値の error は `Error` (`UseMutationResult` 既定の `Error` 制約をそのまま使う)。
//   `WorkbenchApiError extends Error` のため、例えば `Error | WorkbenchApiError` は
//   構造的部分型として `Error` と同一視されて collapse する。詳細を取り出す際は caller 側で
//   `error instanceof WorkbenchApiError` で runtime narrow する (`formatMutationError` がその
//   runtime narrow を担当する)。
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { RunListResponse, RunMetadata, RunRequest } from "@pwqa/shared";

import { startRun } from "@/api/client";
import { useRunStore } from "@/store/run-store";

export type StartRunMutation = UseMutationResult<
  { runId: string; metadata: RunMetadata },
  Error,
  RunRequest
>;

export function useStartRunMutation(): StartRunMutation {
  const queryClient = useQueryClient();
  const startTracking = useRunStore((s) => s.startTracking);
  return useMutation({
    mutationFn: startRun,
    retry: 0,
    onSuccess: (response, request) => {
      startTracking(response.runId, request);
      queryClient.setQueryData(["runs", response.runId], response.metadata);
      queryClient.setQueryData<RunListResponse>(["runs", "list"], (current) => {
        const existing = current?.runs ?? [];
        return {
          runs: [
            response.metadata,
            ...existing.filter((run) => run.runId !== response.runId)
          ]
        };
      });
      // invalidate は副作用的だが、同じ queryKey を購読しているコンポーネントの refetch 漏れを
      // 防ぐため、rejection は log だけ残して握りつぶさない。本フックの呼び出し成功 (run 起動成功)
      // 自体は完了しており、UI 状態は startTracking で先に確定しているため、ここで例外を上に
      // 投げると意図せず caller に副作用エラーが流れてしまう。
      queryClient.invalidateQueries({ queryKey: ["runs"] }).catch((error) => {
        // eslint-disable-next-line no-console -- invalidate 失敗を本番でも検出
        console.error("[useStartRunMutation] invalidateQueries failed", error);
      });
    },
    onError: (error, variables) => {
      // caller が UI 上で `mutation.error` を surface する契約。それを忘れた場合の silent 化を
      // 防ぐため、フック側でも console.error しておく (production でも drop されない)。
      // variables (= RunRequest) を一緒に出すことで、どの run 起動が失敗したか後追い可能にする。
      // eslint-disable-next-line no-console -- POST /runs 失敗は本番でも痕跡を残す
      console.error("[useStartRunMutation] startRun failed", {
        projectId: variables.projectId,
        specPath: variables.specPath,
        grep: variables.grep,
        error
      });
    }
  });
}
