# PLAN.v3 — Phase 1.5 / 2 / 3 ロードマップ

> **基準点**: PLAN.v2 (Phase 1 完了) を Phase 1 として包含し、Phase 1.5 / 2 / 3 を新規定義する。
> v2 は実装根拠として現役。v3 は今後 24-36 ヶ月の方向性を示す **roadmap 文書** であり、実装詳細ではない。
>
> **Status**: Draft v3 (2026-05) / **Audience**: Codex 等 実装担当 / 社内意思決定 / 上級 design partner

---

## 0. ビジョンと位置付け

製品ビジョンは [`PRODUCT.md`](PRODUCT.md) を Source of Truth とする。本書はその **Phase 1.5 以降の実装ロードマップ**。

### v2 との関係

| 文書 | 役割 | 状態 |
|---|---|---|
| `PLAN.v2.md` (root) | Phase 0 / 1 / 1.2 の実装根拠。CommandRunner / Allure / Quality Gate / AI / Repair の詳細仕様 | ✅ 完成、現役参照 |
| `PRODUCT.md` (この docs) | 製品ビジョン、ポジショニング、差別化 | ✅ Draft |
| `PLAN.v3.md` (本書) | Phase 1.5 / 2 / 3 の roadmap、依存関係、成功基準 | ✅ Draft |
| `rfcs/0001-workbench-directory.md` | `.workbench/` 構造と多段 AI pipeline の技術仕様 | ✅ Draft |

PLAN.v2 と本書が矛盾する場合、**実装済み事項は v2 を、今後の方向性は v3 を優先**。

---

## 1. Phase 1 (完了済み — v2 のサマリ)

PLAN.v2 §29 で定義された PoC scope。本ロードマップでは **Phase 1 = baseline** として扱う。

### 完了した中核機能
- Project open + Playwright project 検出 + PackageManagerDetector
- spec/test inventory (`playwright test --list --reporter=json`)
- NodeCommandRunner (shell 不使用、argv 配列、policy、cwd boundary、audit log)
- GUI からの run 実行 + stdout/stderr streaming + JSON 結果保存
- Allure detect/archive/copy lifecycle + HTML report 生成 + history JSONL + CSV/log export
- Quality Gate profile 評価 (local-review / release-smoke / full-regression) + advisory enforcement
- Failure Review (stack / artifact / Allure 履歴 / known issue / flaky signal 集約)
- AI Analysis (Claude CLI adapter + redacted context + AI 出力 zod validation)
- Repair Review (`git apply --check` + temporary apply + rerun + before/after 比較)
- AI Test Generation (planner / generator / healer schema + Quality Gate enforcement)
- Release Review Draft + CI artifact 取り込み (metadata のみ、外部 fetch なし)
- 役割横断 UI (QA / Developer / Insights view、shadcn/ui + TanStack Router)

### Phase 1 残課題 (本書で扱う follow-up)

`IMPLEMENTATION_REPORT.md` 既知制約のうち、Phase 1.5 以降で解決:
- Settings 画面 (Phase 1.5 で `.workbench/` 設定 UI として吸収)
- Developer View の Source / Diff / Terminal / Console pane (Phase 1.5 で再評価)
- Bun support (Phase 1.5 で実機検証)
- ReportPortal 並列 provider (Phase 3 で再評価)

---

## 2. Phase 1.5 — AI ネイティブ多段 pipeline 基盤 (4-12 ヶ月)

### 2.1 目的

PLAN.v2 で構築した実装基盤に、**`.workbench/` directory + 多段 AI pipeline** を載せ、**「AI が test を Plan 経由で生成する」** ワークフローを完成させる。これは PRODUCT.md §7 が定義する core pipeline の実装。

### 2.2 中核成果物

