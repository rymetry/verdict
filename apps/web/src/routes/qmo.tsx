// Insights (旧 QMO) View route。ζ (Issue #13) で本実装を行う placeholder。
// γ (Issue #10) のスコープでは「URL でアクセスできる」「persona toggle で active になる」ことを満たすだけで十分。
//
// path 名: persona segment は当面 `qmo` を維持する (PERSONA_VIEWS と一致)。
// ζ で Allure 連携実装時に "/insights" へリネームするか改めて議論する (Issue #10 やること欄)。
import * as React from "react";
import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./__root";

function InsightsView(): React.ReactElement {
  return (
    <section className="grid" data-testid="qmo-view">
      <article className="panel">
        <p className="panelLabel">Insights View</p>
        <p className="muted">
          QMO / Release Owner 向けの Quality Gate / Allure history / Release Readiness Summary は
          ζ (Issue #13) で実装します。
        </p>
      </article>
    </section>
  );
}

export const qmoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/qmo",
  component: InsightsView
});
