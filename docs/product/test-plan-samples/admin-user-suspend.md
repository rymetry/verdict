# Test Plan: admin-user-suspend

> **このファイルは Workbench が生成する Test Plan の出力サンプル**です。
> RFC: [`docs/product/rfcs/0001-workbench-directory.md`](../rfcs/0001-workbench-directory.md) §4.4

---

## Intent (PM)
管理者権限を持つユーザは、規約違反などの理由で **他ユーザの account を suspend** できるべき。
suspend されたユーザは即時 (15 秒以内) に全 session が無効化され、login も拒否される。

### なぜこれが重要か
- 不正利用 / abuse 対応の即応性が SLA に含まれる (compliance 要件)
- audit log が完全であることが規制対応 (FISC 等) の前提
- 権限昇格 (privilege escalation) の boundary 検証は seurity 監査の重点項目

### Out of scope
- account 削除 (`admin-user-delete` で別途、論理削除 vs 物理削除の議論あり)
- bulk suspend (`admin-bulk-suspend` で別途、performance 中心)
- self-service 復活 申請 flow (`user-suspension-appeal` で別途)

---

## Layer Decision (AI)

| Layer | 採否 | 理由 |
|---|---|---|
| **E2E** | ✅ Primary | UI からの操作、被影響 user の session 無効化、login 拒否までの一気通貫 |
| **integration** | ✅ Adjunct | session 無効化 mechanism (Redis cache invalidation 等) を直接検証する integration test 推奨 |
| **contract** | ✅ Adjunct | audit log 出力の schema 検証 (downstream BI / SIEM が依存) |
| **unit** | ✅ Adjunct | 権限境界 (`canSuspendUser(actor, target)` 関数) は unit test 必須 |
| **manual** | ✅ Required | 規制対応の audit trail 完全性は **release ごと 1 回 manual review** 必須 (compliance 要件) |
| **security audit** | ✅ Required | 権限昇格 / IDOR の penetration test を四半期 1 回 |

### confidence
0.85 (audit log の改竄不可性は本 plan で完全には検証できない、Phase 3 Server で対応予定)

---

## Risks (AI 判定)

| Severity | リスク | 根拠 |
|---|---|---|
| **Critical** | 権限昇格 (一般ユーザが他ユーザを suspend できてしまう) | IDOR 系 vuln の典型、過去 OWASP Top 10 で頻出 |
| **Critical** | suspend が反映されず suspended user が継続利用可能 | session cache invalidation bug は production incident 経験あり (2025-Q4) |
| **High** | audit log 欠損 / 改竄 | 規制対応に直結、compliance 取消し risk |
| **High** | suspend した admin 自身の session には影響しない (誤って自分を suspend) | 自殺ガード必須 |
| **Medium** | suspended user の所有 リソース (project / contract) の扱い | 仕様確認必要 (Q1) |
| **Low** | UI 上の status 表示遅延 | 即時性は SLA 外、次回ページ更新で表示なら可 |

---

## Steps (AI 探索結果)

### 前提
- Admin user fixture: `users.admin` (権限: `superadmin`)
- Target user fixture: `users.target_for_suspension` (規約違反条件未設定の standard user)
- Audit log endpoint: `/api/audit-log` (admin only, 観測用)
- Session invalidation 確認 timeout: 15 秒 (SLA)