| # | 成果物 | 所在 |
|---|---|---|
| T1500-1 | `.workbench/` directory 仕様の確定 | `rfcs/0001-workbench-directory.md` |
| T1500-2 | AGENTS.md / skills/ / rules/ / hooks/ / intents/ / prompts/ の loader 実装 | `apps/agent/src/workbench/` (新規) |
| T1500-3 | Exploration Engine (Stagehand / Browser Use adapter) | `apps/agent/src/exploration/` (新規) |
| T1500-4 | Screen Model schema + comprehension layer | `packages/shared/src/exploration.ts` (新規) |
| T1500-5 | Test Layer Judgment (AI Test Strategy Advisor) | `apps/agent/src/ai/layerJudgment.ts` (新規) |
| T1500-6 | Test Plan Generator (Markdown 出力) | `apps/agent/src/ai/testPlan.ts` (新規) |
| T1500-7 | Conversational Clarification UI | `apps/web/src/features/test-plan-review/` (新規) |
| T1500-8 | Code Generation 強化 (rule/skill/hook context 注入) | 既存 `apps/agent/src/ai/cliAdapter.ts` の拡張 |
| T1500-9 | Plan 駆動 Repair Review 統合 | 既存 `apps/agent/src/repair/` の拡張 |
| T1500-10 | Community rule pack registry (OSS) | 別リポ `playwright-workbench-rules/` |

### 2.3 多段 pipeline の実装順序

```
Phase 1.5-α (1-3 ヶ月) : Foundation
  T1500-1, T1500-2 — `.workbench/` 仕様確定 + loader
  T1500-8 強化      — rule/skill/hook context 注入 (既存 T1100 への拡張)
  → 既存 AI Test Generation が rule-aware で生成精度向上

Phase 1.5-β (3-6 ヶ月) : Exploration & Plan
  T1500-3, T1500-4 — Exploration Engine + Screen Model
  T1500-5, T1500-6 — Layer Judgment + Test Plan Generator
  → 探索 → plan までが動作。code 生成は既存 T1100 流用

Phase 1.5-γ (6-9 ヶ月) : UX 完成
  T1500-7, T1500-9 — Conversational UI + Plan 駆動 Repair Review
  → 完全な多段 pipeline が design partner に提示可能

Phase 1.5-δ (9-12 ヶ月) : エコシステム
  T1500-10        — rule pack OSS 公開
  → community 巻き込みで Phase 2 への足場確立
```

### 2.4 Phase 1.5 成功基準

- ✅ `.workbench/` がリポジトリに自然に commit される (Cursor `.cursorrules` と同等の浸透)
- ✅ Test Plan が design partner の QA / PM に「読める / 議論できる」と評価される
- ✅ 1 件以上の design partner が「実 release で Workbench 経由の Test Plan を意思決定に使った」事例を持つ
- ✅ 生成 test の rule 違反率が < 5% (post-generate hook で計測)
- ✅ 探索 cost が 1 plan あたり $5 以下 (cache + cheap model routing 込み)
- ✅ AI Test Strategy Advisor が「unit / E2E / 不要」を 3 ラベル正確に判定する評価データセットで > 80% 精度

### 2.5 Phase 1.5 で意図的に作らないもの

- 探索的 testing agent (Phase 2 領域)
- Cypress / TestCafe support (Playwright に集中)
- multi-user state / RBAC / Server (Phase 3 領域)
- SaaS deploy (戦略的に永遠に作らない可能性)
- Visual regression / accessibility scanner (Phase 2 で Quality Signal Bus 統合時)

### 2.6 Phase 1.5 のリスク

| リスク | 打ち手 |
|---|---|
| 探索 engine の不安定性 (DOM 動的変化) | Stagehand を default、Browser Use を fallback、retry policy |
| LLM 生成 plan の品質揺らぎ | `.workbench/skills/` の community pack で底上げ + 評価データセット運用 |
| rule pack の初期コスト (顧客が書く) | 主要 framework (Next.js / Vue / Rails) 向けに OSS rule pack を先行公開 |
| design partner 獲得の遅れ | Phase 1.5-α 完了時点でローンチ、`.workbench/` だけ動く状態を見せる |
| 競合の追随 (Octomind 等が探索 → plan path を採用) | rule/skill/hook + self-hosted で moat を維持 |

