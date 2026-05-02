---
name: write-rfc
description: 2 コンポーネント以上に跨る design 変更、新規の外部連携 (GitHub App / ベンダー SDK)、新規のディスク上フォーマットや CLI フラグ、セキュリティ/プライバシーへの影響がある変更を提案するときに使う。単一パッケージのリファクタリングやローカルな修正は RFC を作らず、簡潔な commit message で済ませる。RFC テンプレート、status ライフサイクル (Draft/Accepted/Implemented)、レビュー手順を定義する。
---

# RFC を起草・改訂する

> EN: [`SKILL.md`](SKILL.md) (英語版が SoT、本書は理解補助)

Verdict の RFC は `docs/product/rfcs/` 配下に置く。最初の `0001-workbench-directory.md` が `.workbench/` directory と多段 AI pipeline を定義する。新 RFC は同じ shape に従い、reviewer が各セクションを予想できるようにする。

## いつ使うか

- 変更が 2 コンポーネント以上に跨る (agent + web、または shared schema + agent + web)。
- design に user-facing impact がある (新 file layout、新 CLI flag、新 GitHub App)。
- design がセキュリティ / プライバシー / コンプライアンス姿勢に影響する。
- 単一 PR で全 design が捕捉できない (段階的 rollout を予期している)。
- 既存 RFC の design 判断を反転または大幅修正する。

変更が 1 ファイル / 1 package に閉じる場合、**コメント + 緊密な commit message で十分** — RFC を over-engineer しない。

## テンプレート

新 RFC はこの shape を使う:

```markdown
# RFC NNNN: <Title>

| Field | Value |
|---|---|
| Status | Draft |
| Authors | Verdict team |
| Created | YYYY-MM |
| Target | <Phase or milestone>
| Supersedes | <prior RFC, if any>
| Related | <links to PRODUCT, PLAN, prior RFCs> |

---

## 1. Motivation

問題は何か? なぜ今か? 何もしないコストは?

## 2. Goals & Non-goals

### Goals
- ...

### Non-goals
- ... (scope を明示的に bound; reviewer から関係ない feature を要求されないようにする)

## 3. Detailed design

実体。役立つときは図 (ASCII / mermaid) を入れる。読み手が grep できるよう既存
コンポーネント名を正確に参照する。

## 4. Integration with existing architecture

再利用境界 — 何が新規、何が再利用、何が deprecated か。delta を PLAN.v3 タスク
ID にマップ。

## 5. Versioning & migration

versioned artifact (config、on-disk schema) を導入する場合、migration story を
事前に文書化。"v0.1 を install した顧客は ... する必要がある" のように。

## 6. Security considerations

脅威モデル。新 attack surface は? 緩和策は? `.agents/rules/secret-handling-ja.md`、
`.agents/rules/no-shell-ja.md`、`.agents/rules/path-safety-ja.md` を該当時に
相互参照。

## 7. Open questions

target 解決日 / phase 付きの番号付き質問。レビュー議論の anchor になる。

## 8. Examples

具体例 — skeleton ではなく完全に埋まった形。読み手はこれだけで end state を
想像できるべき。

## 9. References

内部: PRODUCT、PLAN.v3、prior RFCs。
外部: vendor docs (Stagehand、Anthropic 等) — fetch 済、推測ではない。

## 10. Revision history

- **v0.1** (YYYY-MM): Initial.
- **v0.2** (YYYY-MM): <変更理由>。
```

## 番号

時系列順に `0001`, `0002`, ...。常に 4 桁。番号を skip しない。

## Status ライフサイクル

- `Draft` — 活発に iteration 中。変更が予期される。
- `Accepted` — design が合意された。実装は完了している場合もそうでない場合もある。
- `Implemented` — design がコードで具現化されている。RFC は文書として残る。
- `Superseded by NNNN` — 新 RFC で置換された。

status を変更するには、上部の metadata 表を edit **かつ** 下部の Revision history 行を追加する。

## 起草フロー

1. 作業ブランチを作る: `docs/rfc-NNNN-short-title`。
2. 上記テンプレートを `docs/product/rfcs/NNNN-short-title.md` にコピー。
3. JA 版を先に書く (もしくは project が English-first なら EN)、その後もう一方を `NNNN-short-title.en.md` に翻訳。
4. PR タイトル: `docs(rfc-NNNN): <one-line>`。
5. 人間 1 名 + AI reviewer 1 名 (Codex / Claude) からレビュー。両者 approve まで loop。
6. merge 時、status は `Draft` で開始。最初に大きな chunk を実装する PR で `Accepted` に bump。

## 禁止事項

- "ステルス" RFC (通常 feature PR の body に 500 行の design 議論を密かに乗せる)。RFC PR と実装 PR に分割する。
- `Accepted` / `Implemented` RFC を version bump なしに改訂する。
- 読まずに external link を citing する。reviewer は未検証の claim を見破る。
- 既存と衝突する新コンポーネント / ファイル名を invent する。

## 参考

- `docs/product/rfcs/0001-workbench-directory.md` — shape の canonical reference。
- `docs/product/rfcs/README.md` (存在すれば) — 全 RFC とその status の index。

## 関連

- `.agents/skills/execute-t-task/SKILL-ja.md` — Accepted RFC に従う実装フロー。
- `.agents/rules/documentation-policy-ja.md` — RFC が文書階層のどこに位置するか。
