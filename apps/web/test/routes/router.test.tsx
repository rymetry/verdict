// Router レベルの統合テスト。
// - `/` (index) は `/qa` にリダイレクトされる
// - `/qa` `/dev` `/qmo` をそれぞれ直接開くと該当 view が描画される
// - PersonaToggle のクリックで navigate して URL が更新される
// - ブラウザ back で前 URL に戻る
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";

import { pathnameToPersona } from "@/routes/__root";
import { createInitialRunState, useRunStore } from "@/store/run-store";
import { renderWithRouter } from "../_helpers/render-with-router";

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    fetchHealth: vi.fn(),
    fetchConfigSummary: vi.fn(),
    fetchCurrentProject: vi.fn(),
    fetchInventory: vi.fn(),
    fetchRun: vi.fn(),
    startRun: vi.fn()
  };
});
import {
  fetchCurrentProject,
  fetchConfigSummary,
  fetchHealth,
  fetchInventory,
  fetchRun
} from "@/api/client";

vi.mock("@/hooks/use-workbench-events", () => ({
  // δ: useWorkbenchEvents は EventStream を返す契約に変わったため、テスト用に最小実装を返す。
  // useWsConnectionState は React の useSyncExternalStore 経路。テストでは固定値を返す。
  useWorkbenchEvents: () => ({
    subscribe: () => () => {},
    subscribeState: () => () => {},
    getState: () => "open",
    close: () => {}
  }),
  useWsConnectionState: () => "open"
}));

