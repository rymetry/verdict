// 「現在 GUI が追跡している run」とその直前リクエストを保持するストア。
// - activeRunId は WS イベント / Run Console / Failure Review が共通で参照する
// - lastRequest は「同じ条件で再実行」UI を後段 Phase で実現する際の入力源
// - WebSocket connection そのものは serialize 不可かつ StrictMode の二重 mount と
//   相性が悪いため store には入れず、useWorkbenchEvents hook でライフサイクル管理する。
// - run のライフサイクルステータス (starting/running/completed 等) は本 PR では
//   ディスパッチする consumer が無いため YAGNI として未導入。後続 PR で必要になり
//   次第 RunStatus を追加する。
import type { RunRequest } from "@pwqa/shared";
import { create } from "zustand";
import { devtools } from "zustand/middleware";

interface RunStateShape {
  /** GUI が現在追跡している run。未開始 / 切替前は null */
  activeRunId: string | null;
  /** 直近に投入された RunRequest。再実行 UI 等で参照する */
  lastRequest: RunRequest | null;
}

interface RunActions {
  /** 新しい run の追跡を開始する。lastRequest と一緒に setter で受け取る */
  startTracking: (runId: string, request: RunRequest) => void;
  /** 追跡中 run をクリア (run が終わった後で UI の "active" 状態を畳むなど) */
  clearActive: () => void;
}

export type RunStore = RunStateShape & RunActions;

const isDev = typeof import.meta !== "undefined" && Boolean(import.meta.env?.DEV);

const initialRunState: RunStateShape = {
  activeRunId: null,
  lastRequest: null
};

export const useRunStore = create<RunStore>()(
  devtools(
    (set) => ({
      ...initialRunState,
      startTracking: (runId, request) => {
        set({ activeRunId: runId, lastRequest: request }, false, "run/startTracking");
      },
      clearActive: () => {
        set({ activeRunId: null }, false, "run/clearActive");
      }
    }),
    { name: "RunStore", enabled: isDev }
  )
);

/** 純粋関数版の初期 state (テスト等で reset したい場合に利用) */
export function getInitialRunState(): RunStateShape {
  return { ...initialRunState };
}
