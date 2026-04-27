// Developer View route。ε (Issue #12) で本実装を行う placeholder。
// δ (Issue #11) で Tailwind/shadcn primitives 化した。
// γ のスコープでは「URL でアクセスできる」「persona toggle で active になる」ことを満たすだけで十分。
import * as React from "react";
import { createRoute } from "@tanstack/react-router";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { rootRoute } from "./__root";

function DeveloperView(): React.ReactElement {
  return (
    <section data-testid="dev-view" className="mx-auto max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle>Developer View</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[var(--ink-3)]">
            spec / fixture / POM / locator / Git diff を扱う Developer 向けビューは ε (Issue #12)
            で実装します。
          </p>
        </CardContent>
      </Card>
    </section>
  );
}

export const devRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dev",
  component: DeveloperView
});
