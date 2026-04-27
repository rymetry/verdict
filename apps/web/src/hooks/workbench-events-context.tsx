// Workbench EventStream を React Context 経由で配るための Provider / hook。
//
// 経緯: γ (Issue #10) では useWorkbenchEvents を qa.tsx 内に閉じ、view 離脱で WS を切る設計を採った。
// δ (Issue #11) では StatusBar が WS 接続状態を常時表示する要件が加わったため、Root scope に WS を
// 1 つ持ち、route 切替えで切れない singleton にする。代わりに qa.tsx 内の RunConsole は Context 経由で
// その singleton を参照する。
//
// 直接 props drill しない理由:
//   - Outlet 経由の child route に props は渡せず、TanStack Router の context 機構を使うとテスト時の
//     router 構築コストが増える。
//   - WS は「常に存在する」前提のため、`useWorkbenchEventStream()` が undefined を返す可能性を握り潰す
//     パスを作らない。Provider 不在のとき throw で fail-fast にする (silent failure 防衛)。
import * as React from "react";

import type { EventStream } from "@/api/events";

const WorkbenchEventsContext = React.createContext<EventStream | null>(null);

interface ProviderProps {
  stream: EventStream;
  children: React.ReactNode;
}

export function WorkbenchEventsProvider({ stream, children }: ProviderProps): React.ReactElement {
  return (
    <WorkbenchEventsContext.Provider value={stream}>{children}</WorkbenchEventsContext.Provider>
  );
}

/**
 * 現在の EventStream を取得する。Provider 不在時は throw する (silent fallback しない)。
 *
 * ここで undefined を返して caller 側で握り潰す設計にすると、テストや route 構成漏れで
 * RunConsole が「永久に何も表示しない」黒画面になっても気付けない。明示 throw で fail-fast。
 */
export function useWorkbenchEventStream(): EventStream {
  const stream = React.useContext(WorkbenchEventsContext);
  if (stream === null) {
    throw new Error(
      "useWorkbenchEventStream() must be called inside <WorkbenchEventsProvider>. " +
        "RootLayout で WS singleton を生成し、Outlet を Provider で囲むこと。"
    );
  }
  return stream;
}
