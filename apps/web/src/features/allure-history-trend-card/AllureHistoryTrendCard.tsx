// §1.3 Allure history trend card.
//
// Renders the most recent N entries of
// `<projectRoot>/.playwright-workbench/reports/allure-history.jsonl` as a
// compact pass/fail/total row. PoC-grade: no chart, no per-test drill-down
// — those belong to Phase 5 / Phase 6. The card exists primarily to prove
// that the §1.3 pipeline (CLI write → Workbench read → GUI render) is
// wired end-to-end, and to give operators an at-a-glance regression signal.
//
// Empty / error states are surfaced as discreet text: showing "no data" is
// the dominant case for new projects, so we degrade silently to keep the
// QMO route uncluttered.
import * as React from "react";
import type { AllureHistoryEntry } from "@pwqa/shared";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAllureHistoryQuery } from "@/hooks/use-allure-history-query";

const MAX_VISIBLE_ENTRIES = 5;

interface AllureHistoryTrendCardProps {
  /** Project id (=realpath). null while no project is open. */
  projectId: string | null;
}

export function AllureHistoryTrendCard({
  projectId
}: AllureHistoryTrendCardProps): React.ReactElement | null {
  const query = useAllureHistoryQuery(projectId);

  if (projectId === null) {
    return null;
  }

  if (query.isPending) {
    return (
      <Card data-testid="allure-history-trend-card-loading">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Allure history</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-[var(--ink-3)]">Loading trend…</p>
        </CardContent>
      </Card>
    );
  }

  if (query.isError) {
    return (
      <Card data-testid="allure-history-trend-card-error">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Allure history</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-[var(--danger-1)]">
            Failed to load Allure history.
          </p>
        </CardContent>
      </Card>
    );
  }

  const entries = query.data?.entries ?? [];
  if (entries.length === 0) {
    return (
      <Card data-testid="allure-history-trend-card-empty">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Allure history</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-[var(--ink-3)]">
            No history yet. Trigger an Allure-enabled run twice to populate the trend.
          </p>
        </CardContent>
      </Card>
    );
  }

  const recent = entries.slice(-MAX_VISIBLE_ENTRIES);

  return (
    <Card data-testid="allure-history-trend-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">
          Allure history (last {recent.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-1.5">
          {recent.map((entry, index) => (
            <li
              key={entry.runUuid ?? `${entry.generatedAt}-${index}`}
              data-testid="allure-history-trend-row"
              className="flex items-center justify-between gap-2 text-xs"
            >
              <span className="text-[var(--ink-3)]">
                {formatTimestamp(entry.generatedAt)}
              </span>
              <span className="font-mono text-[var(--ink-1)]">
                {formatCounters(entry)}
              </span>
            </li>
          ))}
        </ul>
        {query.data && query.data.warnings.length > 0 ? (
          <p className="mt-2 text-[10px] text-[var(--ink-3)]">
            {query.data.warnings.length} entry skipped (parse / schema)
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function formatTimestamp(generatedAt: string): string {
  // Allure CLI emits ISO timestamps. We render the time portion to keep
  // the row compact; the date is implied by recency. Locale-aware
  // formatting is deliberately avoided (PoC determinism over polish).
  return generatedAt.replace("T", " ").slice(0, 16);
}

function formatCounters(entry: AllureHistoryEntry): string {
  const total = entry.total ?? 0;
  const passed = entry.passed ?? 0;
  const failed = entry.failed ?? 0;
  return `${passed}/${total} pass · ${failed} fail`;
}
