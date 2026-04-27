import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { HealthResponseSchema, type HealthResponse } from "@pwqa/shared";
import "./styles.css";

function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadHealth() {
      try {
        const response = await fetch("/api/health");
        const data = HealthResponseSchema.parse(await response.json());

        if (!cancelled) {
          setHealth(data);
          setError(null);
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : "Unable to reach the local agent");
        }
      }
    }

    void loadHealth();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="shell">
      <section className="topbar" aria-label="Workbench status">
        <div>
          <p className="eyebrow">Local control plane</p>
          <h1>Playwright QA Workbench</h1>
        </div>
        <div className={health?.ok ? "status statusReady" : "status statusPending"}>
          <span aria-hidden="true" />
          {health?.ok ? "Agent connected" : "Agent pending"}
        </div>
      </section>

      <section className="grid">
        <article className="panel panelPrimary">
          <p className="panelLabel">Phase 1 foundation</p>
          <h2>Project runner shell</h2>
          <p>
            This first cut establishes the pnpm workspace, shared schemas, Fastify Local Agent, and Vite React UI.
            Project scanning and Playwright execution can build on this boundary without changing the frontend-agent
            contract.
          </p>
        </article>

        <article className="panel">
          <p className="panelLabel">Agent health</p>
          {health ? (
            <dl className="facts">
              <div>
                <dt>Service</dt>
                <dd>{health.service}</dd>
              </div>
              <div>
                <dt>Version</dt>
                <dd>{health.version}</dd>
              </div>
              <div>
                <dt>Checked</dt>
                <dd>{new Date(health.timestamp).toLocaleString()}</dd>
              </div>
            </dl>
          ) : (
            <p className="muted">{error ?? "Waiting for the Local Agent on port 4317."}</p>
          )}
        </article>

        <article className="panel">
          <p className="panelLabel">Next vertical slice</p>
          <ul className="steps">
            <li>Project root open</li>
            <li>Package manager detection</li>
            <li>Spec inventory</li>
            <li>Run streaming</li>
          </ul>
        </article>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
