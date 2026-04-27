// app-shell 表示用の派生ロジック (純粋関数)。
// main.tsx から切り出すことでユニットテストを副作用無しで書けるようにする。
import type { HealthResponse } from "@pwqa/shared";

import type { AgentDotState } from "@/components/shell";

/**
 * healthQuery → AgentDotState への変換。
 * - data.ok=true: reachable (緑)
 * - data.ok=false: degraded (黄)。Agent は到達可能だが自身を unhealthy と申告している
 * - error あり: unreachable (赤)。通信失敗 / 5xx 等
 * - その他 (初回 fetch 中など): pending (グレー)
 *
 * 優先順位は data > error。HealthResponse の ok=true は最も信頼できるシグナルなので
 * 古い error が cache に残っていても reachable を採用する。
 */
export function deriveAgentState(
  data: HealthResponse | undefined,
  error: unknown
): AgentDotState {
  if (data?.ok === true) return "reachable";
  if (data?.ok === false) return "degraded";
  if (error !== null && error !== undefined) return "unreachable";
  return "pending";
}

/**
 * ProjectSummary からプロジェクト表示名を導出する (basename of rootPath)。
 * ProjectSummary 自体には name を持たないため rootPath の最終セグメントを採用する。
 * posix `/` と win32 `\\` の両方を区切り文字として扱う。
 */
export function deriveProjectDisplayName(rootPath: string): string {
  const parts = rootPath.split(/[/\\]/).filter((segment) => segment.length > 0);
  return parts.length > 0 ? parts[parts.length - 1] : rootPath;
}
