# Rule: ドキュメント方針

**Status**: enforced (低曖昧性、違反コスト高)
**EN**: [`documentation-policy.md`](documentation-policy.md) (英語版が SoT、本書は理解補助)

Verdict には複数の権威 (authoritative) ドキュメントがあり、これらは互換ではない。本 rule は誰がいつ何を edit するかを定義する。

## ドキュメント階層

| ドキュメント | 状態 | 変更責任者 | 編集タイミング |
|---|---|---|---|
| `PRODUCT.md` (product/) | 現役 vision | 稀に user / PdM | vision がシフトしたとき (新 wedge、新 positioning) |
| `PLAN.v3.md` | 現役ロードマップ | 新 T-task の起草者 | 新 phase milestone、新 T-task scope |
| `PLAN.v2.md` (root) | **凍結** Phase 1 リファレンス | 誰でもない | **絶対不可**。historical record として扱う |
| `IMPLEMENTATION_REPORT.md` (root) | 凍結 Phase 1 完了報告 | 誰でもない | 絶対不可。Phase 1.5 以降は別レポート |
| `docs/product/rfcs/0001-*` 以降 | 現役 design spec | RFC 起草者 | design が変わったら — 新 RFC version を作り、silently 書き換えない |
| `docs/operations/*` | 現役運用ドキュメント | 運用変更したエンジニア | runbook 変更時 (PoC ガイド、ReportPortal、Bun) |
| `docs/design/concept-b-refined.html` | UI/UX SoT | designer | visual design 変更 |
| `AGENTS.md` (root) | 現役 agent context | 規約を明示化するエンジニア | 新 rule / skill / convention 追加時 |
| `.agents/rules/*.md` | 現役 rule | rule 起草者 | 新 invariant / 境界 |
| `.agents/skills/*/SKILL.md` | 現役 skill | skill 起草者 | 新しい再利用可能ワークフロー |
| `README.md` (root) | 公開向け | release engineer | release 関連変更 |

## PLAN.v2 と PLAN.v3 が衝突するとき

PLAN.v2 は Phase 1 実装不変条件の権威。PLAN.v3 は今後の方向性。両者が一見相反するとき:

- **既実装挙動**: PLAN.v2 が勝つ。差異を「修正」するために PLAN.v2 を edit してはならない。代わりに PLAN.v3 か新 RFC で変更を記録する。
- **将来の方向性**: PLAN.v3 が勝つ。

PLAN.v3 §0 がこの枠組を定める。`chore: product vision v3` PR がこのフレーミングを文書化した。

## RFC バージョニング

- RFC は version (`v0.1`, `v0.2`, ...) と status (`Draft`, `Accepted`, `Superseded`) を持つ。
- breaking design 変更は新 RFC version を作る。歴史を silently 書き換えない。一番下の "Revision history" セクションで各 bump を記録。
- RFC 全体を superseded する場合、`Superseded` とマークし置換へリンク。

## 禁止事項

- Phase 1 の歴史を retcon するために `PLAN.v2.md` を edit する。
- `IMPLEMENTATION_REPORT.md` をどんな理由でも edit する。
- PLAN.v2 / IMPLEMENTATION_REPORT に "TODO" / "FIXME" を追加する (PLAN.v3 の follow-up に rerouting する)。
- 対応する rule を `.agents/rules/` に追加せずに `AGENTS.md` に新 convention を追加する。AGENTS.md は索引、rule が実体。
- design 議論用に repo root に新規 top-level Markdown を作る。新規 design は `docs/product/rfcs/` 配下、または skill / rule として置く。

## レビュアーチェックリスト

- [ ] PR が凍結ドキュメント (`PLAN.v2.md`, `IMPLEMENTATION_REPORT.md`) を触っていないか? 触っていたら hard reject。
- [ ] PR が `.agents/rules/` の rule entry なしに新 convention を導入していないか?
- [ ] PR が PLAN.v3 の entry なしに新 T-task を導入していないか?
- [ ] 外部公開ファイル (README, PRODUCT, PLAN.v3) は該当 convention で bilingual になっているか?
