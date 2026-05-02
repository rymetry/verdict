# Rule: Secret 取扱い

**Status**: enforced (security-critical)
**EN**: [`secret-handling.md`](secret-handling.md) (英語版が SoT、本書は理解補助)

Verdict 文脈での secret: AI provider API key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`)、GitHub PAT、`~/.codex/auth.json`、Stripe / DocuSign / SendGrid sandbox key (user fixture 内)、探索中にユーザーから供給される storageState / cookie 値。

## 厳格ルール

1. **secret 値を log しない。** `apps/agent/src/commands/redact.ts` (one-shot redaction) または `apps/agent/src/playwright/streamRedactor.ts` (run streaming) の redactor を使う。streaming path は必ず stream redactor を経由。one-shot log は opt-in で良い。
2. **run artifact に secret を永続化しない。** `metadata.json`, `*.log`, `quality-gate-result.json`, AI context, QMO Markdown — どれも生 API key を含めてはいけない。
3. **`process.env` を CommandRunner env に丸ごと含めない。** 明示的 allowlist を渡す。runner はデフォルトで `PATH` / `HOME` を追加する。
4. **エラーメッセージで secret を user prompt にエコーバックしない。** secret を含むエラーは throw 前に redact する。
5. **`.env`, `auth.json`, `*.key`, `*.pem`、gitleaks default rule にマッチするファイルを commit しない。** `.gitignore` で一般的なものは除外済 — PR ごとに再確認する。
6. **storageState / cookie 内容は secret として扱う。** Phase 1 の探索 adapter は cookie 値を log してはならない。domain と cookie 名のみ log。

## パターン: customer-managed API key

LLM provider について、Verdict は customer が **持参** する key を env var で渡す前提。agent は:

```ts
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  throw new Error("ANTHROPIC_API_KEY is not configured. See docs/operations/poc-guide.md.");
}
```

key は env allowlist 経由で AI CLI subprocess に転送する:

```ts
runner.run({
  executable: "claude",
  args: [...],
  env: {
    PATH: process.env.PATH!,
    ANTHROPIC_API_KEY: apiKey,
  },
});
```

CommandRunner は env を audit log にエコーしない; env の **キー** (値ではなく) のみ保存。

## 禁止事項

- production path で `console.log(req.body)` または `console.log(env)`。
- `<runDir>/stdout.log` への raw stdout 永続化 (streaming redactor を先に通すこと) — `apps/agent/src/playwright/runManager.ts` がこの方針。新しい run path はこれに従う。
- secret を含むエラーメッセージを返却する。stable error code (`AI_CLI_AUTH`, `AI_CLI_QUOTA`) を使用する。
- Stripe テストカードや DocuSign sandbox key を「non-secret」扱いする。fixture データは公開でも、同じコードパスが顧客環境でも動く。

## leak を見つけた場合

1. 該当 PR を停止。merge 不可とマーク。
2. secret が外部 surface (PR コメント、CI にアップロードされた log、AI provider request) に到達した場合、rotation が必要と仮定する。
3. `SECURITY.md` に従い `https://github.com/rymetry/verdict/security/advisories/new` で Security Advisory を開く。public issue は立てない。

## レビュアーチェックリスト

- [ ] 新しい logging path で secret を含み得る生 stdin/stdout を出力していないか?
- [ ] 新しい CommandRunner call の env は明示的 (allowlist) で、`process.env` spread でないか?
- [ ] 新しい探索コードで storageState / cookie / authorization header が redact されているか?
- [ ] PR が新しい env var を追加するなら、`docs/operations/poc-guide.md` で文書化されているか?
