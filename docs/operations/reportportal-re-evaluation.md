# ReportPortal Re-evaluation Decision Record

## Decision
ReportPortal is not part of the initial Workbench adoption path. Workbench remains Allure-first and file-first until the project has a clear need for centralized TestOps.

This keeps the current architecture aligned with PLAN.v2:

- Allure HTML, Allure results, Playwright JSON, Quality Gate output, and QMO summaries remain the source of truth for local and CI evidence.
- ReportPortal is treated as a future parallel provider, not a replacement for Allure.
- Existing Allure static archives and `allure-history.jsonl` stay valid if ReportPortal is introduced later.

## Re-evaluation Triggers
Revisit this decision when at least one of these becomes true:

- Multiple teams or multiple projects need shared triage queues.
- Test ownership, assignee, defect type, and investigation status need central management.
- Jira or another issue tracker must be deeply linked from test items.
- Long-term cross-project search, dashboarding, or ML-assisted triage becomes a primary workflow.
- File-first Allure history becomes insufficient because launch volume, retention, or search requirements outgrow static artifacts.

## Current Rationale
The current Workbench scope values reproducible local evidence and PR/release review artifacts over a central reporting service. Adding ReportPortal now would introduce server lifecycle, credentials, remote API failure modes, and user/role administration before the product has proven that central triage is necessary.

The existing provider boundary is already enough for the current needs:

- `PlaywrightJsonReportProvider` reads Playwright JSON output.
- `AllureReportProvider` reads run-scoped `allure-results`.
- `mergeReadSummaryResults` keeps Playwright JSON authoritative for counters and uses Allure to augment evidence.

ReportPortal should enter only when central collaboration outweighs this additional operational cost.

## ReportPortal Capabilities To Map
When re-evaluating, map Workbench concepts to ReportPortal concepts explicitly:

| Workbench | ReportPortal candidate | Notes |
|---|---|---|
| Run | Launch | Use stable launch attributes for project, branch, commit, CI run, and Workbench run id. |
| Spec / suite | Suite or nested test item | Preserve Playwright hierarchy without forcing Allure history shape into ReportPortal. |
| Test case | Test item | Keep Workbench test id / full title / file path as attributes or code location metadata. |
| Failure review | Defect type, issue link, log, comment | Do not make ReportPortal classification the only local evidence source. |
| QMO summary | External summary artifact / launch attributes | Continue generating Workbench summary even when ReportPortal exists. |
| Allure attachments | Logs / attachments | Preserve existing archived artifacts and optionally link/copy selected evidence. |

ReportPortal documentation confirms that attributes can exist at launch, suite, test, and step levels and are used for filtering/widgets. Its API documentation also exposes test item lifecycle, history, and issue-link operations. Those map well to a future central triage workflow, but they are not required for the current file-first path.

## Future Extension Plan
Implement ReportPortal in phases, only after the triggers above are met.

### Phase A: Configuration and Secret Boundary
- Add project-level ReportPortal settings only when explicitly enabled.
- Required fields: endpoint, project key/name, launch naming template, token reference.
- Store tokens outside committed config and redact endpoint/token values in logs.
- Add a connectivity check that is manual and read-only by default.

### Phase B: Publish New Runs
- Add a run-completion publisher that sends new run results to ReportPortal.
- Keep this separate from `ReportProvider.readSummary`; publishing is a side effect, reading is evidence normalization.
- Send only new runs. Do not backfill historical Allure archives by default.
- Persist remote launch id / URL in Workbench run metadata for traceability.

### Phase C: Add `ReportPortalProvider`
- Add a `ReportPortalProvider` behind the existing provider interface or a small extension of it.
- Read remote launch summary, failed test items, attributes, defect classification, issue links, and history.
- Normalize remote data to Workbench shared models before exposing it to QMO / QA views.
- Keep Playwright JSON or Allure as the local fallback when ReportPortal is unavailable.

### Phase D: Parallel Operation
- Display ReportPortal links alongside Allure links.
- Do not merge Allure history and ReportPortal history into one synthetic timeline unless a concrete user flow requires it.
- Use stable correlation keys: Workbench run id, CI run id, commit SHA, spec relative path, full title, and retry index.
- Treat remote classification as advisory evidence, not as the only source for release readiness.

### Phase E: Governance Review
- Define ownership for ReportPortal project administration, retention, defect taxonomy, and access control.
- Document incident behavior when ReportPortal is down: local run execution and local Allure/QMO outputs must continue.
- Add backup/export expectations before using ReportPortal as a compliance or audit source.

## Minimum Acceptance Criteria For Adoption
ReportPortal adoption is justified only if all items below have an owner and a testable workflow:

- A central triage workflow with named users/roles.
- A defect taxonomy that maps to the team's release decisions.
- Issue tracker linking rules.
- Retention and access-control policy.
- Failure-mode plan for remote outage and partial publish.
- A migration-free parallel operation plan with Allure retained.

## Security And Operations Notes
- Treat ReportPortal tokens as secrets. Never write them to `PROGRESS.md`, PR bodies, run logs, or generated reports.
- Avoid sending raw local absolute paths unless the team has explicitly accepted that exposure.
- Bound attachment upload size and file types before any remote publish path is added.
- Make remote publish opt-in per project or per run; local test execution must not depend on ReportPortal availability.
- Use idempotency or deterministic launch attributes so retries do not create misleading duplicate runs.

## Sources Checked
- ReportPortal Launches/test items attributes: https://reportportal.io/docs/work-with-reports/LaunchesTestItemsAttributes/
- ReportPortal API test item collection: https://developers.reportportal.io/api-docs/service-api/test-item/
- ReportPortal filtering launches: https://reportportal.io/docs/work-with-reports/FilteringLaunches/
