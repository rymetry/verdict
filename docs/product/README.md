# `docs/product/` — Product Strategy Documents

**Brand**: Verdict (formerly Playwright Workbench) · **License**: [Apache 2.0](../../LICENSE)

製品戦略・ロードマップ・技術仕様の Source-of-Truth。
Product strategy, roadmap, and technical-specification documents (source of truth).

---

## 文書一覧 / Document Index

### 1. 製品ビジョン / Product Vision

| 日本語 | English | 内容 |
|---|---|---|
| [PRODUCT.md](PRODUCT.md) | [PRODUCT.en.md](PRODUCT.en.md) | 1 枚で読めるビジョン: 何を壊し、誰のために、なぜ今、なぜ我々か / One-pager vision |

### 2. ロードマップ / Roadmap

| 日本語 | English | 内容 |
|---|---|---|
| [PLAN.v3.md](PLAN.v3.md) | [PLAN.v3.en.md](PLAN.v3.en.md) | Phase 1.5 / 2 / 3 の詳細 roadmap、依存、成功基準 / Phase roadmap with dependencies & success criteria |

### 3. 技術仕様 (RFC) / Technical Specifications (RFCs)

| 日本語 | English | 内容 |
|---|---|---|
| [rfcs/0001-workbench-directory.md](rfcs/0001-workbench-directory.md) | [rfcs/0001-workbench-directory.en.md](rfcs/0001-workbench-directory.en.md) | `.workbench/` ディレクトリ仕様 + 多段 AI pipeline / `.workbench/` spec + multi-stage AI pipeline |

### 4. Test Plan サンプル / Test Plan Samples

| 日本語 | English | シナリオ |
|---|---|---|
| [test-plan-samples/checkout-with-saved-card.md](test-plan-samples/checkout-with-saved-card.md) | [test-plan-samples/checkout-with-saved-card.en.md](test-plan-samples/checkout-with-saved-card.en.md) | 保存カード決済 / Saved-card checkout |
| [test-plan-samples/password-reset.md](test-plan-samples/password-reset.md) | [test-plan-samples/password-reset.en.md](test-plan-samples/password-reset.en.md) | パスワードリセット / Password reset |
| [test-plan-samples/admin-user-suspend.md](test-plan-samples/admin-user-suspend.md) | [test-plan-samples/admin-user-suspend.en.md](test-plan-samples/admin-user-suspend.en.md) | 管理者によるユーザ停止 / Admin user suspension |

---

## 読む順序 (推奨) / Recommended Reading Order

### design partner / 検討中の利用者 向け
1. **PRODUCT.md** — 5 分で全体像
2. **test-plan-samples/checkout-with-saved-card.md** — 具体的な出力イメージ
3. **PLAN.v3.md §2** (Phase 1.5) — 直近 12 ヶ月の roadmap

### 実装担当 (Codex 等) 向け
1. **PRODUCT.md** — 製品の why
2. **PLAN.v3.md** — 全体 roadmap、Phase ごとの依存
3. **rfcs/0001-workbench-directory.md** — 技術仕様の主軸
4. **test-plan-samples/** — 出力フォーマット標本

### 社内意思決定者 向け
1. **PRODUCT.md** — vision + 競合差別化
2. **PLAN.v3.md §0-§1** — v2 との関係 + Phase 1 サマリ
3. **PLAN.v3.md §6-§7** — 完了定義 + open questions

---

## 関連文書 (この docs 配下外) / Related Documents (outside this directory)

- [`PLAN.v2.md`](../../PLAN.v2.md) — Phase 1 実装根拠。本書 v3 と並存し、現役で参照される / Phase 1 implementation reference; coexists with v3 and is actively used.
- [`IMPLEMENTATION_REPORT.md`](../../IMPLEMENTATION_REPORT.md) — Phase 1 完了報告 / Phase 1 completion report.
- [`docs/design/concept-b-refined.html`](../design/concept-b-refined.html) — UI design source-of-truth
- [`docs/operations/poc-guide.md`](../operations/poc-guide.md) — Phase 1 PoC 操作マニュアル / PoC operations guide
- [`docs/operations/reportportal-re-evaluation.md`](../operations/reportportal-re-evaluation.md) — ReportPortal 再評価方針 / ReportPortal re-evaluation
- [`docs/operations/bun-feasibility-report.md`](../operations/bun-feasibility-report.md) — Bun 採用判定 / Bun feasibility

---

## 改訂履歴 / Revision History

- **2026-05** v3 初版: PRODUCT / PLAN.v3 / RFC 0001 / test-plan-samples × 3 を日英で揃えた。Phase 1.5 (AI ネイティブ多段 pipeline) を導入。
  / v3 initial release: PRODUCT / PLAN.v3 / RFC 0001 / 3 test-plan samples, all in JA & EN. Introduces Phase 1.5 (AI-native multi-stage pipeline).

---

## フィードバック / Feedback

design partner 候補・実装担当 (Codex 等)・社内検討者からの指摘を歓迎します。
GitHub Issue または PR comment でお願いします。

We welcome feedback from design-partner candidates, implementation agents (Codex etc.), and internal reviewers. Please open a GitHub Issue or comment on a PR.