---

## 3. Phase 2 — Quality Signal Bus と探索的 agent 統合 (12-24 ヶ月)

### 3.1 目的

Workbench を **「Playwright だけのツール」から「Quality 全体の統合 hub」** へ拡張する第一歩。Quality Signal という統一抽象を導入し、複数 source の品質情報を 1 画面で意思決定できるようにする。

### 3.2 中核成果物

| # | 成果物 | 概要 |
|---|---|---|
| T2000-1 | Quality Signal 抽象の確立 | shared schema、source / category / severity / evidence の統一型 |
| T2000-2 | 探索的 testing agent 結果 import | Octomind exploratory / TestZeus / 自社 agent の結果を Quality Signal 化 |
| T2000-3 | Visual regression 結果 import (BackstopJS / Percy) | 現状の Allure attachment と同列に並べる |
| T2000-4 | Accessibility 結果 import (axe-core) | A11y を Quality Signal source として追加 |
| T2000-5 | CI replay (`--replay github://owner/repo/runs/N`) | 失敗 CI run を local で再現する hero feature |
| T2000-6 | GitHub PR comment 自動投稿 | `release-review-draft` の出口、GitHub App 経由 |
| T2000-7 | Slack / Teams alert (flaky / critical fail) | webhook 連携 |
| T2000-8 | Sharable Bundle (zip + 静的 HTML) | Cloud server 不要で multi-role 共有を実現 |
| T2000-9 | Cypress / TestCafe runner adapter | Playwright 以外の E2E runner 対応 |

### 3.3 Quality Signal Bus の構造

```
┌─────────────────────────────────────────────┐
│ Quality Signal {                              │
│   source: "playwright" | "exploratory"        │
│         | "visual" | "axe" | "manual" | ...   │
│   category: "regression" | "exploration"      │
│           | "performance" | "accessibility"   │
│           | "security"                         │
│   severity: "critical" | "high" | "medium"   │
│           | "low" | "info"                    │
│   evidence: ArtifactRef[]                     │
│   context: { commit, run, pr, ... }           │
│   triage: { status, assignee, comment_id }    │
│ }                                              │
└─────────────────────────────────────────────┘
                    ▲
        各 source adapter から push
                    ▼
┌─────────────────────────────────────────────┐
│ Workbench Quality View                        │
│ - 全 signal を統合した Quality Gate            │
│ - 役割別 narrative 生成                       │
│ - 履歴 / trend / 横断検索                     │
└─────────────────────────────────────────────┘
```

### 3.4 Phase 2 成功基準

- ✅ 3 種類以上の Quality source (Playwright + 探索 agent + 1 つ追加) が同 Quality Gate に乗る
- ✅ CI replay が 1 コマンドで動作し、design partner 環境で月 5 回以上利用される
- ✅ Workbench bot による PR comment 自動投稿が標準運用に
- ✅ Sharable Bundle により非エンジニア (PM / sales) が Workbench 結果を閲覧できた事例
- ✅ Cypress / TestCafe ユーザーが 1 件以上 design partner に

### 3.5 Phase 2 のリスク

| リスク | 打ち手 |
|---|---|
| 探索的 agent の出力 schema が統一されない | Workbench 側で adapter 抽象、各 agent ごとに converter を書く |
| GitHub App 配布の運用負荷 | OSS App として配布、enterprise は self-hosted GitHub App でも動くよう設計 |
| Quality Signal 抽象が早すぎる generalization で歪む | Playwright + 探索 + visual の 3 種を実装してから schema 確定 |
| Bundle 送受信での secret 漏れ | redaction policy を明文化、auto-redaction tool を Bundle 生成時に必須化 |

---

