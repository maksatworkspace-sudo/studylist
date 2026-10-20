# Independent Acceptance: #21, #22, #24

Date: 2026-10-20. Verdict: **PASS**, limited to these three issues.
Reviewer: the independent QA role; no application fixes were made by this role.

## Exact Evidence

- Application: `6c17878b0239ddab892df736a511f2cbf18df702`.
- Additional acceptance assertions: `88843001e13719c4575bc58b23627fbf46c63254`.
- [Verified final CI run 39357459459](https://github.com/maksatworkspace-sudo/studylist/actions/runs/39357459459)
  completed SUCCESS. QA independently read its actual job status and logs.
- Typecheck, build and contract gate passed. Unit invocation: **81 passed,
  21 live-HTTP cases skipped**; those same HTTP cases ran in the strict phase:
  **21/21 passed, zero skipped**. Standard SQLite suite: **35 passed**.
- Strict browser suite passed (149.1s); separate-process SQLite restart and CSRF
  denial passed (25.2s). Mock browser suite passed (27.4s), including the new
  two-account Saved-count case and zero application API traffic.
- Earlier independent execution of the unchanged ownership regressions:
  **17/17 memory**; **19/19 SQLite including migration cases**. The added legacy
  test was RED on both adapters before the provenance fix; see the chronological
  [independent execution record](ux-motion-2026-10-20.md).

CI is execution of QA-authored assertions, not an engineer's summary. Browser
totals are not invented: the runner reports suite PASS, not individual counts.
No local browser CLI, independent manual IAB session or live provider calls are
claimed. This QA session could not access IAB; automated browser proof is used.

## #21: Counts

| AC | Verdict | Direct evidence |
| --- | --- | --- |
| AC1 | PASS | Domain/HTTP privacy tests, account ownership DTO assertions and browser My Messages/Saved navigation; page scope uses isAccountOwner for signed-in viewers. Mock test switches user to teacher with private bookmark isolation. |
| AC2 | PASS | Browser compares every overview/type/result count to independently filtered DTOs for search, type, status, course and teacher; popular sorting preserves counts. |
| AC3 | PASS | Populated feed with empty Saved and no-match filters produces three zero overview values, four zero tab badges and zero results; checked in HTTP and mock browser modes. |
| AC4 | PASS | Last bookmark removal, repeated filtering/navigation, logout and delayed pre-logout boot response settle to the correct current viewer. Pending auth is guarded; initial loading/error branches were source-reviewed and are distinct from successful empty results. |
| AC5 | PASS | Committed real/mock browser assertions, HTTP ownership/isolation tests and explicit stale-response ordering all executed in the final green run. |

## #22: Guest Ownership

| AC | Verdict | Direct evidence |
| --- | --- | --- |
| AC1 | PASS | Independent tests prove a receipt is returned without a grant, immediate direct edit/delete/reopen is denied, and explicit unlock restores permission. |
| AC2 | PASS | Selected-post/session isolation, bad/missing/mismatched codes, expiry/revocation, hidden-post privacy and official-reply restrictions pass. Existing code-attempt limiter is retained and inspected. |
| AC3 | PASS | Registered anonymous posts have account ownership; code-unlocked guest posts retain isAccountOwner=false even while signed in. HTTP and browser use that distinction for My Messages. |
| AC4 | PASS | Guest -> account A -> account B -> logout and recovery revoke grants; staged attachment tokens migrate without guest ownership. Legacy unprovenanced rows never authorize access. |
| AC5 | PASS | Recovery rotates the code and invalidates previous grants without auto-unlock; old code and reused recovery tokens fail. Safe local recovery channel/non-enumerating response inspected; no actual mail sent. |
| AC6 | PASS | Feed/detail serialization excludes receipt code/hash; UI presents secrets only in receipt/recovery. Expiry/rotation tests pass; browser URLs and logging paths were reviewed without recording secret values. |
| AC7 | PASS | Preserved RED -> GREEN proof; mock/memory/SQLite regressions plus real HTTP/browser integration. Version-1 SQLite migration preserves all non-grant records, attachment bytes and receipt hashes; explicit re-unlock persists across repeated restarts. |

## #24: Motion And Interaction

| AC | Verdict | Direct evidence |
| --- | --- | --- |
| AC1 | PASS | Reusable enter/exit tokens, restrained transforms, control states and loading-only spinners source-reviewed; browser verifies dialog timing and unchanged compact layout. |
| AC2 | PASS | Held login request produces no premature success; duplicate submission is suppressed. Confirmed welcome/farewell and delayed old-account response are asserted. Register/confirm runs in the isolated fixture; registration's distinct feedback branch was source-reviewed. Published demo credentials use normal login; the removed role picker is not reintroduced. |
| AC3 | PASS | Failed keyboard login preserves both inputs, leaves the dialog open, focuses its useful error and emits no success; held duplicate submission creates one auth mutation. |
| AC4 | PASS | Unchanged Tab-boundary regression, focus restoration, Escape, actual backdrop dismissal, interrupted exit/reopen retaining input and toast replacement/dismissal pass. Presence/inert and single status-node lifecycle reviewed. |
| AC5 | PASS | Filter/page counts, last bookmark, rejected bookmark/support/rating and preserved rating draft are asserted against server truth. Existing successful rating flow passes; pending guards and animation lifecycle do not duplicate requests. |
| AC6 | PASS | Actual browser reduced-motion emulation checks no dialog transform/meaningful animation duration, usable auth feedback and state updates. Three viewport sizes have no horizontal overflow or focus escape. |
| AC7 | PASS | 1280x720, 390x844 and 320x780; normal/reduced motion, keyboard, pending/failure/success auth, repeated filters, late responses, rejection cases and last-item removal all have executed assertions. Screenshots below are explicitly parent manual work. |
| AC8 | PASS | Exact pushed implementation/test SHAs and complete green CI independently reviewed; QA-authored assertions executed by CI. Acceptance is issued by this independent role only after the added coverage passed. |

## Screenshot Attribution And Limits

The four safe [parent-captured screenshots](ux-motion-ci-2026-10-20.md#parent-captured-screenshots)
are supporting manual evidence from the orchestrator, **not this QA role's manual
execution**. Image 03 shows a pending spinner, not successful welcome feedback.
The earlier screenshots are not claimed to show every final-CI interaction.

Only #21, #22 and #24 are accepted. No claim about live SMTP/AI, deployment,
unrelated backlog, exhaustive combinations or overall production readiness.
Port 3000 and user data were not modified by this final QA work. Issue closure
occurs after this evidence is committed and pushed; GitHub is the closure record.
