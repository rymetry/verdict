// React Query の mutation / query エラーを UI 表示用文字列に正規化する。
// - WorkbenchApiError は `${code}: ${message}` 形式で詳細を保持
// - 標準 Error は message を採用 (空文字 / undefined は fallback に倒す)
// - それ以外 (string throw 等) はジェネリックな fallback
//
// 「instanceof Error の子クラス全てをカバーするか」: WorkbenchApiError は extends Error なので
// `instanceof Error` でも true になる。本関数は WorkbenchApiError を**先に判定**することで
// `code: message` のリッチ表示を優先する。順序を入れ替えると詳細情報が失われるため重要。
//
// 副作用なしの純粋関数。複数の error UI (RunControls / ShellAlert / 将来 toast) で再利用する。
import { WorkbenchApiError } from "@/api/client";

export function formatMutationError(error: unknown, fallback: string): string {
  if (error instanceof WorkbenchApiError) {
    // code は内部 enum、message は API 由来。空 message のときは code だけ + fallback で詳細を補う。
    return error.message.length > 0
      ? `${error.code}: ${error.message}`
      : `${error.code}: ${fallback}`;
  }
  if (error instanceof Error) {
    // 空 message な Error 子クラス (将来の zod ParseError 等) で「(空)」を出さないよう fallback
    return error.message.length > 0 ? error.message : fallback;
  }
  return fallback;
}