### Flow A: Happy path (admin suspends target)
1. **Login as admin** — `users.admin` で sign in (`auth-flow` skill 利用)
2. **Open second browser context (target user)** — Playwright multi-context: `users.target_for_suspension` で別 context login
3. **Verify target is active** — target context で `/dashboard` 表示確認
4. **Admin: navigate to user management** — admin context で `/admin/users` 遷移
5. **Search target user** — `data-testid="user-search-input"` に target email 入力
6. **Click suspend** — target user 行の `data-testid^="suspend-user-button-"` クリック
7. **Confirm modal** — `data-testid="suspend-confirm-button"` クリック (理由テキスト `"e2e test reason"` 入力)
8. **Verify admin UI updates** — target row の `data-testid="user-status"` が `"suspended"`
9. **Verify target session invalidated within 15s** — target context で page reload → `/login` redirect (SLA assertion: `await expect(...).toHaveURL("/login", { timeout: 15000 })`)
10. **Verify target login rejected** — 旧 credential で login 試行 → "Account suspended" エラー (`data-testid="login-error-suspended"`)
11. **Verify audit log entry** — `/api/audit-log` GET → 直近 entry が `{ action: "suspend", actor: admin.id, target: target.id, reason: "e2e test reason", timestamp: ... }` (Critical Risk #3)

### Flow B: 権限境界 (Critical Risk #1 — IDOR)
1. **Login as standard user** — `users.standard_b2c` で sign in
2. **Try to call suspend API directly** — `POST /api/admin/users/<other-user-id>/suspend` を fetch で叩く
3. **Verify 403 Forbidden** — response.status === 403、response.body に user の存在を leak しないこと
4. **Verify other-user is not suspended** — admin context で確認

### Flow C: Self-suspension prevention (High Risk #4)
1. **Login as admin** — `users.admin`
2. **Try to suspend self** — admin 自身の row の suspend ボタンが disabled か、UI 上存在しないこと
3. **Try via API direct** — `POST /api/admin/users/<self-id>/suspend` → 422 "cannot suspend self"

### Flow D: Audit log 不変性 (High Risk #3 — partial)
1. After Flow A, **try to delete audit log entry via direct DB** (test-only utility, normal API では削除手段が無いことを確認)
2. **Verify**: API には audit log 削除 endpoint が存在しない (`DELETE /api/audit-log/:id` → 404 not found)
3. **Manual review note**: 改竄不可性の完全な検証は Phase 3 Server で tamper-evident audit log として実装後

### Cleanup
- `test.afterEach` で target user を unsuspend (admin context 経由)
- audit log の test 痕跡は残置 OK (test 環境の audit log は別 schema)

---

## Skills used

- [`auth-flow.md`](../../../.workbench/skills/auth-flow.md) — login / logout / multi-context
- [`admin-action.md`](../../../.workbench/skills/admin-action.md) — admin UI 操作 pattern、audit log assertion
- [`data-cleanup.md`](../../../.workbench/skills/data-cleanup.md) — user state リセット

---

## Open Questions (AI → human)

| ID | 質問 | 回答待ち |
|---|---|---|
| Q1 | suspended user の所有 リソース (project / contract / draft) はどう扱う? freeze / read-only / full-hide のいずれか? | PM / Legal |
| Q2 | suspend の理由テキスト は audit log に保存されるが、suspended user 本人に表示するか? compliance 要件と user feedback の trade-off | PM / Compliance |
| Q3 | session invalidation SLA "15 秒" は AGENTS.md / SLA 文書に明記されている? Stagehand 探索で観測したが正規仕様か確認 | SRE / Domain |
| Q4 | super-admin (本 plan の admin) と通常 admin (権限細分化) で suspend 可能範囲が異なるか? RBAC matrix 必要 | Backend / Security |
| Q5 | unsuspend (suspend 解除) flow は別 plan? release blocking? | PM |

---

## Coverage Notes

このプロジェクトの test pyramid における位置付け:

- **`canSuspendUser(actor, target)` 権限関数**: unit test 必須 (`permissions.test.ts`、actor.role × target.relationship の matrix)
- **Session invalidation mechanism**: integration test 必須 (Redis cache 直接読み、E2E より高速で詳細検証)
- **Audit log schema**: contract test 推奨 (BI / SIEM downstream 契約)
- **Suspend API rate limit**: 別 E2E (`admin-user-suspend-rate-limit`) 推奨
- **Manual review (compliance)**: release ごとに必ず 1 回、auditor 立会いで実 audit log 確認
- **Penetration test**: 四半期 1 回、外部 vendor

→ この E2E は **happy path + 権限境界 + self-suspension の 3 軸 minimum smoke** として運用、深掘りは上記補強層で。

---

## Generated by

- Workbench v0.1.0
- Adapter: `claude-code` (Sonnet 4.6)
- Exploration engine: Stagehand
- Generated at: 2026-05-01T14:22:11Z
- Run id: `run-explore-ghi789`
- Cost (this plan): 24,800 tokens / $0.83

---

## Approval

- [ ] PM (`@pm-alice`) — Q1, Q2, Q5 確認、out-of-scope 妥当性
- [ ] SDET (`@sdet-bob`) — Q3 確認、Flow B/C/D の assertion 強化
- [ ] Backend (`@be-dan`) — Q4 RBAC matrix 確認、Flow B の API 経路確認
- [ ] Security (`@sec-eve`) — Q4 確認、Flow B (IDOR) と Flow D (audit log 改竄不可性) の test として十分か review
- [ ] QMO (`@qmo-carol`) — manual review 必須項目の release-readiness checklist 反映

approval 完了後、Workbench が **rule/skill/hook 駆動で 4 つの spec ファイルを生成**し、Repair Review flow に流します:
- `tests/admin-user-suspend.spec.ts` (Flow A)
- `tests/admin-user-suspend-permissions.spec.ts` (Flow B)
- `tests/admin-user-suspend-self-prevention.spec.ts` (Flow C)
- `tests/admin-user-suspend-audit-log.spec.ts` (Flow D)
