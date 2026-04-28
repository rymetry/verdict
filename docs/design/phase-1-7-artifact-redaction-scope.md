# Phase 1.7 — Artifact Redaction Scope

| | |
|---|---|
| Status | Accepted (2026-04-29) |
| Phase | 1.7 |
| Issue | [#27](https://github.com/rymetry/playwright-workbench/issues/27) (項目 5) |
| Related | [`phase-1-5-warning-observability.md`](./phase-1-5-warning-observability.md) §"Redaction scope" |

PoC が現状実装している secret redaction の **対象スコープ** を明文化し、対象外 artifact について「対応しない理由」と「将来 Phase での扱い」を ADR として固定する。Phase 1.5 で実装した redaction 経路 (Issue #23 / PR #24・#26) は限定スコープであり、運用者は本 doc を読まずにすべての artifact を信頼してチーム共有することはできない。

## Context

PLAN.v2 §28 (Security Model) は「trace/log/report への secret 混入」を主要リスクに挙げる。Phase 1.5 で次の経路に best-effort secret redaction を実装した:

- `apps/agent/src/commands/redact.ts` — 正規表現ベースの redactor
- `apps/agent/src/playwright/streamRedactor.ts` — stdout/stderr stream の per-chunk redaction (fail-closed)
- `apps/agent/src/playwright/runArtifactsStore.ts` `redactPlaywrightResults` — Playwright JSON reporter 出力の post-write redaction
- `apps/agent/src/commands/runner.ts` — audit log に書き出す `args` の redaction

これらは「テキスト形式で agent の支配下にある artifact」を対象としており、HTML report / trace / video / screenshot / Allure 系 artifact は対象外である。Issue #27 項目 5 は、この境界を運用者から見える形で固定することを求めた。

## Decision

### 対応スコープ表

| Artifact | Phase 1.5 redaction | 担当経路 | 備考 |
|---|---|---|---|
| stdout chunk (run console / `stdout.log`) | ✅ | `streamRedactor.redact("stdout", ...)` | per-chunk fail-closed; 失敗時は `[redaction failed]` placeholder + run warning |
| stderr chunk (run console / `stderr.log`) | ✅ | `streamRedactor.redact("stderr", ...)` | 同上 |
| audit log args (`.playwright-workbench/audit.log`) | ✅ | `runner.ts:143` `redact(arg)` | spawn 前に args を redact してから記録 |
| `playwright-results.json` (Playwright JSON reporter 出力) | ✅ | `runArtifactsStore.redactPlaywrightResults` (純粋な redaction) + `runManager.ts:redactPlaywrightResultsSafely` (失敗時 fallback) | post-write redaction。redaction 失敗時は wrapper が raw artifact を best-effort で削除し warning を残す。ENOENT (run が reporter 出力前に終了) は no-op。 |
| `playwright-report/` (Playwright HTML reporter 出力) | ❌ | — | **Phase 4 以降 (artifact policy)**。HTML 内の test title / error message / stack に secret が含まれ得る。現状 redact しない。 |
| `trace.zip` | ❌ | — | **Phase 4 以降**。zip 内 JSON / network log / screenshot の text 含有。zip 解凍 + 再封の I/O コスト・改竄リスクの兼ね合いで Phase 4 で再評価。 |
| `video.webm` | ❌ | — | **Phase 4 以降**。動画フレーム内 OCR は対象外。記録時の DOM masking (`page.locator(...).mask([...])`) が責務分担として正しい。 |
| `screenshot.png` | ❌ | — | **Phase 4 以降**。video.webm と同じ理由で、記録側 (Playwright config) の masking が責務。 |
| `allure-results/` (raw JSON) | ❌ | — | **Phase 1.2 統合時に再評価**。Allure adapter 経由の attachment が text/binary 混在のため、stream 化された redact パスで扱う方針を Phase 1.2 で決定する。 |
| `allure-report/` (HTML) | ❌ | — | **Phase 1.2 統合時に再評価**。allure-report は allure-results から CLI で生成されるため、results 側を redact できれば派生形は自動的に safe になる。 |
| `allure-exports/` (CSV / log) | ❌ | — | **Phase 1.2 統合時に再評価**。AI/QMO summary 入力として使うため、AI context builder 側で再度 redact をかける二重防御も検討対象。 |

### 構造化ログ (pino) は path も redact 対象

Issue #27 項目 3 (`apps/agent/src/playwright/runManager.ts` / `apps/agent/src/server.ts` の `logger.error` payload から `playwrightJsonPath` / `projectRoot` を除去) で対応済 (PR #28)。詳細は同 PR を参照。

### 運用上の責務分担

Phase 1.5 redaction が **対象外** の artifact をチーム共有 (Slack / GitHub Issue / メール) する前に、運用者は次のいずれかを行う責務を持つ:

1. 該当 artifact を手動レビューして secret 候補を確認する。
2. test 実装側で `page.locator(...).mask([...])` / `testInfo.attach(..., { contentType: 'text/plain', body: '<redacted>' })` 等で **記録時に** masking する。
3. `.playwright-workbench/runs/<runId>/` 配下を zip で配布する場合は対象外 artifact を除外する。

PoC レベルでは Workbench が完全な secret 防御を保証しない。これは PLAN.v2 §28 "best-effort" の方針と整合する。

## Consequences

### Positive

- 運用者は本 doc 表を見れば「どの artifact が信頼できて、どの artifact が手動レビュー必須か」を即時判断できる。
- 将来 Phase で artifact policy を実装する際 (Phase 4: Repair Review / Evidence-based Approval)、本 doc の「Phase 4 以降」項目が要件として参照可能。
- Phase 1.2 の Allure 統合時に、Allure 系 artifact の redaction 方針を「再評価対象」として明示的に取り込める。

### Negative

- 対象外 artifact (HTML / trace / video / screenshot) に secret が含まれ得る事実が doc 化されることで、「Workbench は安全」という誤解を防ぐ反面、組織のセキュリティレビューで「未対応」リストとして指摘される可能性がある。
- Phase 1.5 redaction の実装と doc が同期している必要があり、redaction 経路を追加する際は本 doc も更新する責務が生じる (`phase-1-5-warning-observability.md` § "Redaction scope" との二重メンテナンス)。

### Mitigations

- Allure 統合 (Phase 1.2) / Repair Review (Phase 4) の各 PR で、本 doc の該当行を更新するチェックリストを Definition of Done に含める。
- `phase-1-5-warning-observability.md` § "Redaction scope" 末尾から本 doc への link を貼り、最新スコープ表は本 doc を Single Source of Truth とする。

## Rejected Alternatives

- **Phase 1.7 で HTML / trace の redaction を実装**: 採用しない。zip 解凍・HTML パース・再封のコストが PoC スコープに対して過大。Phase 4 (Evidence-based Approval) で artifact policy として一括設計する方が一貫性が高い。
- **対応外 artifact をデフォルトで生成しない**: 採用しない。HTML report / trace / video は **失敗調査の主要証跡** であり、生成しないと QA / SDET の根本的なワークフローを阻害する (PLAN.v2 §5 Core User Flows / §17 Frontend Design — Failure Detail screen)。生成は維持し、運用者責務として手動レビューを doc 化する方が合理的。
- **`page.locator(...).mask([...])` 等を Workbench から強制注入**: 採用しない。PLAN.v2 §10 (Allure 導入は差分提案として提示し、自動変更しない) と同じ原則で、test code への自動編集はしない。
- **AI context builder のみで redaction を二重化**: 採用しない (補完的に検討)。AI に渡す前に再度 redact する案は防御として有効だが、本 doc の "対応スコープ" は「Workbench が成果物を保存する時点」を基準にする方が運用者にとって判断しやすい。AI 経路は別 doc (Phase 3 AI adapter design) で扱う。

## Open Questions

- Phase 1.2 で Allure 統合する際、`allure-results/` 内の attachment (binary 含む) を stream redact するか、results 全体を post-write でスキャンするかの選択。本 doc を更新する。
- Phase 4 の artifact policy 設計時に、HTML report の test title / error message を runtime で書き換える方針 (post-process) と、Playwright reporter 設定を `playwright.config.ts` 経由で差し替える方針 (build-time) のどちらを採用するか。

---

## 更新ガイドライン

本 doc は **対応スコープの Single Source of Truth** として扱う。Phase 1.5 redaction 経路を追加・変更する PR は次を必須とする:

1. 本 doc の対応スコープ表に行を追加または更新。
2. Phase / 担当経路 / 備考を記入。
3. `phase-1-5-warning-observability.md` § "Redaction scope" にリンクを保つ。
