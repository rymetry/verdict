// 単一コンポーネントのユニットテスト向けに、最小構成の router context を提供する。
// app の routeTree (`@/router`) を持ち込むと vi.mock 設定 (api/client / use-workbench-events 等) を
// 各テストで揃える必要があり、本来の関心 (= 個々の component の振る舞い) と無関係なノイズが増える。
// 本ヘルパは `<RouterProvider>` の最低限を満たすため、root + catch-all `/` route だけを持つ。
//
// PersonaToggle のように `useNavigate` を直接呼ぶ component を render する用途に使う。
// 対象 component を root の component として埋め込むため、navigate 後の副作用は test の関心外
// (NavigationSpy 用途には向かない — 必要な場合は renderWithRouter を使う)。
import * as React from "react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider
} from "@tanstack/react-router";

// TanStack Router は rootRoute だけでは "/" に match させない。
// rootRoute は layout として `<Outlet />` を出し、`/` の child route を別途用意する必要がある。
// 戻り値の型は TypeScript の inference に任せる: createRouter は routeTree の型から
// 強く narrow した型を返すため、ReturnType<typeof createRouter> という default 形では
// 型が一致せず代入互換に失敗する。
export function renderInMinimalRouter(node: React.ReactNode) {
  const rootRoute = createRootRoute({
    component: () => <Outlet />
  });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <>{node}</>
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] })
  });
  const Wrapper: React.FC = () => <RouterProvider router={router} />;
  return { router, Wrapper };
}
