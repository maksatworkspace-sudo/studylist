# Counts, Guest Ownership And Motion: Final CI Record

Scope: #21, #22, #24 only. Date: 2026-10-20.
Tested pushed application commit: `6c17878b0239ddab892df736a511f2cbf18df702`.

[GitHub Actions run 39356614841](https://github.com/maksatworkspace-sudo/studylist/actions/runs/39356614841)
completed successfully. This record is written by the orchestrator from actual
CI output, not a substitute for an independent QA acceptance verdict.

## Observed Results

- Type checking and production build passed.
- `npm test`: 81 passed, 21 live-HTTP cases skipped in this unit invocation.
- `npm run test:sqlite`: 35 passed, zero skipped.
- Strict isolated runner: 21/21 live HTTP tests passed, zero skipped;
  Playwright browser suite passed; SQLite restart persistence passed, including
  CSRF denial. The previously skipped live-HTTP cases ran here.
- Isolated mock-mode browser suite passed with zero application API traffic.

The independent QA-authored browser cases exercise scoped counters, last-bookmark
removal, navigation/filter reset, failed and pending authentication, duplicate
submission, welcome/farewell, dialog focus containment and restoration, normal
and reduced motion at desktop/mobile/narrow sizes, and rejected bookmark state.
Earlier failing dialog focus containment is covered by the unchanged regression
assertion after the application's explicit Tab-boundary fix.

## Parent-Captured Screenshots

These are synthetic-fixture screenshots captured manually by the parent agent,
not independent QA manual execution and not final-CI screenshots:

- [Before: desktop](../screenshots/ux-motion/01-before-desktop.jpg)
- [Before: login](../screenshots/ux-motion/02-before-login.jpg)
- [Pending login](../screenshots/ux-motion/03-login-feedback.jpg): the filename
  does not imply a successful welcome state; this shows the pending spinner.
- [Empty Saved counters](../screenshots/ux-motion/04-saved-empty-desktop.jpg)

## Acceptance Status

Implementation and automated regression checks are pushed. Independent QA's
final per-AC review/closure is still pending: its execution stopped with an
account usage-limit error before it could examine this final successful run.
The orchestrator has not issued a QA PASS or closed #21, #22 or #24 on its behalf.
See [earlier independent evidence](ux-motion-2026-10-20.md) for RED runs and the
independent browser-capability limitation. No live-provider, deployment, wider
MVP or production-readiness acceptance is claimed by this scoped record.
