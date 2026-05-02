# Rule: Path Safety

**Status**: enforced (security-relevant)
**EN**: [`path-safety.md`](path-safety.md) (英語版が SoT、本書は理解補助)

Verdict の **Phase 1 PoC レビュー** で、API レスポンス・QMO Markdown・AI context への絶対パス漏洩が再発する bug クラスとして識別された。本 rule はその境界契約を成文化する。

## なぜ重要か

- 絶対パスはユーザーのファイルシステム構造 (`/Users/rym/Dev/...`) を漏らす。これはプライバシー / OPSEC 問題で、特に以下のシーンで:
  - run artifact が Phase 2 の "Sharable Bundle" として他 role / 他組織に共有される時。
  - QMO Markdown / AI context が PR コメント・Slack・外部ツールにペーストされる時。
  - LLM プロバイダが AI context を受け取る時 (絶対パスが組織外に exfiltrate される)。
- 自社設置エンタープライズ顧客 (金融・規制業) はコンプライアンスでこれを要求する。

## 契約

| 境界 | パス表現 | Notes |
|---|---|---|
| **内部 storage** (`metadata.json`, `quality-gate-result.json`, agent in-memory) | 絶対 OK | local file 操作で便利、外部に出ない |
| **`ProjectSummary.rootPath`** (`/projects/open`, `/projects/current` のレスポンス) | **絶対** (意図的) | これはユーザーが選んだ root であり、test/run 出力ではない。local control-plane が後続のナビゲーション・ファイル解決・CLI 起動を共通の root で行う必要があるため絶対パスが必要。server test で絶対 workdir を assert 済 |
| **HTTP API レスポンス** (上記以外: failure / artifact / evidence / run metadata の path field) | **project-relative のみ**、加えて optional な `absolutePath?: string` (OS-open 用、必須ではない) | 必須ではない |
| **WebSocket payload** | project-relative のみ | HTTP と同じ |
| **AI context** (LLM に送信) | project-relative のみ、**`absoluteFilePath` は厳密に undefined** | `analysisContext.test.ts` で検証済 |
| **QMO Markdown** (`qmo-summary.md`) | project-relative のみ | Markdown は共有を想定 |
| **Repair Review draft / GitHub PR コメント** | project-relative のみ | 外部公開 |
| **Failure Review UI surface** | project-relative のみ | role 横断 view |
| **Audit log** (`audit.log`) | `cwdHash` 付きで絶対 OK | local diagnostic |

`ProjectSummary.rootPath` の例外は意図的: *local* control plane が *active* project を自身の GUI に伝えるのは、path-safety が対象とする脅威モデルではない。脅威モデルは **共有 / 外部 surface** (PR コメント、AI context、Bundle export) である。これらの payload 内部の run-scoped path field は、`rootPath` 自身が絶対であっても relative のままにする。

## 遵守方法

1. `packages/shared` で payload schema を新規追加・修正する際、path field は明示的に命名する:
   - `relativeFilePath: string` (API 境界で必須)
   - `absoluteFilePath?: string` (optional、OS-open helper 専用)
2. 外部境界に出力するすべての serializer で、path を `projectRelativePath(filePath, projectRoot)` (`apps/agent/src/reporting/failureReview.ts` および `apps/agent/src/ai/analysisContext.ts` 定義) を通す。
3. helper は以下で `undefined` を返さなければならない:
   - `..` segment を含むパス (traversal escape 試行)。
   - 解決後に project root の外にあるパス。
4. helper が `undefined` を返した場合、`safeDisplayPath()` (basename を返す) に fallback する — 生絶対パスは絶対に返さない。
5. 新しい serializer を書く際は、絶対パス入力を与えた時に出力 JSON / Markdown に `/Users/`, `C:\`, 絶対パスパターンが含まれないことを assert するテストを書く。

## 禁止事項

- Hono route handler から `path.resolve(...)` 結果を直接返す。
- `cwdHash` redaction なしで絶対パスを `console.error` / `pino.error` にログ出力する。
- AI context payload に `absoluteFilePath` を含める (常に `undefined`)。
- `projectRelativePath` を試さずに `path.basename` を "fallback" 使用する — relative が達成可能なときに basename は情報を失いすぎる。

## リファレンス実装

- `apps/agent/src/reporting/failureReview.ts` — traversal guard 付き serializer path 正規化のリファレンス。
- `apps/agent/src/ai/analysisContext.ts` — AI context 専用の厳格 handling のリファレンス。
- `apps/agent/test/aiAnalysisContext.test.ts` (`drops traversal relative paths from AI context`) — load-bearing なセキュリティ assertion。新しい path-handling コードはこのテストパターンに倣う。

## レビュアーチェックリスト

payload を出力するコードパスの追加・修正 PR をレビューする際:

- [ ] `packages/shared` の schema が `relativeFilePath` と `absoluteFilePath` を区別しているか?
- [ ] serializer は project root を渡して `projectRelativePath` を呼んでいるか?
- [ ] `..` traversal 入力が処理されているか (生パスではなく `undefined` を返すか)?
- [ ] 出力に絶対パスが現れないことを assert する test があるか?
- [ ] AI context path の場合、`absoluteFilePath` は厳密に `undefined` か?
