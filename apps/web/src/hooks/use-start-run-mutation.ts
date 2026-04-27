// `startRun` API の呼び出しを共通化するカスタムフック。
// - main.tsx の TopBar 経由 (再実行) と RunControls の form submit で同型のロジックが
//   重複していたため共通化 (DRY)。
// - 成功時に useRunStore.startTracking で active run を切替え + 関連 query を invalidate する。
// - エラー時の UI 表示は呼び出し側が **必ず** `mutation.error` を `formatMutationError` 経由で
//   ShellAlert 等に流し込む契約。caller がエラー surface を忘れると silent failure になるため、
//   新規 caller を追加する場合はテストで surface 経路を pin すること。
//
// retry: 0 は POST /runs が副作用的 (run を起動する) なので必須。
//   React Query デフォルトの 3 回 retry が走ると、ユーザは 1 回 click したのに run が複数走る
//   silent な多重起動を起こす。
//
// 型: 戻り値の error は `Error` (`UseMutationResult` 既定の `Error` 制約をそのまま使う)。
//   `WorkbenchApiError extends Error` のため Error union を増やしても TS は同じ型へ collapse する。
//   詳細を取り出す際は caller 側で `error instanceof WorkbenchApiError` で runtime narrow する
//   (`formatMutationError` がその runtime narrow を担当する)。
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { RunMetadata, RunRequest } from "@pwqa/shared";

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
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
    }
  });
}
