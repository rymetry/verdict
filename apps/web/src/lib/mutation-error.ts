// React Query の mutation / query エラーを UI 表示用文字列に正規化する。
// - WorkbenchApiError は `${code}: ${message}` 形式で詳細を保持
// - 標準 Error は message を採用
// - それ以外 (string throw 等) はジェネリックな fallback
// 副作用なしの純粋関数。複数の error UI (RunControls / 将来 toast) で再利用する。
import { WorkbenchApiError } from "@/api/client";

export function formatMutationError(error: unknown, fallback: string): string {
  if (error instanceof WorkbenchApiError) {
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}
