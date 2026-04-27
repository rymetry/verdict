// テスト用 render ヘルパ。production と同じ routeTree (`@/router`) を流用しつつ、
// `createMemoryHistory` で initialEntries を注入することで任意 URL から開始できるようにする。
//
// なぜ独自に router を毎回作るのか:
//  - 本番 router は singleton (createRouter は一度しか呼ばれない想定)。
//    test 間で共有すると navigate の副作用が漏れて flaky になるため、
//    各テストで `createRouter({ routeTree, history })` を新規生成する。
//  - 同様に QueryClient も毎回新規 (defaults.queries.retry: false で test の安定化)。
import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRouter,
  RouterProvider
} from "@tanstack/react-router";
import { render, type RenderResult } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { routeTree } from "@/router";

interface RenderRouterOptions {
  /** 開始 URL (省略時は "/qa") */
  initialPath?: string;
  /** QueryClient defaults を上書きしたい場合に渡す */
  queryClient?: QueryClient;
}

// createRouter の戻り型は routeTree の generics から narrow されるため、
// ReturnType<...> 経由の default 形では受け取れない。inference に任せる。
function createTestRouter(initialPath: string) {
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
    defaultPreload: false
  });
}

interface RenderRouterResult extends RenderResult {
  user: ReturnType<typeof userEvent.setup>;
  queryClient: QueryClient;
  /** test 内で navigate / location 直接検証が必要な場合に使う */
  router: ReturnType<typeof createTestRouter>;
}

export function renderWithRouter(
  options: RenderRouterOptions = {}
): RenderRouterResult {
  const { initialPath = "/qa", queryClient: providedClient } = options;

  // queries.retry: false / refetchInterval: false で polling/retry のテストノイズを抑える。
  // mutations.retry は **明示的に上書きしない**: useStartRunMutation 側の `retry: 0` invariant が
  // end-to-end で効いていることを test client 経由でも pin する。
  const queryClient =
    providedClient ??
    new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchInterval: false }
      }
    });

  const router = createTestRouter(initialPath);
  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );

  return {
    ...result,
    user: userEvent.setup(),
    queryClient,
    router
  };
}
