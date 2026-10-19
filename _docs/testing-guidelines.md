# Testing Guidelines

## Baseline Is Not Current Acceptance

The historical [verification record](verification.md) reports 25 unit/domain
tests, 3 separately executed HTTP scenarios and manual browser checks against
commit 6c703879a144ef2a12b2a813378a3ba45db98b46/PGlite. Preserve that evidence but
do not count it as proof of the new SQLite architecture or independent acceptance.
Read [the assignment](assignment-2026-10-20.md) and issue AC before adding tests.

## Available Baseline Commands

```sh
npm ci
npm run typecheck
npm test
npm run dev -- --port 3001
npm run test:http
npm run build
npm audit --omit=dev
```

`test:http` currently hardcodes port 3000 and requires a running server. Do not
use it on the user's preview as an isolated runner or assume its default skips
prove HTTP correctness. #19 must add/document the actual isolated command and
make missing required environment a failure. Do not document future script names
as already implemented. Use the scripts at the commit being tested.

## Required Layers

- Frontend: mockService state/reset, all typed operations, role/empty/error cases,
  preserved form input, and browser proof of no application API requests.
- Contract: parse/validate root openapi.yml, references, request/response/error
  checks; include auth, binary/multipart and action-discriminator operations.
- Repository: run one shared suite on genuine collection memory and temporary
  file-backed TypeORM SQLite adapters. SQLite :memory: is not the memory adapter.
- Domain/security: direct authorization, anonymity projection, private contact,
  guest receipt hashing/recovery, transitions, uniqueness, rollback, idempotency,
  race conditions and all meaningful failure paths.
- Real HTTP: start the actual backend on a dedicated free port, own the process,
  seed only synthetic fixtures and exercise cookies/CSRF/roles/files/exports.
- Browser: actual public/guest/registered/teacher/admin/leadership flows, keyboard
  and responsive behavior, at 1280x720, 390x844 and 320x780. Screenshots are evidence
  plus assertions, not a substitute for interaction or permission checks.
- Restart/two sessions: records, reviews, private bookmarks, guest access and
  queued jobs persist after closing/reopening file SQLite; session isolation holds.
- Workers: inspect safe local mail sink and fixture AI output. Exercise missing
  keys, malformed output, timeout, retries, competing claims and deleted subjects.
  Never label this as live SMTP delivery or actual Kazakh model-quality proof.

## Isolation And CI

Use a fresh temporary SQLite path AND upload path, controlled secrets and safe
provider transports. Never delete .local/postgres or prior uploads. Never reuse
or terminate the user's port-3000 preview. Track and terminate only owned child
processes. Readiness, tests and teardown have finite timeouts; propagate failures.

CI #19 must install Playwright/browser dependencies, start the isolated app, run
HTTP and browser suites and retain safe failure logs/traces/screenshots. Missing
TEST_URL, browser, required environment or adapter must fail required tests rather
than skip. Demonstrate negative controls for failed assertions, startup failure,
port collision and missing env. Clean owned processes/files on failure or signal.

Near final acceptance, use an isolated clean checkout/source export of the exact
pushed commit and run `npm ci` there, without reusing working-tree node_modules
or .local state. Then build, migrate/start, run HTTP/browser and restart proof.
`npm test` in an already installed working tree is not fresh-install evidence.

## Test-Discovered Bugs

Follow [process](process.md) and [QA role](team/qa-engineer.md). Actual repro ->
`user-test-bug` -> PM grooming -> QA failing regression -> engineer -> independent
retest -> QA closure. Record expected/actual status and side effects, not only a
generic thrown error. #7 requires missing/inactive catalog tests (400 or 404);
#8 requires absent authorized mutation targets to return exactly 404.

QA may add tests/cases but must not patch application code. Re-run adjacent
controls after the fix. A flaky or blocked required scenario remains visible.

## Evidence Format

Include issue, commit, date, Node/browser/OS, adapter, isolated paths (without
secret values), commands, pass/fail/skip counts, per-AC verdicts and artifact links.
Redact tokens, session cookies, guest receipt codes and personal details from
screenshots, logs and Playwright traces. Compare known dataset expectations for
reports and reopen downloaded Excel. Record dependency-audit limitations honestly.
