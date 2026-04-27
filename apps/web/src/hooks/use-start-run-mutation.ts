// `startRun` API の呼び出しを共通化するカスタムフック。
// - main.tsx の TopBar 経由 (再実行) と RunControls の form submit で同型のロジックが
//   重複していたため共通化 (DRY)。
// - 成功時に useRunStore.startTracking で active run を切替え + 関連 query を invalidate する。
// - エラー時の UI 表示は呼び出し側がラップする (mutation 自体は副作用に責任を持たない)。
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
    mutationFn: (request: RunRequest) => startRun(request),
    onSuccess: (response, request) => {
      startTracking(response.runId, request);
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
    }
  });
}
