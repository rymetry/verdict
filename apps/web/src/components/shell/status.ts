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

/**
 * RunStatus → UI 表示用ラベル。
 * デザインモック準拠で英語ラベルを返す。i18n 化の際は本関数を差し替え点とする。
 */
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
 * Agent 接続状態を表す離散値。
 * - reachable: `/health` が 200 + ok=true。緑 (--pass)
 * - degraded: `/health` は 200 だが ok=false (Agent 自身が degraded を申告)。黄 (--flaky)
 * - unreachable: 通信失敗 (network error / 5xx / 接続拒否)。赤 (--fail)
 * - pending: 初回 fetch 中で data も error も無い状態。グレー (--skip)
 *
 * 「reachable だが unhealthy」を pending に潰さないために degraded を分離している
 * (silent failure 監査での指摘反映)。RunStatus と同様、switch には default を置かず
 * 型の網羅性チェックで新値追加時にコンパイル失敗させる方針。
 */
export type AgentDotState = "reachable" | "degraded" | "pending" | "unreachable";

export function agentDotColorClass(state: AgentDotState): string {
  switch (state) {
    case "reachable":
      return "bg-[var(--pass)] shadow-[0_0_0_3px_var(--pass-soft)]";
    case "degraded":
      return "bg-[var(--flaky)] shadow-[0_0_0_3px_var(--flaky-soft)]";
    case "unreachable":
      return "bg-[var(--fail)] shadow-[0_0_0_3px_var(--fail-soft)]";
    case "pending":
      return "bg-[var(--skip)] shadow-[0_0_0_3px_var(--skip-soft)]";
  }
}
