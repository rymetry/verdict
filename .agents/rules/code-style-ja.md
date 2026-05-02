# Rule: コードスタイル

**Status**: enforced
**EN**: [`code-style.md`](code-style.md) (英語版が SoT、本書は理解補助)

Verdict プロジェクト全体の TypeScript / JavaScript コードスタイル。ユーザーグローバルの `coding-style.md` (immutability、小ファイル、包括的エラー処理) を基盤に、本モノレポ向けにチューニングしたもの。

## 必須事項

### TypeScript
- どこでも `strict: true`。`tsconfig` で disable しない。
- アプリケーションコードでは **`any` 不使用**。信頼できない入力は `unknown` を使い、安全に narrow する。caller 駆動の型は generics で。
- 公開 API (ファイル間 export) はパラメータと戻り値の型を明示する。ローカル変数は inference に任せて良い。
- 拡張される object 形状は `interface`、union / intersection / mapped 型は `type` を優先。
- interop で必要でない限り、文字列リテラル union を `enum` より優先。

### Immutability (CRITICAL)
- 入力を mutate しない。新しい object/array を作る: `const result = { ...prev, field: value }`。
- 共有される構造で consumer が mutate すべきでないものは `Readonly<T>` / `ReadonlyArray<T>` を付ける。
- Zod schema は mutation 用 hook 付きで re-export しない。variant が必要なら clone する。

### ファイル組織
- 多数の小ファイル > 少数の大ファイル。1 ファイル 200-400 行を目安に、800 行が hard ceiling。
- 種類別ではなく feature/domain 別に置く。
- 関数が ~50 行を超える、または変更理由が 3 つ以上になったら pure helper に抽出。

### コメント
- デフォルトは **コメントなし**。識別子で *what* を語らせる。
- *why* が自明でない場合のみコメントを追加: 隠れた invariant、規制制約、驚くべきプラットフォーム挙動。
- 現在の PR / Slack / issue 番号を参照するコメントは禁止 (rot する)。耐久性のある artifact (RFC、PLAN.v3 §x.y、security review note) を参照する。

### エラー処理
- システム境界 (HTTP body、env var、ファイル内容) では Zod 等で validate する。
- 信頼できるモジュール境界の内側では、caller を信頼し型システムに依拠する — 再 validate しない。
- エラーを sailently swallow しない。log + structured throw、もしくは propagate。ユーザーグローバルの "Never silently swallow errors" は binding。
- `AI_CLI_NOT_FOUND` のような stable な `code` 文字列を持つ typed error を `instanceof` チェーンより優先。
- UI / Markdown / AI surface には、既存の redaction layer 経由で stack trace と絶対パスを除去する。

### React (apps/web)
- コンポーネントは関数。`React.FC` 不使用。
- props は名前付き `interface`。callback は明示的に型付け。
- hooks: 下流の effect が同一 identity に依存している場合のみ `useCallback` / `useMemo` を返す。
- データ層は TanStack Query。`useEffect` で fetch しない。
- 視覚層は shadcn/ui primitives。再実装しない。
- 構造化された run / failure / artifact データはすべて Zod-validated な API レスポンスを通る。

### Node Agent (apps/agent)
- Hono router。Route は `c.json(payload)` を返し、`payload` は `packages/shared` の Zod schema に一致する。
- ログは `pino`。production path で `console.log` 禁止 (codebase 上 dev / test plumbing に限り `console` を許容)。
- ファイル I/O は既存の storage layer (`apps/agent/src/storage/`) を経由する。生 `fs.writeFile` は不可。

## 禁止事項

- `any` (`unknown` を使って narrow する)
- 関数引数の mutation
- 文字列からの動的コード実行 (ユーザー入力をコードとして evaluate する evaluator は避ける)
- 深くネストした三項演算子。命名済み関数に抽出する
- third-party の型を thin wrapper なしで自前として re-export する

## Enforcement
- すべての PR で `pnpm typecheck` が pass しなければならない。
- `post-tool-use-typecheck.sh` hook が `.ts` / `.tsx` の Edit / Write 時に型 drift を flag する。
- ユーザーグローバル hook (Prettier、console.log 監査) は Claude Code / Codex の default 経由で依然として作用する。

## Rule の置き場所: prose vs. lint

静的に検査可能な不変条件は toolchain で書く。本ファイル (prose) ではない。
新しい行を `.agents/rules/` に書く前に問う: 「これは lint rule で表現できないか?」
yes なら lint rule にする。

| TypeScript / ESLint / ast-grep / hook 側に置くべきもの | 本ファイル (prose) に置くべきもの |
|---|---|
| "`any` 禁止"、"unused import なし"、"package 跨ぎの相対 import 禁止" | immutability がなぜ重要か、どのパターンを採用するか |
| Locator-policy 違反 (`xpath=...`)、禁止 API 名 | このコードベースで maintainable な test とは何か |
| ファイルサイズ上限 (1 ファイル 800 行) | helper を抽出 vs. inline 化する判断基準 |
| import 順序、JSX attribute 順序 | schema-first の根拠 |

prose rule は **判断・原則・文脈依存の契約** のためのもの。読む coast が高く drift しやすいため、静的解析で表現できない指針に限って残す。"X を Y より優先する" と prose で書いていて X / Y が syntactic に区別可能なら、lint rule に migrate する issue を立てて prose 側から削除する。

これは optional ではない: lint rule 化 *可能* な prose rule は保守 bug。コードベースと silently drift し、reviewer が既に先に進んでいるのに agent がこれを gospel として引用する誤解を招く。
