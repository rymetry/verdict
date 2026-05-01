# Playwright Workbench — Product Vision

> **AI ネイティブなソフトウェア品質統合プラットフォーム。**
> テストを「コードを書ける人の専門技能」から「組織全体の共通知」へ民主化する、自社設置可能な OSS 基盤。

**Status**: Draft v3 (2026-05) / **Audience**: design partner / 実装担当 (Codex 等) / 社内意思決定

---

## 1. 1 行ポジショニング

役割横断 (QA / QMO / Dev / SDET) で **E2E 品質をひとつの画面で意思決定** できる、AI ネイティブな自社設置 OSS プラットフォーム。

---

## 2. 何を壊すか (zero-base)

| 既存プロセス | 破壊後 |
|---|---|
| QA が test 仕様書を Excel で書く | PM/Domain expert が intent を口述、AI が Test Plan に整形 |
| SDET が Playwright code を 1 行ずつ書く | AI が画面探索 → layer 判断 → plan → code を多段生成、SDET は監督 |
| QA が手動探索を 1 日かける | AI agent が 1 時間で 10 倍の路径探索 |
| 失敗ごとに人がトリアージ | AI が分類 + patch 提案、人は承認 |
| QMO が Excel と Allure URL でリリース判定 | AI が evidence-based recommendation、QMO は採否 |
| flaky test を月次で人が掃除 | AI が継続監視、rotate-out を提案 |
| 仕様変更で test 群が腐る | rule / skill / hook 駆動で AI が追従更新 |

## 3. 何を壊さないか (意図的な保守)

- **Playwright runtime** はデファクトとして維持。proprietary DSL を作らない
- **生成物は plain TypeScript code**。code review できる、Git 管理できる、IDE で読める
- **最終承認権限は human**。AI は推奨、human が決定 (規制業界の trust gap への配慮)
- **QA の専門判断**は置換でなく empower 対象。民主化は「QA が AI を指揮する knowledge worker」になるストーリー

---

## 4. 誰のために作るか

### Phase 1 wedge (現在 〜 12 ヶ月)
**「セキュリティポリシーで SaaS が使えない、QA + Dev + QMO の意思疎通に悩む、Playwright を採用済の 50-500 名規模エンタープライズ」**

具体ペルソナ:
- 国内金融機関の品質保証部門 (FISC ガイドライン下)
- 製造業の Web 系 SaaS 部門 (基盤を外部 SaaS に出せない)
- 公共機関の発注先 SI (audit log 必須環境)
- Web SaaS スタートアップ後期の QA チーム (商用ツールが高すぎる)

### Phase 2-3 拡張先 (12-36 ヶ月)
- Playwright だけでなく Cypress / TestCafe
- E2E だけでなく unit / integration / load / accessibility / security
- 単発 run だけでなく continuous exploration

---

## 5. なぜ今か (18 ヶ月ウィンドウ)

3 つの技術収束が **2024 年に同時発生**:

1. **foundation model**: Claude 4.x / GPT-5 で structured output + tool use が production 品質
2. **agent computer use**: Anthropic Computer Use / Browser Use / Stagehand で UI 操作が LLM-driven に
3. **AI コスト**: Sonnet 4.x で従来比 1/10、Haiku で 1/50。**継続探索が経済的に成立**

**18 ヶ月以内に "AI ネイティブ + self-hosted" カテゴリの leader を確立** しないと、商用 SaaS 各社の AI 機能化に飲まれる。

---

## 6. なぜ我々か (差別化)

| | Workbench | Mabl/Octomind | Playwright UI Mode | ReportPortal | Cursor / Claude Code |
|---|---|---|---|---|---|
| AI ネイティブ多段 pipeline | ✅ | ❌ (single-shot 生成) | ❌ | ❌ | △ (test 領域なし) |
| 自社設置 (self-hosted) | ✅ | ❌ | N/A | ✅ (heavy) | ❌ |
| plain Playwright code 出力 | ✅ | ❌ (proprietary DSL) | ✅ | ✅ | ✅ |
| rule / skill / hook guardrail | ✅ | ❌ | ❌ | ❌ | ✅ (product code) |
| 役割横断 (QA / QMO / Dev) | ✅ | △ | ❌ | △ | ❌ |
| Quality Gate / 履歴 / リリース判定 | ✅ | ❌ | ❌ | △ | ❌ |
| 探索的 agent 統合 (Phase 2) | ✅ | △ | ❌ | ❌ | ❌ |

**この組合せを満たす製品は世界に存在しない。**

---

## 7. 製品の核となる多段 AI pipeline

