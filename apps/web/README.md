# `@pwqa/web`

Playwright Workbench の React フロントエンド (Vite ベース)。
PLAN.v2 §7 に従い **Tailwind CSS v4 + shadcn/ui + TanStack Query** をスタックの中心とする。

## スタック (PLAN.v2 §7 準拠)

| 領域 | ライブラリ | 状態 |
|---|---|---|
| ビルド | Vite + React 19 + TypeScript | 採用済 |
| スタイリング | Tailwind CSS v4 (CSS-first via `@theme`) | 本 PR で採用 |
| コンポーネント | shadcn/ui (Radix UI primitives) | 本 PR で採用 |
| アイコン | lucide-react | 本 PR で採用 |
| データフェッチ | @tanstack/react-query | 採用済 |
| 状態管理 | Zustand | Issue #8 (η) で採用 |
| ルーティング | TanStack Router | Issue #10 (γ) で採用予定 |
| エディタ | Monaco Editor | Phase 1.2 / Issue #12 (ε) |
| ターミナル | xterm.js | Phase 1.2 / Issue #11 (δ) |

## ディレクトリ構成

```
apps/web
├── components.json          # shadcn/ui CLI 設定 (Tailwind v4 用に config 空)
├── src/
│   ├── components/
│   │   ├── ui/              # shadcn primitives (Button / Badge / Card / Tabs / ...)
│   │   └── foundation/      # FoundationPreview (基盤プリミティブの目視確認用)
│   ├── features/            # Phase 1 機能 (δ で Tailwind 化予定)
│   ├── hooks/               # 共通フック (use-workbench-events など)
│   ├── lib/                 # cn() などのユーティリティ
│   ├── store/               # Zustand store (useAppStore / useRunStore / theme-effects)
│   ├── styles/
│   │   └── globals.css      # Tailwind v4 + v10 Balanced Green トークン
│   ├── styles.css           # Phase 1 機能の暫定 CSS (δ 完了後に削除)
│   └── main.tsx
└── test/                    # vitest + @testing-library/react
    ├── setup.ts
    ├── components/
    ├── hooks/
    ├── store/
    └── ui/
```

## デザイントークン

`src/styles/globals.css` で **`docs/design/concept-b-refined.html` (v10 "Balanced Green 156°")** の oklch 値を `:root` / `.dark` 両方に定義し、`@theme inline` で Tailwind ユーティリティに公開する。

主要トークン:

| 名前 | 用途 | light | dark |
|---|---|---|---|
| `--accent` | ブランドアクセント | oklch(0.52 0.11 156) | oklch(0.75 0.10 154) |
| `--cta` | 主 CTA (両モード共通) | oklch(0.45 0.10 156) | 同左 |
| `--pass` | 合格ステータス | hue 142° | hue 142° |
| `--fail` | 失敗ステータス | hue 27° | hue 22° |
| `--flaky` | flaky | hue 75° | hue 80° |
| `--info` | 情報 | hue 240° | hue 232° |

色相分離 (pass=142° / fail=27° / flaky=75° / accent=156°) により色覚多様性下でもバッジ識別が可能。

## 利用例

```tsx
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function Sample() {
  return (
    <div className="space-y-2 bg-[var(--bg-0)] p-4">
      <Button>再実行</Button>
      <Badge variant="pass">合格 24</Badge>
      <Badge variant="fail">失敗 3</Badge>
    </div>
  );
}
```

## テーマ切替

Zustand の `useAppStore` を atomic selector で参照する。値は `"light" | "dark" | "auto"` の 3 値で、`auto` は `prefers-color-scheme` に追従する。`localStorage` が throw する環境 (Safari Private Mode 等) でも UI を白画面化させない安全側設計。`<html>` への class / data 属性反映と matchMedia 監視は `installThemeEffects()` が React tree 外で行うので、Provider のネストは不要。

```tsx
import { selectResolvedTheme, useAppStore } from "@/store/app-store";

const theme = useAppStore((s) => s.theme);
const setTheme = useAppStore((s) => s.setTheme);
const resolvedTheme = useAppStore(selectResolvedTheme);
```

## 動作確認

```bash
# Phase 1 機能を起動
pnpm dev:web

# 基盤プリミティブのプレビュー
open http://127.0.0.1:5173?foundation=1

# 型 + ビルド + テスト
pnpm --filter @pwqa/web typecheck
pnpm --filter @pwqa/web build
pnpm --filter @pwqa/web test
```

## shadcn/ui コンポーネントの追加

`components.json` を読み込んだ CLI を利用する:

```bash
pnpm dlx shadcn@latest add dialog
```

CLI が `src/components/ui/dialog.tsx` を生成し、`@/lib/utils` の `cn()` を import する。Tailwind v4 のため `tailwind.config.ts` は不要 (CSS-first)。

## 後続 Issue との関係

- Issue #6 (α): 完了 (PR #14)
- Issue #7 (θ): 完了 (PR #14)
- **Issue #8 (η)** — 本 PR (Zustand store + state hoisting)
- Issue #9 (β): chrome (top bar / statusbar)
- Issue #10 (γ): TanStack Router
- Issue #11 (δ): QA View 移植 — このタイミングで `styles.css` を削除する
- Issue #12 (ε): Developer View
- Issue #13 (ζ): Insights View
