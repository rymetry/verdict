// Developer View route。ε (Issue #12) で 3-col placeholder layout を実装。
// Phase 1.2 で実データ接続する際は features/developer-view/* の各 Card props を差し替える。
//
// 設計判断:
//  - `data-testid="dev-view"` は γ で導入された router test の identifier を維持
//    (削除すると router.test.tsx が壊れる)。子要素の DeveloperView 自身は
//    `dev-view-grid` で別 id を持ち、責務 (route wrapper / layout) を分離する。
//  - Visible heading として "Developer View" 文字列も維持 (router test の `getByText(/Developer View/)`)。
//    将来文言を変えるなら router test も同時に更新する。
import * as React from "react";
import { createRoute } from "@tanstack/react-router";

import { DeveloperView } from "@/features/developer-view/DeveloperView";

import { rootRoute } from "./__root";

function DeveloperViewRoute(): React.ReactElement {
  return (
    <section data-testid="dev-view" aria-label="Developer View" className="flex flex-col gap-4">
      <DeveloperView />
    </section>
  );
}

export const devRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dev",
  component: DeveloperViewRoute
});