```
┌──────────────────┐  Browser Use / Stagehand / Playwright agent
│ A. 探索           │  → 実 UI を辿り、screen model を構築
└──────────────────┘
         ▼
┌──────────────────┐  LLM が DOM / network / 状態遷移を semantic 注釈
│ B. 理解           │
└──────────────────┘
         ▼
┌──────────────────┐  unit / integration / E2E / 不要 を AI 判断
│ C. layer 判断     │  ※ "AI Test Strategy Advisor" 単独 feature 化
└──────────────────┘
         ▼
┌──────────────────┐  非エンジニアも読める Markdown plan 生成
│ D. Test Plan 生成 │  ※ "test の民主化" の中核 artifact
└──────────────────┘
         ▼
┌──────────────────┐  曖昧があれば AI が user に inline 質問
│ E. 会話で曖昧解消 │  ※ Mabl/Octomind は問わない、我々は問う
└──────────────────┘
         ▼
┌──────────────────┐  rule / skill / hook 駆動で plain Playwright 生成
│ F. code 生成      │
└──────────────────┘
         ▼
┌──────────────────┐  既存の Repair Review flow で human gate
│ G. Repair Review  │
└──────────────────┘
```

各 phase の詳細仕様は [`docs/product/rfcs/0001-workbench-directory.md`](rfcs/0001-workbench-directory.md) 参照。

---

## 8. ロードマップ概要

| Phase | 期間 | 中核 | 状態 |
|---|---|---|---|
| **Phase 0** | 完 | Product 定義、PoC scope 確定 | ✅ |
| **Phase 1** | 完 | Local Runner + Allure pipeline + Quality Gate + AI triage + Repair Review (PLAN.v2 §29) | ✅ |
| **Phase 1.5** | 4-12 ヶ月 | **agent + rule + skill + hook 基盤**、**多段 AI pipeline**、**Test Plan 生成**、`.workbench/` 構造の標準化 | 計画中 |
| **Phase 2** | 12-24 ヶ月 | Quality Signal Bus、探索的 agent 結果統合、CI replay、PR comment 自動投稿 | 計画中 |
| **Phase 3** | 24-36 ヶ月 | 統合品質プラットフォーム化 (unit / load / accessibility / security 結合)、Server 製品化、self-hosted RBAC | 構想中 |

詳細は [`PLAN.v3.md`](PLAN.v3.md) 参照。

---

## 9. 戦略リスクと打ち手

| リスク | 打ち手 |
|---|---|
| Foundation model 依存 | model-agnostic prompt、customer の API key 持ち込み、ローカル LLM fallback |
| Self-hosted は data flywheel が無い | opt-in 匿名 telemetry / community-curated rule pack / foundation model 改善に乗る |
| Trust gap (規制業界の AI 拒絶) | AI は推奨に限定、human が承認、生成行為 audit log で改竄不可 |
| AI コスト爆発 | tier 設計、cache、cheap model routing (Haiku) |
| 製品の射程と組織の射程 | Phase 1.5 までは bootstrap 可、Phase 2 以降は採用 + 資金が必要 |
| QA 部門の反発 | "QA を排除でなく empower" narrative、QA を AI 指揮職に再定義 |

---

## 10. 配布モデル

- **Workbench Agent**: `npx playwright-workbench --project <path>` で起動。npm package。Phase 1 で完成済
- **Workbench Server** (Phase 2-3 で導入): k8s / docker compose で自社設置。PostgreSQL + S3 互換ストレージ。RBAC / audit log / multi-user comment 対応
- **Workbench Cloud SaaS**: 提供しない (少なくとも当面)。SaaS が wedge と矛盾するため

---

## 11. 関連文書

- [PLAN.v3.md](PLAN.v3.md) — Phase 1.5 / 2 / 3 の詳細 roadmap
- [rfcs/0001-workbench-directory.md](rfcs/0001-workbench-directory.md) — `.workbench/` 仕様、多段 pipeline 詳細
- [test-plan-samples/](test-plan-samples/) — Test Plan 出力サンプル 3 件
- [PLAN.v2.md](../../PLAN.v2.md) — Phase 1 実装根拠 (現役)

---

## 12. ステータス

- **Phase 1 (PoC)**: 完成。`sample-pw-allure-project` で実機検証済。`pnpm test` 943 件全合格、CI 緑
- **Phase 1.5**: 仕様 RFC 起草中。design partner 募集中
- **Phase 2/3**: 構想段階

design partner 候補 / 実装担当 / 社内検討者からのフィードバックを歓迎します。
