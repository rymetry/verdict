// RunStatus と Badge variant / 表示ラベル / dot 色のマッピング。
// app-shell の breadcrumbs / statusbar から共通参照する純粋関数のみを置く。
// 値はデザインモック (`docs/design/concept-b-refined.html`) のステータス色相分離方針に従う。
import type { RunStatus } from "@pwqa/shared";

import type { BadgeProps } from "@/components/ui/badge";

/**
 * RunStatus → Badge variant マッピング。
 * - passed → pass (緑系 142°)
 * - failed / error → fail (赤系 27°)
 * - running → info (青系 240°) ※ 稼働中の中立
 * - queued / cancelled → default (中立)
 */
export function runStatusBadgeVariant(status: RunStatus): NonNullable<BadgeProps["variant"]> {
  switch (status) {
    case "passed":
      return "pass";
    case "failed":
    case "error":
      return "fail";
    case "running":
      return "info";
    case "queued":
    case "cancelled":
      return "default";
  }
}

/** RunStatus → 日本語ラベル (UI 表示用) */
export function runStatusLabel(status: RunStatus): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "passed":
      return "Passed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "error":
      return "Error";
  }
}

/**
 * Agent ヘルスチェックの状態を dot の色クラスに変換する。
 * - reachable: 緑 (--pass)
 * - unreachable / pending: グレー (--skip)
 * - error: 赤 (--fail)
 */
export type AgentDotState = "reachable" | "pending" | "unreachable";

export function agentDotColorClass(state: AgentDotState): string {
  switch (state) {
    case "reachable":
      return "bg-[var(--pass)] shadow-[0_0_0_3px_var(--pass-soft)]";
    case "unreachable":
      return "bg-[var(--fail)] shadow-[0_0_0_3px_var(--fail-soft)]";
    case "pending":
      return "bg-[var(--skip)] shadow-[0_0_0_3px_var(--skip-soft)]";
  }
}
