// Workbench Agent への WebSocket 接続をコンポーネントツリーから分離するための custom hook。
// - 接続オブジェクトは serialize 不可かつ StrictMode の二重 mount と相性が悪いため
//   Zustand store には入れず、useState の lazy initializer で hook 内に閉じ込める。
// - 戻り値の EventStream は subscribe / close API を持つので、消費側 (RunConsole 等) は
//   通常通り subscribe してメッセージを受け取る。
// - hook を呼び出した React コンポーネントの unmount で close される。
//   App ルート (main.tsx の <App />) で 1 回だけ呼ぶことを想定する。
import { useEffect, useState } from "react";

import { connectWorkbenchEvents, type EventStream } from "@/api/events";

export function useWorkbenchEvents(): EventStream {
  // lazy initializer: connect は副作用を起こすため初回 render の評価時にだけ走らせる
  const [stream] = useState<EventStream>(() => connectWorkbenchEvents());

  useEffect(() => {
    // unmount で接続を確実に閉じる。reconnect timer も close() 内で停止される。
    return () => stream.close();
  }, [stream]);

  return stream;
}