## 4. Phase 3 — 統合品質プラットフォーム化 + Server 製品 (24-36 ヶ月)

### 4.1 目的

Workbench を **「個人 / チームの工具」から「組織の品質意思決定基盤」** へ昇格させる。multi-user / RBAC / 永続コメント / 横断検索 / ML-driven prediction を提供する Server 製品を導入する。

### 4.2 中核成果物

| # | 成果物 | 概要 |
|---|---|---|
| T3000-1 | Workbench Server 基盤 | Hono ベース API + PostgreSQL + S3 互換 blob |
| T3000-2 | OIDC / SAML / LDAP 認証 | エンタープライズ要件 |
| T3000-3 | RBAC (role / project / artifact 単位) | 商用 ツール水準の権限制御 |
| T3000-4 | 改竄不可 audit log | regulated industry compliance |
| T3000-5 | Failure コメント / triage 状態 / assignee | multi-user collaboration |
| T3000-6 | 横断検索 ("find all failures with this error in last 30 days") | log aggregation 的機能 |
| T3000-7 | Continuous exploration engine | 24h 自律探索、新 flow 検知 |
| T3000-8 | 組織横断 quality intelligence | per-feature risk score、test gap detection |
| T3000-9 | ML-driven release prediction | 過去 run データから "ship 確度" 予測 |
| T3000-10 | helm chart / docker compose 配布 + upgrade 戦略 | 自社設置運用 |

### 4.3 Server / Agent の関係

```
┌──────────────────────────────────────────┐
│ Workbench Server (Phase 3 で導入)          │
│ - 履歴 / triage / comment / RBAC / audit  │
│ - PostgreSQL + S3 互換 blob                │
│ - 自社設置 (k8s / docker compose)          │
└──────────────────────────────────────────┘
           ▲ push (run artifact bundle)
           │ pull (history / config / rule)
           │
┌──────────────────────────────────────────┐
│ Workbench Agent (Phase 1, 既存)            │
│ - local 実行、artifact 生成                │
│ - Server 不在でも単体動作                  │
│ - npm package で配布                      │
└──────────────────────────────────────────┘
```

**重要**: Agent (Phase 1 既存) は Server 不在でも完全動作する。**Server は opt-in 拡張**。

### 4.4 Phase 3 成功基準

- ✅ self-hosted Server を 3 社以上が production で運用
- ✅ regulated industry (金融 / 医薬 / 公共のいずれか) で 1 社以上の本番採用
- ✅ Continuous exploration が新 bug を月 1 件以上発見した事例
- ✅ Quality intelligence によるテスト戦略最適化提案を採用した事例
- ✅ helm install から 30 分以内に動作開始できる

### 4.5 Phase 3 のリスク

| リスク | 打ち手 |
|---|---|
| Server 製品化に 1.5-2 年分の追加工数 | Phase 1.5 / 2 で wedge を完成させ、design partner 経由で資金 / 採用を確保 |
| マルチテナント設計の複雑度 | 自社設置のみで multi-tenant を要件化しない、tenant = deployment |
| 認証 / RBAC 仕様の polish 時間 | Casbin / Cedar 等の OSS policy engine を採用、自前実装しない |
| compliance 文書 (SOC2 / ISO 27001) | self-hosted のため Workbench 自体の認証は不要。顧客 deployment 内で顧客が compliance 取得 |

---

## 5. cross-cutting 戦略

### 5.1 self-hosted distribution

Phase 1: npm package (Agent) のみ。
Phase 2: 同 Agent に CI 連携と Bundle 機能を追加。
Phase 3: helm chart / docker compose 公式配布、k8s operator (オプション)。

**SaaS は提供しない**。理由は PRODUCT.md §10 の通り。

### 5.2 AI コスト管理

3 階層で対応:
1. **Cache**: 同一 prompt + context は cache hit
2. **Model routing**: triage は Haiku、generation は Sonnet、巨大 context のみ Opus
3. **Customer API key**: customer が直接 LLM provider と契約し、Workbench は stateless caller

