// `startRun` API の呼び出しを共通化するカスタムフック。
// - main.tsx の TopBar 経由 (再実行) と RunControls の form submit で同型のロジックが
//   重複していたため共通化 (DRY)。
// - 成功時に useRunStore.startTracking で active run を切替え + 関連 query を invalidate する。
// - エラー時の UI 表示は呼び出し側が **必ず** `mutation.error` を `formatMutationError` 経由で
//   ShellAlert 等に流し込む契約。caller がエラー surface を忘れると silent failure になるため、
//   新規 caller を追加する場合はテストで surface 経路を pin すること。
//
// 型: `Error | WorkbenchApiError` の union で WorkbenchApiError の `code` / `status` も narrow できる。
// ただし `mutationFn` から throw されうる zod ParseError 等は Error として扱う。
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { RunMetadata, RunRequest } from "@pwqa/shared";

import { startRun, WorkbenchApiError } from "@/api/client";
import { useRunStore } from "@/store/run-store";

export type StartRunMutation = UseMutationResult<
  { runId: string; metadata: RunMetadata },
  WorkbenchApiError | Error,
  RunRequest
>;

export function useStartRunMutation(): StartRunMutation {
  const queryClient = useQueryClient();
  const startTracking = useRunStore((s) => s.startTracking);
  return useMutation({
    mutationFn: startRun,
    onSuccess: (response, request) => {
      startTracking(response.runId, request);
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
    }
  });
}
