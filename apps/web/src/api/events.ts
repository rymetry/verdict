// Local Agent との WebSocket 接続を抽象化する EventStream。
// - StatusBar に "connecting / open / disconnected" を出すため接続状態も購読可能にする
//   (Issue #11 silent failure ガードの一環: 暗黙の通信不能を可視化する)。
// - スキーマ不一致の payload は本番でも console.error で痕跡を残す
//   (CLAUDE.md `Never silently swallow errors` 方針)。
import {
  WorkbenchEventSchema,
  type WorkbenchEvent
} from "@pwqa/shared";

export type EventListener = (event: WorkbenchEvent) => void;

/**
 * WebSocket 接続の状態。
 *  - connecting: 初回 connect / 再接続中 (ユーザー視点では「待機」)
 *  - open: 接続済み (Agent と通信可能)
 *  - disconnected: 接続不能 (再接続を試行中であっても、現時点では Agent と疎通していない)
 *
 * StatusBar はこの状態を dot 色とテキストで表示する。
 * "reconnecting" を別状態に分けない理由: ユーザー視点では connecting と区別する意味が薄く、
 * 既に Agent 死亡が `/health` ポーリングで検出される (StatusBar の Agent dot)。
 */
export type WsConnectionState = "connecting" | "open" | "disconnected";

export type StateListener = (state: WsConnectionState) => void;

export interface EventStream {
  /** Workbench events を購読する。 */
  subscribe(listener: EventListener): () => void;
  /** WS 接続状態の変化を購読する。subscribe 直後に現在値を 1 回 push する。 */
  subscribeState(listener: StateListener): () => void;
  /** 現在の接続状態を即時取得する (purely-functional な参照、reactive ではない)。 */
  getState(): WsConnectionState;
  /** 接続を閉じる。再接続タイマもクリアする。 */
  close(): void;
}

const RECONNECT_DELAY_MS = 1500;

export function connectWorkbenchEvents(): EventStream {
  const listeners = new Set<EventListener>();
  const stateListeners = new Set<StateListener>();
  let socket: WebSocket | undefined;
  let closed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let state: WsConnectionState = "connecting";

  function setState(next: WsConnectionState): void {
    if (state === next) return;
    state = next;
    for (const l of stateListeners) {
      try {
        l(next);
      } catch (error) {
        // listener 内 throw は本来 application bug。silent にすると subscribe 側の
        // 初期化漏れを覆い隠すため、production でも痕跡を残す。
        // eslint-disable-next-line no-console -- listener bug を本番でも検知
        console.error("[events] state listener threw", error);
      }
    }
  }

  function url(): string {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/ws`;
  }

  function connect(): void {
    if (closed) return;
    setState("connecting");
    socket = new WebSocket(url());

    socket.addEventListener("open", () => {
      setState("open");
    });

    socket.addEventListener("message", (raw) => {
      const data: unknown = (() => {
        try {
          return JSON.parse(raw.data as string);
        } catch (error) {
          // 不正 JSON は invariant 違反 (Agent 側で zod validation 済の payload を送る契約)。
          // silent return せず production でも検出する。
          // eslint-disable-next-line no-console -- 不正 payload を本番でも検出
          console.error("[events] WS message JSON parse failed", error);
          return undefined;
        }
      })();
      if (!data) return;
      const parsed = WorkbenchEventSchema.safeParse(data);
      if (!parsed.success) {
        // schema 不一致も Agent 側 contract violation。production でも痕跡を残す
        // (γ で残した follow-up を本 Issue で消化)。
        // eslint-disable-next-line no-console -- schema 不一致を本番でも検出
        console.error("[events] WS event schema mismatch", parsed.error.issues);
        return;
      }
      for (const listener of listeners) listener(parsed.data);
    });

    socket.addEventListener("close", () => {
      if (closed) return;
      setState("disconnected");
      reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
    });

    socket.addEventListener("error", () => {
      // error は通常 close と続けて来るため state 切替えは close ハンドラに任せる。
      // ここでは socket.close() を明示し、リトライ経路へ確実に遷移させる。
      socket?.close();
    });
  }

  connect();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeState(listener) {
      stateListeners.add(listener);
      // 購読直後の current state を 1 回 push (StatusBar 等が初回 render から正しい色を出すため)
      try {
        listener(state);
      } catch (error) {
        // eslint-disable-next-line no-console -- listener bug を本番でも検知
        console.error("[events] state listener threw on subscribe", error);
      }
      return () => {
        stateListeners.delete(listener);
      };
    },
    getState() {
      return state;
    },
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
      setState("disconnected");
    }
  };
}
