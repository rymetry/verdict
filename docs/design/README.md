# `apps/web` デザインモックアップ

このディレクトリは **`apps/web` の UI / UX デザイン source-of-truth** を保管する。実装ではなくデザイン仕様。

## 収録物

- **`concept-b-refined.html`** — Playwright Workbench v10 "Balanced Green" モックアップ (single-file HTML/CSS/JS)
  - ライト / ダーク / 自動 (system 追従) の 3 モード切替
  - QA / Developer / Insights の 3 view 切替 (`q` / `d` / `m` キー、または UI ボタン)
  - **デザイン由来**: rymlab v12 "Balanced Green 156°" oklch パレットを採用
  - **タイポグラフィ**: Geist + Geist Mono + Noto Sans JP
  - **アクセントカラー**: `oklch(0.52 0.11 156)` (light) / `oklch(0.75 0.10 154)` (dark)
  - **ステータス色**: pass (hue 142, yellow-green) / fail (hue 27, red) / flaky (hue 80, yellow) / accent (hue 156, teal-emerald) — 色相を分離して識別性を確保

## 確認方法

このリポジトリは pnpm/Node ベースなので **同じスタックの static server** を使うのが望ましい:

```bash
# 推奨 (このリポのスタックと一貫)
pnpm dlx serve docs/design
# → http://localhost:3000/concept-b-refined.html

# 代替 (Python が手元にある場合)
cd docs/design
python3 -m http.server 8765
# → http://127.0.0.1:8765/concept-b-refined.html
```

`file://` で開くと Google Fonts 等の CDN リソースが CORS で読み込めない。

## 実装方針 (Phase 1 後続作業)

このモックアップを **`apps/web` (React) に移植する際は PLAN.v2 §7 の技術スタック** を厳守する:

- ✅ **Vite + React + TypeScript** — 採用済
- ✅ **TanStack Query** — 採用済
- ⏳ **TanStack Router** — view 切替に採用 (`/qa` `/dev` `/qmo` の route)
- ⏳ **Zustand** — 状態管理 (persona / theme / activeRunId 等)
- ⏳ **Tailwind CSS** — このモックアップの oklch トークンを `tailwind.config.ts` の `theme.extend.colors` に乗せる
- ⏳ **shadcn/ui** — Button / Badge / Tabs / ToggleGroup / Card / Tooltip / Alert などの primitive
- ⏳ **lucide-react** — アイコン (このモックの inline SVG を全置換)
- ⏳ **Monaco Editor** — Phase 1.2 / Developer View ソースビューア
- ⏳ **xterm.js** — Phase 1.2 / Run Console (リッチターミナル)

## 後続作業の構成 (推奨 PR 分割)

依存順序を踏まえて並べ替え。**θ (foundation tests) は α と並走** (TDD 原則: テスト先行)、**η (Zustand) は γ より前** (state を view router に渡す前に store 化、後で書き直さない):

| # | PR タイトル案 | スコープ | 依存 |
|---|---|---|---|
| α | `feat(web): foundation - Tailwind + shadcn/ui + design tokens` | tailwind.config.ts、shadcn 初期化、v10 oklch トークンを CSS variables → Tailwind theme へ移行 | — |
| θ | `test(web): foundation tests` (α と並走) | 設計トークン / theme switching / 共通 primitive の vitest + @testing-library/react テスト | — |
| η | `feat(web): zustand store + state hoisting` | persona / theme / activeRunId / lastRequest を store に集約 (view 化の前に整理) | α |
| β | `feat(web): chrome (top bar + statusbar)` | brand / breadcrumbs / theme toggle / persona toggle / 再実行 ボタン (shadcn primitives + lucide-react 使用) | α, η |
| γ | `feat(web): view router (TanStack Router)` | `/qa` `/dev` `/qmo` の route 化、deep link / browser back 対応 | β |
| δ | `feat(web): qa view migration (Phase 1 機能)` | ProjectPicker / TestInventory / RunConsole / FailureReview を新 design system に移植 | γ |
| ε | `feat(web): developer view placeholder` | 関連ファイル / source viewer / locator inspector の placeholder cards | γ |
| ζ | `feat(web): insights view (static mock)` | Release Readiness / Quality Gate / AI Summary。**Phase 1.2 で Allure 接続予定** (詳細は次節 "Allure 同期モデル") | γ |

各 PR は約 500 行以内、レビュー粒度を保つ。

### Allure 同期モデル (ζ で実装)

Insights view の Allure サマリは **pull モデル**:
- `apps/agent` 側で Allure JSON / history.jsonl を読む `AllureReportProvider` (PLAN.v2 §16) を実装
- `apps/web` 側は `GET /runs/:id/report-summary` (PLAN.v2 §19) で読み取り、TanStack Query で 5 秒間隔 polling (initial Phase 1.2)
- watch / push 化は Phase 2 以降の最適化対象

これにより Insights は **Allure を埋め込まず参照する** 形 (棲み分け原則を保持)。

### i18n 戦略

PoC は **日本語 only** (`<html lang="ja">` 固定、UI 文字列ハードコード)。理由:
- ユーザーは日本語ネイティブ、共同開発者も日本語想定
- PLAN.v2 §11 (Personas) に英語要件なし
- i18n を最初から入れると過度に YAGNI 違反

**英語化が必要になったタイミングで別 PR**:
- `react-i18next` または `next-intl` 導入
- 全文字列を `t()` 関数経由に変換
- 言語切替トグルを Chrome に追加

ハードコード文字列のうち翻訳必要箇所の grep が容易になるよう、PoC 中も `// i18n` コメントは付けない (将来の bulk 抽出時にノイズが減る)。

## 設計判断ログ (なぜこの形か)

### Insights view が Allure と競合しない理由

このモックアップの "Insights View" (旧称 QMO View) は、Allure Report 3 と **競合せず補完関係** を持つように設計している:

| | Allure Report 3 | Workbench Insights |
|---|---|---|
| 時点 | run 完了後の静的成果物 | 常時 / リアルタイム |
| 粒度 | テスト個別の詳細 (step, attachment, history) | プロジェクト全体の決定 (ship / don't ship) |
| 目的 | 「何が起きたか」を詳細に見る | 「次に何をすべきか」を判断 |
| ユーザー | dev / QA (深掘り) | QMO / release owner (意思決定) |

Insights view 内の「Allure サマリ」セクションには **「フルレポート ›」リンク** で Allure HTML へ誘導するパターンを設けている。詳細はそちらに委譲する設計。

### モード横断 CTA

primary CTA (再実行ボタン、ブランドマーク "P") は **両モードで同じダーク緑 + 白文字** に固定 (`--cta` トークン)。アクセント色 (`--accent`) はモード別に明度を変えるが、CTA だけは恒常表示にしてブランド体験を一貫させる。

### 黄緑 (pass) と青緑 (accent) の hue 分離

Pass ステータス (テスト合格) とアクセント (ブランド) はどちらも緑系だが、**hue を 14° ずらす** (pass: 142° yellow-green / accent: 156° teal-emerald) ことで「色だけで区別できる」設計に。アイコン形状 (✓ vs 塗り) と二重エンコードしてアクセシビリティも担保。

## 更新ガイドライン

このモックアップを更新する場合:
1. 別ブランチ (`docs/design-mockup-vXX-...`) で作業
2. 変更点を `## 設計判断ログ` に追記
3. 実装が追従できるか確認した上でマージ
4. 実装 PR で参照する際はこのファイルへの link を貼る