beforeEach(() => {
  useRunStore.setState(createInitialRunState(), false);
  vi.mocked(fetchHealth).mockResolvedValue({
    ok: true,
    service: "playwright-workbench-agent",
    version: "0.0.0-test",
    timestamp: "2026-04-28T00:00:00Z"
  });
  vi.mocked(fetchCurrentProject).mockResolvedValue(null);
  vi.mocked(fetchConfigSummary).mockResolvedValue({
    projectId: "p1",
    generatedAt: "2026-05-01T00:00:00Z",
    config: { relativePath: "playwright.config.ts", format: "ts", sizeBytes: 128 },
    reporters: [],
    useOptions: [],
    fixtureFiles: [],
    pomFiles: [],
    authRisks: [],
    warnings: []
  });
  vi.mocked(fetchInventory).mockResolvedValue({
    projectId: "p1",
    source: "playwright-list-json",
    generatedAt: "2026-04-28T00:00:00Z",
    specs: [],
    totals: { specFiles: 0, tests: 0 },
    warnings: []
  });
  vi.mocked(fetchRun).mockResolvedValue({
    runId: "noop",
    projectId: "p1",
    projectRoot: "/p",
    status: "passed",
    startedAt: "2026-04-28T00:00:00Z",
    completedAt: "2026-04-28T00:01:00Z",
    command: { executable: "npx", args: ["playwright", "test"] },
    cwd: "/p",
    requested: { projectId: "p1", headed: false },
    paths: {
      runDir: "/runs/test",
      metadataJson: "/runs/test/metadata.json",
      stdoutLog: "/runs/test/stdout.log",
      stderrLog: "/runs/test/stderr.log",
      playwrightJson: "/runs/test/playwright.json",
      playwrightHtml: "/runs/test/playwright-report",
      allureResultsDest: "/runs/test/allure-results",
      allureReportDir: "/runs/test/allure-report",
      qualityGateResultPath: "/runs/test/quality-gate-result.json",
      allureExportsDir: "/runs/test/allure-exports",
      allureCsvPath: "/runs/test/allure-exports/results.csv",
      allureLogPath: "/runs/test/allure-exports/results.log",
      qmoSummaryJsonPath: "/runs/test/qmo-summary.json",
      qmoSummaryMarkdownPath: "/runs/test/qmo-summary.md",
      artifactsJson: "/runs/test/artifacts.json"
    },
    warnings: []
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("router redirect", () => {
  it("`/` へのアクセスは `/qa` に redirect される (履歴も置換)", async () => {
    const { router } = renderWithRouter({ initialPath: "/" });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/qa");
    });
    // index 自体は描画されない (placeholder text 等を持たない)
    expect(screen.getByRole("tab", { name: "QA", selected: true })).toBeInTheDocument();
  });

  it("redirect は `replace: true` で履歴に / を残さない (push なら back で /qa→/→/qa loop が発生)", async () => {
    // 単一 entry の memory history では back が no-op になり、replace と push の挙動が
    // 区別できない。`/qa` → `/dev` → `/` の 3 entry 構成で back の遷移先を観察し、
    // 「push だったら back で / (再 redirect で /qa) に戻る」と
    // 「replace だったら back で /dev に戻る」を区別する。
    const { user, router } = renderWithRouter({ initialPath: "/qa" });
    await screen.findByRole("tab", { name: "QA", selected: true });

    // /dev へ push
    await user.click(screen.getByRole("tab", { name: "Developer" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/dev"));

    // / へ navigate → indexRoute beforeLoad で /qa に redirect される。
    // replace: true なら history は [/qa, /dev, /qa] (3 つ目で / は残らず /qa に置換)
    // replace 無しなら history は [/qa, /dev, /, /qa] (4 つ目)
    void router.navigate({ to: "/" });
    await waitFor(() => expect(router.state.location.pathname).toBe("/qa"));

    // back を押す
    router.history.back();
    await waitFor(() => {
      // replace: true: back は /dev に戻る (途中の / が消えている)
      // replace 無し: back は / に戻り、再度 redirect で /qa に戻る (= /qa のままになる)
      expect(router.state.location.pathname).toBe("/dev");
    });
  });
});

describe("pathnameToPersona (URL → persona 派生)", () => {
  it("/qa /dev /qmo および subpath を正しく persona に解決する", () => {
    expect(pathnameToPersona("/qa")).toBe("qa");
    expect(pathnameToPersona("/qa/foo")).toBe("qa");
    expect(pathnameToPersona("/dev")).toBe("dev");
    expect(pathnameToPersona("/dev/bar")).toBe("dev");
    expect(pathnameToPersona("/qmo")).toBe("qmo");
    expect(pathnameToPersona("/qmo/baz")).toBe("qmo");
  });

  it("`/` および値域外の segment は null を返す", () => {
    expect(pathnameToPersona("/")).toBeNull();
    expect(pathnameToPersona("")).toBeNull();
    expect(pathnameToPersona("/foo")).toBeNull();
    expect(pathnameToPersona("/QA")).toBeNull(); // 大文字混在は contract 外
    expect(pathnameToPersona("/admin/qa")).toBeNull(); // 第 2 segment は見ない
  });
});

describe("各 persona route の直接アクセス", () => {
  it("`/qa` を直接開くとプロジェクト未オープン状態で ProjectPicker が描画される", async () => {
    // δ で QA View は project null のとき ProjectPicker のみを中央に表示する設計に変更
    // (Run controls / inventory / failure review は project が前提のため空で出さない)。
    renderWithRouter({ initialPath: "/qa" });
    expect(
      await screen.findByLabelText("Absolute path to a Playwright project")
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "QA", selected: true })).toBeInTheDocument();
    // project=null では 3-col grid は組まれない (data-testid="qa-view-grid" は非存在)
    expect(screen.queryByTestId("qa-view-grid")).not.toBeInTheDocument();
  });

  it("project が open のとき 3-col grid (qa-view-grid) で 3 features が同時 mount される", async () => {
    // δ: project null のときは ProjectPicker のみ、open のときは 3-col grid。
    // mockResolvedValue で fetchCurrentProject に project を返させ、初回 render から open 状態にする。
    vi.mocked(fetchCurrentProject).mockResolvedValue({
      id: "p1",
      rootPath: "/p",
      packageJsonPath: "/p/package.json",
      packageManager: {
        name: "pnpm",
        status: "ok",
        confidence: "high",
        reason: "fixture",
        warnings: [],
        errors: [],
        lockfiles: ["pnpm-lock.yaml"],
        commandTemplates: {
          playwrightTest: { executable: "pnpm", args: ["exec", "playwright", "test"] }
        },
        hasPlaywrightDevDependency: true,
        localBinaryUsable: true,
        blockingExecution: false
      },
      hasAllurePlaywright: false,
      hasAllureCli: false,
      warnings: [],
      blockingExecution: false
    });

    renderWithRouter({ initialPath: "/qa" });

    // 3-col grid (左: ProjectPicker + Test inventory / 中: Run controls + Run console / 右: Failure review)
    expect(await screen.findByTestId("qa-view-grid")).toBeInTheDocument();
    expect(await screen.findByText("Run controls")).toBeInTheDocument();
    expect(screen.getByText("Test inventory")).toBeInTheDocument();
    expect(screen.getByText("Run console")).toBeInTheDocument();
    expect(screen.getByText("Failure review")).toBeInTheDocument();
  });

  it("`/dev` を直接開くとプロジェクト未オープン状態で ProjectPicker が描画される", async () => {
    renderWithRouter({ initialPath: "/dev" });
    expect(await screen.findByTestId("dev-view")).toHaveAttribute("aria-label", "Developer View");
    expect(
      await screen.findByLabelText("Absolute path to a Playwright project")
    ).toBeInTheDocument();
    expect(screen.queryByTestId("dev-view-grid")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Developer", selected: true })).toBeInTheDocument();
  });

  it("project が open のとき `/dev` は POM と locator の read-only explorer を描画する", async () => {
    vi.mocked(fetchCurrentProject).mockResolvedValue({
      id: "p1",
      rootPath: "/repo",
      packageJsonPath: "/repo/package.json",
      packageManager: {
        name: "pnpm",
        status: "ok",
        confidence: "high",
        reason: "fixture",
        warnings: [],
        errors: [],
        lockfiles: ["pnpm-lock.yaml"],
        commandTemplates: {
          playwrightTest: { executable: "pnpm", args: ["exec", "playwright", "test"] }
        },
        hasPlaywrightDevDependency: true,
        localBinaryUsable: true,
        blockingExecution: false
      },
      hasAllurePlaywright: false,
      hasAllureCli: false,
      warnings: [],
      blockingExecution: false
    });
    vi.mocked(fetchConfigSummary).mockResolvedValue({
      projectId: "p1",
      generatedAt: "2026-05-01T00:00:00Z",
      config: { relativePath: "playwright.config.ts", format: "ts", sizeBytes: 128 },
      reporters: [],
      useOptions: [],
      fixtureFiles: [
        {
          relativePath: "tests/fixtures/auth.fixture.ts",
          kind: "fixture-file",
          signals: ["fixture-path"],
          sizeBytes: 64
        }
      ],
      pomFiles: [
        {
          relativePath: "pages/checkout.page.ts",
          kind: "page-object",
          classNames: ["CheckoutPage"],
          locatorCount: 1,
          locatorSamples: [
            {
              value: "this.page.getByRole('button', { name: 'Pay' })",
              line: 12,
              source: "heuristic"
            }
          ],
          sizeBytes: 128
        }
      ],
      authRisks: [],
      warnings: []
    });
    vi.mocked(fetchInventory).mockResolvedValue({
      projectId: "p1",
      source: "playwright-list-json",
      generatedAt: "2026-05-01T00:00:00Z",
      specs: [
        {
          filePath: "/repo/tests/checkout.spec.ts",
          relativePath: "tests/checkout.spec.ts",
          tests: [
            {
              id: "t1",
              title: "checkout completes",
              fullTitle: "checkout completes",
              filePath: "/repo/tests/checkout.spec.ts",
              relativePath: "tests/checkout.spec.ts",
              line: 4,
              column: 0,
              describePath: [],
              tags: [],
              qaMetadata: {
                purpose: "checkout completes",
                steps: [],
                expectations: [],
                source: "static-analysis",
                confidence: "medium"
              },
              codeSignals: [
                {
                  kind: "locator",
                  value: "page.getByText('Done')",
                  line: 5,
                  source: "static-analysis"
                }
              ]
            }
          ]
        }
      ],
      totals: { specFiles: 1, tests: 1 },
      warnings: []
    });

    renderWithRouter({ initialPath: "/dev" });
    expect(await screen.findByTestId("dev-view-grid")).toBeInTheDocument();
    expect(screen.getByTestId("dev-view-grid")).toBeInTheDocument();
    expect(screen.getByText("pages/checkout.page.ts")).toBeInTheDocument();
    expect(screen.getByText("tests/fixtures/auth.fixture.ts")).toBeInTheDocument();
    expect(screen.getByText("tests/checkout.spec.ts")).toBeInTheDocument();
    expect(screen.getByText("this.page.getByRole('button', { name: 'Pay' })")).toBeInTheDocument();
    expect(screen.getByText("page.getByText('Done')")).toBeInTheDocument();
    expect(screen.getByTestId("dev-source-tabs-card")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Developer", selected: true })).toBeInTheDocument();
  });

  it("`/qmo` を直接開くと Insights View が描画される (no run data 時は empty placeholder)", async () => {
    // §1.2 で SAMPLE_INSIGHTS の static fallback を撤去したため、router-only テスト
    // (= no run data の状態) では `insights-view-empty` のテキスト placeholder が
    // 表示される。Insights view 本体の Hero / cards / sidebar の細部は
    // `apps/web/test/features/insights-view.test.tsx` の component test で pin。
    // ここでは route が正しく hit して section が出ること + empty 状態で
    // crash しないことだけ assert する。
    renderWithRouter({ initialPath: "/qmo" });
    expect(await screen.findByTestId("qmo-view")).toHaveAttribute("aria-label", "Insights View");
    expect(screen.getByTestId("insights-view-empty")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Insights", selected: true })).toBeInTheDocument();
  });
});

describe("PersonaToggle クリックで route 遷移する", () => {
  it("QA → Developer → Insights → QA を順に遷移し URL と active tab が同期する", async () => {
    const { user, router } = renderWithRouter({ initialPath: "/qa" });

    await user.click(await screen.findByRole("tab", { name: "Developer" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/dev"));
    expect(screen.getByRole("tab", { name: "Developer", selected: true })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Insights" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/qmo"));
    expect(screen.getByRole("tab", { name: "Insights", selected: true })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "QA" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/qa"));
    expect(screen.getByRole("tab", { name: "QA", selected: true })).toBeInTheDocument();
  });

  it("ブラウザ back で前の URL に戻り tab の active 状態も同期する", async () => {
    const { user, router } = renderWithRouter({ initialPath: "/qa" });
    await user.click(await screen.findByRole("tab", { name: "Developer" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/dev"));

    router.history.back();
    await waitFor(() => expect(router.state.location.pathname).toBe("/qa"));
    expect(screen.getByRole("tab", { name: "QA", selected: true })).toBeInTheDocument();
  });

  it("ブラウザ back → forward の往復で URL と active tab が同期する", async () => {
    // back のみではなく forward 経路も pin する: pathnameToPersona の派生が
    // 双方向で正しく走ることを確認 (メモ化導入時の regression を防ぐ)。
    const { user, router } = renderWithRouter({ initialPath: "/qa" });
    await user.click(await screen.findByRole("tab", { name: "Developer" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/dev"));

    router.history.back();
    await waitFor(() => expect(router.state.location.pathname).toBe("/qa"));
    expect(screen.getByRole("tab", { name: "QA", selected: true })).toBeInTheDocument();

    router.history.forward();
    await waitFor(() => expect(router.state.location.pathname).toBe("/dev"));
    expect(screen.getByRole("tab", { name: "Developer", selected: true })).toBeInTheDocument();
  });
});
