# Bun Feasibility Report

## Summary

Phase 1.5 の結論は **Node.js runner 継続、Bun 実行は experimental block 維持** です。

Bun 自体は package manager と runtime を提供し、`bunx --no-install` で auto-install を抑止できます。一方、この Workbench の現行 fixture は pnpm workspace で依存解決されており、Bun 1.2.9 の `bunx --no-install` は `playwright` / `allure` の local binary を解決できませんでした。したがって、`bunx --no-install --bun playwright test` を今すぐ production path に入れると、既存 PoC の「local binary のみ実行」「暗黙 install 禁止」「Allure artifact pipeline」条件を満たせません。

## Sources Checked

- Bun docs: [`bunx`](https://bun.sh/docs/cli/bunx) は local package を先に探し、見つからなければ npm から auto-install する。`--no-install` は未 install package の install を抑止する。
- Bun docs: [`bun install`](https://bun.sh/docs/cli/install) は `bun.lock` を現行 lockfile として扱う。Bun 1.2 より前は binary lockfile の `bun.lockb`。
- Bun docs: [Welcome to Bun](https://bun.sh/docs) は Bun を package manager / runtime / test runner / bundler を含む toolkit と説明する一方、Node.js compatibility は継続的な取り組みとして扱っている。

## Local Environment

- Date: 2026-05-01
- Bun: `1.2.9`
- Fixture: `tests/fixtures/sample-pw-allure-project`
- Fixture install model: pnpm workspace

## Commands Executed

```text
bun --version
# 1.2.9

bunx --no-install --bun playwright --version
# error: Could not find an existing 'playwright' binary to run. Stopping because --no-install was passed.

bunx --no-install playwright --version
# error: Could not find an existing 'playwright' binary to run. Stopping because --no-install was passed.

bunx --no-install --bun allure --version
# error: Could not find an existing 'allure' binary to run. Stopping because --no-install was passed.
```

Bare `bunx playwright` / `bunx allure` は実行していません。Bun docs 上、未 install package は npm から auto-install されるため、Workbench の security model に反する副作用があります。

## PLAN.v2 §30 Checklist

| Item | Result | Notes |
|---|---|---|
| `bun.lock` / `bun.lockb` detection | Already implemented | `PackageManagerDetector` maps both to `bun` and marks status `experimental-bun`. |
| `bunx --no-install --bun playwright test` | Not production-ready | pnpm fixtureでは local `playwright` binary を解決できない。 |
| stdout/stderr streaming | Not re-tested | CommandRunner streaming は command-agnostic だが、Bun process を許可していない。 |
| JSON reporter | Deferred | Bun-installed fixture で Playwright 実行が通ることが前提。 |
| Allure results | Deferred | `allure` binary も Bun 経路では未解決。 |
| Allure report generation | Deferred | Existing Node path remains valid. |
| trace/screenshot/video | Deferred | Playwright command execution graduation後に検証する。 |
| Git/patch/AI CLI stdio stability | Deferred | Bun runnerを入れる前に検証する意味が薄い。 |
| macOS/Windows/Linux差分 | Deferred | CI matrix 追加が必要。 |
| Tauri sidecar outlook | Node sidecar継続 | 現行 Hono + Node CommandRunner のほうが PoC risk が低い。 |

## Decision

現時点で Bun は標準実行対象に昇格しません。既存実装のまま、Bun 検出時は `experimental-bun` として run execution を block します。

この判断は、以下の PLAN.v2 原則と整合します。

- 暗黙 install に依存しない。
- shell を使わず command + args 配列で実行する。
- ユーザー project の Source of Truth を壊さない。
- Phase 1.5 は検証対象であり、Phase 1 標準には含めない。

## Graduation Conditions

Bun 対応を再開する条件:

1. `tests/fixtures/sample-pw-bun-project/` を追加し、`bun.lock` を commit する。
2. CI で `oven-sh/setup-bun` 相当を使い、`bun install --frozen-lockfile` を実行する。
3. `bunx --no-install --bun playwright test --reporter=list,json,html` が local binary のみで成功する。
4. Allure fixture で `bunx --no-install --bun allure generate` と `quality-gate` が成功する。
5. stdout/stderr streaming、timeout、cancel、audit log、path redaction の既存 CommandRunner contract を満たす。
6. macOS / Linux で同じ結果が出る。Windows は Phase 2 以降の platform hardening で扱う。

## BunCommandRunner Design Sketch

実装する場合も、既存 `NodeCommandRunner` を置き換えずに `CommandRunner` interface の別実装として追加します。

- allowed executable: `bun`, `bunx`
- command template: `bunx --no-install --bun playwright test`
- policy: Workbench が組み立てた argv のみ許可し、package 名、subcommand、output path を validator で固定
- cwd: project root realpath 配下のみ
- env: existing allowlist を継承し、Bun 固有 cache path は標準では渡さない
- audit: existing audit shape を維持
- failure semantics: missing local binary は user-action warning、EACCES / ENOSPC / EMFILE 等は fatal operational code として propagate

## Follow-up

当面の後続タスクは Phase 3 の AI Analysis / Repair Proposal です。Bun は上記 graduation conditions を満たす専用タスクが追加されるまで再着手しません。
