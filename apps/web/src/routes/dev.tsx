// Developer View route。ε (Issue #12) で本実装を行う placeholder。
// γ (Issue #10) のスコープでは「URL でアクセスできる」「persona toggle で active になる」ことを満たすだけで十分。
import * as React from "react";
import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./__root";

function DeveloperView(): React.ReactElement {
  return (
    <section className="grid" data-testid="dev-view">
      <article className="panel">
        <p className="panelLabel">Developer View</p>
        <p className="muted">
          spec / fixture / POM / locator / Git diff を扱う Developer 向けビューは ε (Issue #12)
          で実装します。
        </p>
      </article>
    </section>
  );
}

export const devRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dev",
  component: DeveloperView
});
