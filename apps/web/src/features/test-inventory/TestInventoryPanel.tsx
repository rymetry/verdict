import { useQuery } from "@tanstack/react-query";
import { fetchInventory } from "../../api/client";
import type { ProjectSummary, SpecFile, TestCase } from "@pwqa/shared";

interface TestInventoryProps {
  project: ProjectSummary;
  onRunSpec?: (spec: SpecFile) => void;
  onRunTest?: (spec: SpecFile, test: TestCase) => void;
}

export function TestInventoryPanel({ project, onRunSpec, onRunTest }: TestInventoryProps) {
  const inventoryQuery = useQuery({
    queryKey: ["inventory", project.id],
    queryFn: async () => fetchInventory(project.id),
    enabled: !project.blockingExecution
  });

  if (project.blockingExecution) {
    return (
      <div className="locator-card">
        <h4>テストインベントリ</h4>
        <div>
          <p className="muted-note">
            プロジェクト実行がブロックされているため、インベントリを取得できません。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="locator-card">
      <h4>
        テストインベントリ
        {inventoryQuery.data ? (
          <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)", marginLeft: 8 }}>
            {inventoryQuery.data.totals.specFiles} specs · {inventoryQuery.data.totals.tests} tests
          </span>
        ) : null}
      </h4>
      <div>
        {inventoryQuery.isLoading ? (
          <p className="muted-note">Playwright CLI からテスト一覧を取得中…</p>
        ) : inventoryQuery.error ? (
          <p className="error-inline" style={{ marginTop: 0 }}>
            {errorMessage(inventoryQuery.error)}
          </p>
        ) : inventoryQuery.data ? (
          <InventoryView
            inventory={inventoryQuery.data}
            onRunSpec={onRunSpec}
            onRunTest={onRunTest}
          />
        ) : null}
      </div>
    </div>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unexpected error";
}

interface InventoryViewProps {
  inventory: { specs: SpecFile[]; totals: { specFiles: number; tests: number }; error?: string };
  onRunSpec?: (spec: SpecFile) => void;
  onRunTest?: (spec: SpecFile, test: TestCase) => void;
}

function InventoryView({ inventory, onRunSpec, onRunTest }: InventoryViewProps) {
  if (inventory.error) {
    return <p className="error-inline" style={{ marginTop: 0 }}>{inventory.error}</p>;
  }
  if (inventory.specs.length === 0) {
    return (
      <p className="muted-note">Playwright がテストを検出できませんでした。</p>
    );
  }
  return (
    <ul
      style={{
        margin: 0,
        padding: 0,
        listStyle: "none",
        display: "flex",
        flexDirection: "column",
        gap: 12
      }}
    >
      {inventory.specs.map((spec) => (
        <li key={spec.relativePath}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8
            }}
          >
            <strong
              style={{
                fontFamily: "var(--mono)",
                fontSize: 12,
                fontWeight: 500,
                color: "var(--ink-0)"
              }}
            >
              ▸ {spec.relativePath}
            </strong>
            {onRunSpec ? (
              <button type="button" className="btn" onClick={() => onRunSpec(spec)}>
                Run spec
              </button>
            ) : null}
          </div>
          <ul
            style={{
              margin: "6px 0 0",
              padding: 0,
              listStyle: "none",
              display: "flex",
              flexDirection: "column",
              gap: 2
            }}
          >
            {spec.tests.map((test) => (
              <li
                key={test.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "3px 0 3px 18px",
                  fontSize: 12,
                  position: "relative",
                  color: "var(--ink-1)"
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    color: "var(--ink-4)",
                    fontFamily: "var(--mono)",
                    fontSize: 11
                  }}
                >
                  └─
                </span>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {test.title}
                </span>
                <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--ink-3)" }}>
                  :{test.line}
                </span>
                {test.tags.length > 0 ? (
                  <span
                    style={{
                      padding: "1px 6px",
                      border: "1px solid var(--line)",
                      borderRadius: "var(--radius-sm)",
                      background: "var(--accent-soft)",
                      color: "var(--accent)",
                      fontFamily: "var(--mono)",
                      fontSize: 10
                    }}
                  >
                    {test.tags.join(" ")}
                  </span>
                ) : null}
                {onRunTest ? (
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: "3px 8px", fontSize: 10.5 }}
                    onClick={() => onRunTest(spec, test)}
                  >
                    Run
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
