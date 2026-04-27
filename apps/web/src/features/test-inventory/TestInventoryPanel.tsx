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
      <article className="panel">
        <p className="panelLabel">Test inventory</p>
        <p className="muted">
          Test inventory is unavailable while project execution is blocked.
        </p>
      </article>
    );
  }

  return (
    <article className="panel">
      <p className="panelLabel">Test inventory</p>
      {inventoryQuery.isLoading ? (
        <p className="muted">Listing tests via Playwright CLI…</p>
      ) : inventoryQuery.error ? (
        <p className="errorBlock">{(inventoryQuery.error as Error).message}</p>
      ) : inventoryQuery.data ? (
        <InventoryView
          inventory={inventoryQuery.data}
          onRunSpec={onRunSpec}
          onRunTest={onRunTest}
        />
      ) : null}
    </article>
  );
}

interface InventoryViewProps {
  inventory: { specs: SpecFile[]; totals: { specFiles: number; tests: number }; error?: string };
  onRunSpec?: (spec: SpecFile) => void;
  onRunTest?: (spec: SpecFile, test: TestCase) => void;
}

function InventoryView({ inventory, onRunSpec, onRunTest }: InventoryViewProps) {
  if (inventory.error) {
    return <p className="errorBlock">{inventory.error}</p>;
  }
  if (inventory.specs.length === 0) {
    return <p className="muted">No specs detected by Playwright.</p>;
  }
  return (
    <div className="inventory">
      <p className="muted">
        {inventory.totals.specFiles} spec files · {inventory.totals.tests} tests
      </p>
      <ul className="specList">
        {inventory.specs.map((spec) => (
          <li key={spec.relativePath}>
            <div className="specHeader">
              <strong>{spec.relativePath}</strong>
              {onRunSpec ? (
                <button type="button" onClick={() => onRunSpec(spec)}>
                  Run spec
                </button>
              ) : null}
            </div>
            <ul className="testList">
              {spec.tests.map((test) => (
                <li key={test.id}>
                  <span className="testTitle">{test.title}</span>
                  <span className="muted"> · line {test.line}</span>
                  {test.tags.length > 0 ? (
                    <span className="tags">{test.tags.join(" ")}</span>
                  ) : null}
                  {onRunTest ? (
                    <button
                      type="button"
                      className="ghost"
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
    </div>
  );
}