これにより:
- 個人開発者: 月 < $5 で運用可能
- 中規模チーム: 月 $50-200
- 大規模エンプラ: 月 $1k-5k (商用ツール 1/10-1/50)

### 5.3 OSS / community 戦略

| 領域 | 戦略 |
|---|---|
| Workbench core | OSS (MIT)、main repo |
| Workbench Server | OSS (MIT)、Phase 3 で公開 |
| rule pack | OSS、`@workbench/nextjs-rules` 等の community 公開 |
| skill pack | OSS、`@workbench/saas-checkout-skills` 等 |
| design partner | 限定公開で feature 共創、OSS 還元前提 |
| commercial offering | Phase 3 以降に support contract / managed service として検討 |

### 5.4 多言語 / i18n

Phase 1 / 1.5 は日本語先行 (PRODUCT, PLAN, RFC は日英両方)。
UI も日本語 first。Phase 2 で英語化。
Phase 3 で他言語 (中国語 / 韓国語) 対応検討。

---

## 6. 各 Phase 完了の Definition of Done

### Phase 1 (完了済)
PLAN.v2 §32 に準拠。`pnpm test` 943 件 + `pnpm smoke:gui:allure` 全合格。CI 緑。

### Phase 1.5
- `.workbench/` 仕様 RFC が確定し、`rfcs/0001` が "Accepted" 状態
- 多段 pipeline 7 phase 全てが動作する demo
- design partner 1 件以上が production 利用
- rule 違反率 < 5%、Layer Judgment 精度 > 80%

### Phase 2
- Quality Signal source 3 種以上を統合
- CI replay が 1 コマンドで動作
- Cypress / TestCafe どちらか 1 つ以上 adapter 提供

### Phase 3
- Server が helm install から 30 分以内に運用開始
- self-hosted で 3 社以上が production
- regulated industry で 1 社以上採用
- Continuous exploration が bug を月次発見

---

## 7. 残る Open Questions

PLAN.v2 §34 から繰越 + 新規:

| # | 質問 | 解消予定 |
|---|---|---|
| OQ-1 | 配布パッケージ名 (`playwright-workbench` で確定?) | Phase 1.5-α |
| OQ-2 | 探索 engine の primary 選択 (Stagehand vs Browser Use) | Phase 1.5-α 末で実機評価後決定 |
| OQ-3 | rule pack registry の運用形態 (npm? GitHub Releases?) | Phase 1.5-δ |
| OQ-4 | Conversation UI は sync (modal) か async (slack-like thread) か | Phase 1.5-γ design partner FB 後 |
| OQ-5 | Quality Signal schema の最終形 | Phase 2 中盤、3 source 実装後に確定 |
| OQ-6 | Server 製品化のチーム規模と資金タイミング | Phase 1.5 完了時点で再評価 |
| OQ-7 | self-hosted のみで GitHub App をどう配布するか | Phase 2-T2000-6 着手時 |
| OQ-8 | Test Plan の中間 schema (markdown vs structured JSON) | RFC 0001 で先行確定 |
| OQ-9 | 探索的 testing agent との API 契約 | Phase 2-T2000-2 着手時 |

---

## 8. 関連文書

- [PRODUCT.md](PRODUCT.md) — 製品ビジョン (Source of Truth)
- [PLAN.v2.md](../../PLAN.v2.md) — Phase 1 実装根拠 (現役)
- [rfcs/0001-workbench-directory.md](rfcs/0001-workbench-directory.md) — `.workbench/` + 多段 pipeline 詳細
- [test-plan-samples/](test-plan-samples/) — Test Plan 出力サンプル

---

## 9. 改訂履歴

- **v3.0** (2026-05): 初版。Phase 1.5 / 2 / 3 を新規定義。`.workbench/` + 多段 AI pipeline + Quality Signal Bus + Server 製品の roadmap を確立。
