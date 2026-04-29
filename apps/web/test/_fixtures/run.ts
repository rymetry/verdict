// テスト用 run 関連 fixture。
// `as RunRequest` cast を排除し、戻り型を明示することで shared schema 拡張時に compile error で
// 気付ける契約を維持する (App.test.tsx の `makeProject` と同じ方針)。
//
// TODO(ε): RunControls feature 抽出のタイミングで、`makeRunMetadata` を含む他 fixture も
// 本ファイルに集約し、各 test ファイルから import に切替える。
import type { RunMetadata, RunRequest } from "@pwqa/shared";

export function makeRunRequest(overrides: Partial<RunRequest> = {}): RunRequest {
  return { projectId: "p1", headed: false, ...overrides };
}

export function makeRunMetadata(
  runId: string,
  overrides: Partial<RunMetadata> = {}
): RunMetadata {
  const base: RunMetadata = {
    runId,
    projectId: "p1",
    projectRoot: "/p",
    status: "passed",
    startedAt: "2026-04-28T00:00:00Z",
    completedAt: "2026-04-28T00:01:00Z",
    command: { executable: "npx", args: ["playwright", "test"] },
    cwd: "/p",
    requested: makeRunRequest(),
    paths: {
      runDir: "/runs/test",
      metadataJson: "/runs/test/metadata.json",
      stdoutLog: "/runs/test/stdout.log",
      stderrLog: "/runs/test/stderr.log",
      playwrightJson: "/runs/test/playwright.json",
      playwrightHtml: "/runs/test/playwright-report",
      artifactsJson: "/runs/test/artifacts.json",
      allureResultsDest: "/runs/test/allure-results",
      allureReportDir: "/runs/test/allure-report",
      qualityGateResultPath: "/runs/test/quality-gate-result.json"
    },
    warnings: []
  };
  return { ...base, ...overrides };
}
