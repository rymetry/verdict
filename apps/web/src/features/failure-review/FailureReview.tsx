import { useQuery } from "@tanstack/react-query";
import { fetchRun } from "../../api/client";
import type { FailedTest } from "@pwqa/shared";

interface FailureReviewProps {
  runId?: string;
}

export function FailureReview({ runId }: FailureReviewProps) {
  const runQuery = useQuery({
    queryKey: ["runs", runId],
    queryFn: async () => (runId ? fetchRun(runId) : null),
    enabled: Boolean(runId),
    refetchInterval: 2000
  });

  if (!runId) {
    return (
      <div className="locator-card">
        <h4>失敗レビュー</h4>
        <div>
          <p className="muted-note">
            run を開始すると失敗の詳細がここに表示されます。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="locator-card">
      <h4>失敗レビュー</h4>
      <div>
        {runQuery.isLoading ? (
          <p className="muted-note">run メタデータを取得中…</p>
        ) : runQuery.error ? (
          <p className="error-inline" style={{ marginTop: 0 }}>
            {errorMessage(runQuery.error)}
          </p>
        ) : runQuery.data?.summary?.failedTests?.length ? (
          <FailedTestList failedTests={runQuery.data.summary.failedTests} />
        ) : (
          <p className="muted-note">
            {runQuery.data?.status === "passed"
              ? "全テスト合格"
              : runQuery.data?.summary
                ? "失敗テストはありません"
                : "run の完了を待機中…"}
          </p>
        )}
      </div>
    </div>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unexpected error";
}

function FailedTestList({ failedTests }: { failedTests: FailedTest[] }) {
  return (
    <ul
      style={{
        margin: 0,
        padding: 0,
        listStyle: "none",
        display: "flex",
        flexDirection: "column",
        gap: 14
      }}
    >
      {failedTests.map((test, index) => (
        <li
          key={`${test.testId ?? test.fullTitle ?? test.title}-${index}`}
          style={{
            paddingBottom: 14,
            borderBottom: "1px solid var(--line-faint)"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="badge failed">Failed</span>
            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--fail)" }}>
              {test.fullTitle ?? test.title}
            </h3>
          </div>
          <p
            style={{
              margin: "4px 0 0",
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--ink-3)"
            }}
          >
            {test.filePath ?? "unknown"}
            {test.line ? `:${test.line}` : ""}
            {test.durationMs !== undefined ? ` · ${(test.durationMs / 1000).toFixed(1)}s` : ""}
          </p>
          {test.message ? (
            <pre
              style={{
                margin: "8px 0 0",
                padding: "10px 12px",
                border: "1px solid color-mix(in oklch, var(--fail) 30%, transparent)",
                borderLeft: "3px solid var(--fail)",
                borderRadius: "var(--radius-sm)",
                background: "var(--fail-soft)",
                color: "var(--ink-0)",
                fontFamily: "var(--mono)",
                fontSize: 12,
                lineHeight: 1.55,
                whiteSpace: "pre-wrap",
                overflowX: "auto"
              }}
            >
              {test.message}
            </pre>
          ) : null}
          {test.stack ? (
            <details style={{ marginTop: 8 }}>
              <summary
                style={{
                  cursor: "pointer",
                  color: "var(--ink-2)",
                  fontSize: 12,
                  fontWeight: 500
                }}
              >
                stack trace
              </summary>
              <pre
                style={{
                  margin: "6px 0 0",
                  padding: "10px 12px",
                  border: "1px solid var(--line)",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--bg-2)",
                  fontFamily: "var(--mono)",
                  fontSize: 11.5,
                  whiteSpace: "pre-wrap",
                  overflowX: "auto",
                  color: "var(--ink-1)"
                }}
              >
                {test.stack}
              </pre>
            </details>
          ) : null}
          {test.attachments.length > 0 ? (
            <ul
              style={{
                margin: "8px 0 0",
                padding: 0,
                listStyle: "none",
                display: "flex",
                flexDirection: "column",
                gap: 4
              }}
            >
              {test.attachments.map((attachment) => (
                <li
                  key={attachment.path}
                  style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5 }}
                >
                  <span className="badge skipped">{attachment.kind}</span>
                  <span style={{ color: "var(--ink-2)" }}>{attachment.label}</span>
                  <code
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 11,
                      color: "var(--ink-0)",
                      padding: "1px 6px",
                      background: "var(--bg-2)",
                      borderRadius: "var(--radius-sm)"
                    }}
                  >
                    {attachment.path}
                  </code>
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
