// `/` (index) は QA View にリダイレクトする。
// `redirect` を beforeLoad / loader で `throw` することで、ナビゲーション解決前にリダイレクトが
// 適用される (= 一瞬でも index 画面が描画されない)。`replace: true` で履歴に / を残さない。
import { createRoute, redirect } from "@tanstack/react-router";

import { rootRoute } from "./__root";

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/qa", replace: true });
  }
});
