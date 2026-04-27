// 「現在 GUI が追跡している run」とその直前リクエストを保持するストア。
// - activeRunId は WS イベント / Run Console / Failure Review が共通で参照する
// - lastRequest は「同じ条件で再実行」UI を後段 Phase で実現する際の入力源として残す
// - WebSocket connection そのものは serialize 不可かつ StrictMode の二重 mount と
//   相性が悪いため store には入れず、useWorkbenchEvents hook でライフサイクル管理する。
// - run のライフサイクルステータス (starting/running/completed 等) は η (Issue #8) 時点で
//   ディスパッチする consumer が無いため YAGNI として未導入。RunConsole 側で
//   starting/running/completed を分岐表示する必要が出た時点で `RunStatus` を追加する。
import type { RunRequest } from "@pwqa/shared";
import { create } from "zustand";
import { devtools } from "zustand/middleware";

import { isDev } from "./env";

interface RunStateShape {
  /** GUI が現在追跡している run。未開始 / 切替前は null */
  activeRunId: string | null;
  /** 直近に投入された RunRequest。再実行 UI 等で参照する */
  lastRequest: RunRequest | null;
}

interface RunActions {
  /**
   * 新しい run の追跡を開始する。illegal state (activeRunId != null かつ
   * lastRequest == null) を作らないよう、両者を必ず同時に更新する。
   */
  startTracking: (runId: string, request: RunRequest) => void;
  /** 追跡中 run をクリア (run が終わった後で UI の "active" 状態を畳むなど)。lastRequest は再実行用に残す */
  clearActive: () => void;
}

export type RunStore = RunStateShape & RunActions;

const initialRunState: RunStateShape = {
  activeRunId: null,
  lastRequest: null
};

export const useRunStore = create<RunStore>()(
  devtools(
    (set) => ({
      ...initialRunState,
      startTracking: (runId, request) => {
        // illegal state の早期検出: 空文字 / 非文字列を弾く
        if (typeof runId !== "string" || runId.length === 0) {
          throw new Error("startTracking: runId は空でない文字列である必要があります");
        }
        set({ activeRunId: runId, lastRequest: request }, false, "run/startTracking");
      },
      clearActive: () => {
        set({ activeRunId: null }, false, "run/clearActive");
      }
    }),
    { name: "RunStore", enabled: isDev }
  )
);

/**
 * テスト等で初期 state へ戻すためのファクトリ。毎回新しいオブジェクトを返すため、
 * 呼び出し側の mutation でモジュール内の定数が汚染されない。
 */
export function createInitialRunState(): RunStateShape {
  return { ...initialRunState };
}
