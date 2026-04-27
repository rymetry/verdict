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

```bash
# どこかで HTTP サーバを立てて開く (file:// では Google Fonts 等が読み込めないため)
cd docs/design
python3 -m http.server 8765
# ブラウザで http://127.0.0.1:8765/concept-b-refined.html
```

または ngrok / VS Code Live Server / Vite preview server 等。

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

| # | PR タイトル案 | スコープ |
|---|---|---|
| α | `feat(web): foundation - Tailwind + shadcn/ui + design tokens` | tailwind.config.ts、shadcn 初期化、v10 oklch トークンを CSS variables → Tailwind theme へ移行 |
| β | `feat(web): chrome (top bar + statusbar)` | brand / breadcrumbs / theme toggle / persona toggle / 再実行 ボタン (shadcn primitives 利用) |
| γ | `feat(web): view router (TanStack Router)` | `/qa` `/dev` `/qmo` の route 化、deep link / browser back 対応 |
| δ | `feat(web): qa view migration (Phase 1 機能)` | ProjectPicker / TestInventory / RunConsole / FailureReview を新 design system に移植 |
| ε | `feat(web): developer view placeholder` | 関連ファイル / source viewer / locator inspector の placeholder cards |
| ζ | `feat(web): insights view (static mock)` | Release Readiness / Quality Gate / AI Summary (Phase 1.2 で Allure 統合時にデータ接続) |
| η | `feat(web): zustand store + state hoisting` | main.tsx の useState 群を store に集約 |
| θ | `test(web): foundation tests` | useTheme / statusToBadge / global keyboard / Persona の vitest テスト |

各 PR は約 500 行以内、レビュー粒度を保つ。

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
