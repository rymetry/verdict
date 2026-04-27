// TanStack Router の routeTree 組み立てと createRouter による instance 生成。
//
// 採用方針: code-based routing (file-based codegen plugin は導入しない)。
//  - 5 routes 程度なら codegen の追加コストに見合う可読性向上は得られない (KISS / YAGNI)。
//  - codegen の生成物 (`routeTree.gen.ts`) を repo に commit するか .gitignore するかの議論 / CI 連携を
//    Phase 1 で抱える理由がない。
//  - 将来 routes が増えて手書きが負債化したら router-plugin/vite を導入し file-based に切り替える。
// ファイル分割は Issue #10 の意図通り `apps/web/src/routes/<name>.tsx` 単位を維持しているため、
// 「ファイル単位の認知粒度」と「codegen が必要かどうか」を分けて考えた結果である。
//
// テストでは createTestRouter (test/_helpers/render-with-router.tsx) が同じ routeTree を再利用しつつ
// `createMemoryHistory` で initialEntries を指定して任意 URL から開始できるようにしている。
import { createRouter } from "@tanstack/react-router";

import { devRoute } from "./routes/dev";
import { indexRoute } from "./routes/index";
import { qaRoute } from "./routes/qa";
import { qmoRoute } from "./routes/qmo";
import { rootRoute } from "./routes/__root";

export const routeTree = rootRoute.addChildren([
  indexRoute,
  qaRoute,
  devRoute,
  qmoRoute
]);

export const router = createRouter({
  routeTree,
  // defaultPreload: "intent" などは Phase 1 では未採用。loader/preload を持たない placeholder routes が
  // 多く、preload 戦略を入れる利点が薄い。δ/ε/ζ で各 view が data-bound になった時点で再検討する。
  defaultPreload: false
});

// Link / useNavigate / useSearch などに型を効かせるための module 拡張 (TanStack Router 公式手順)。
// この declare module は **必須**: 省略すると Link の to / params が string で型がほぼ無効になる。
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
