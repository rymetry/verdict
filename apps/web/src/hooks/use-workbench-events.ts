// Workbench Agent への WebSocket 接続を React tree から分離する hook。
// δ (Issue #11) で 2 つの責務に分割した:
//   1. `useWorkbenchEvents()` — singleton EventStream を作って lifecycle を握る
//      (RootLayout から 1 回だけ呼ぶ。複数呼ぶと WS が重複する。)
//   2. `useWsConnectionState(stream)` — その EventStream の接続状態を購読する
//      (StatusBar 等から呼ぶ。`useSyncExternalStore` で React 18+ の concurrent rendering 安全)
//
// 接続オブジェクトは serialize 不可 + StrictMode 二重 mount と相性が悪いため Zustand store には
// 入れず、useState の lazy initializer で hook 内に閉じ込める。
import { useEffect, useState, useSyncExternalStore } from "react";

import {
  connectWorkbenchEvents,
  type EventStream,
  type WsConnectionState
} from "@/api/events";

/**
 * EventStream の lifecycle を React コンポーネントに紐付ける。
 *
 * 注意: **Root scope (1 箇所) でのみ呼ぶこと**。child route で呼ぶと WS 接続が view 切替えごとに
 * 切り直され、StatusBar の "connecting/disconnected" が常時点滅する。Phase 1 では `__root.tsx` 起点。
 */
export function useWorkbenchEvents(): EventStream {
  // lazy initializer: connect は副作用を起こすため初回 render 評価時にだけ走らせる
  const [stream] = useState<EventStream>(() => connectWorkbenchEvents());

  useEffect(() => {
    // unmount で接続を確実に閉じる。reconnect timer も close() 内で停止される。
    return () => stream.close();
  }, [stream]);

  return stream;
}

/**
 * EventStream の接続状態を React state として購読する。
 *
 * useSyncExternalStore を使う理由: store は外部 (WebSocket) のため tearing 安全に読む必要がある。
 * StrictMode の二重 mount でも EventStream 側は idempotent なので副作用は発生しない。
 */
export function useWsConnectionState(stream: EventStream): WsConnectionState {
  return useSyncExternalStore(
    (notify) => stream.subscribeState(() => notify()),
    () => stream.getState(),
    () => stream.getState() // SSR は使わないが getServerSnapshot は要求される
  );
}
