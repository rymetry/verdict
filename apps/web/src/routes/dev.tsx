// Developer View route。ε (Issue #12) で 3-col placeholder layout を実装。
// Phase 1.2 で実データ接続する際は features/developer-view/* の各 Card props を差し替える。
//
// 設計判断:
//  - `data-testid="dev-view"` は γ で導入された router test の identifier を維持
//    (削除すると router.test.tsx が壊れる)。子要素の DeveloperView 自身は
//    `dev-view-grid` で別 id を持ち、責務 (route wrapper / layout) を分離する。
//  - Section の `aria-label="Developer View"` を維持 (router test の
//    `toHaveAttribute("aria-label", "Developer View")` で pin)。文言を変えるなら
//    router.test.tsx も同時に更新する。
//  - Phase 1 placeholder fixture は `features/developer-view/placeholder-data.ts` から
//    明示的に import して props で各 Card に渡す。各 Card の Props は必須化されており
//    default fallback を持たないため、Phase 1.2 で `useQuery` 経路に切り替える際は
//    本ファイルの fixture import を削除して API 結果を渡せば silent fallback は構造上発生しない。
import * as React from "react";
import { createRoute } from "@tanstack/react-router";

import { DeveloperView } from "@/features/developer-view/DeveloperView";
import {
  SAMPLE_CONSOLE,
  SAMPLE_DIFF,
  SAMPLE_FILE_TREE,
  SAMPLE_LOCATOR,
  SAMPLE_RUN_METADATA,
  SAMPLE_SOURCE,
  SAMPLE_TERMINAL
} from "@/features/developer-view/placeholder-data";

import { rootRoute } from "./__root";

function DeveloperViewRoute(): React.ReactElement {
  return (
    <section data-testid="dev-view" aria-label="Developer View" className="flex flex-col gap-4">
      <DeveloperView
        fileTreeGroups={SAMPLE_FILE_TREE}
        source={SAMPLE_SOURCE}
        diff={SAMPLE_DIFF}
        terminal={SAMPLE_TERMINAL}
        locator={SAMPLE_LOCATOR}
        consoleEntries={SAMPLE_CONSOLE}
        runMetadata={SAMPLE_RUN_METADATA}
      />
    </section>
  );
}

export const devRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dev",
  component: DeveloperViewRoute
});
