# Guest Grant Security Upgrade

Issue: [#22](https://github.com/maksatworkspace-sudo/studylist/issues/22).

## Decision

Earlier releases saved indistinguishable temporary grants both on guest
submission/recovery and after actual receipt-code entry. Removing automatic
grant creation alone did not invalidate already persisted authorization.

The private `guest_grants.explicit_unlock` boolean is now required by both
mutation authorization (`owns`) and feed/detail projection. Only successful
server-side `unlockPost(number, code)` sets it to true. Missing, null or false
proof never authorizes access, even for an unexpired legacy-shaped row inserted
after initialization. The flag is not accepted from a client or exposed in DTOs.
Memory uses the same fail-closed check. Mock grants are fresh, process-local and
only created by explicit unlock; they cannot import historical SQLite rows.

## Migration And Data Safety

SQLite migration v2 adds `explicit_unlock INTEGER NOT NULL DEFAULT 0`, then
records version 2 within the same transaction. Original v1 column definitions
are frozen separately from current ORM metadata, so fresh databases execute v1
then v2 once, without duplicate columns. Reopening an upgraded database never
reinitializes existing proof flags or revokes newly earned code grants.

All old grants, including old genuine code unlocks, require a fresh receipt-code
entry because their provenance cannot be established. Their original receipt
codes remain valid. Accounts, sessions, feedback, private code hashes, attachment
records, uploaded files and every other table remain unchanged. Recovery still
rotates the code and revokes every grant; it does not grant access automatically.

## Running Processes

The global cache key is versioned as `maxballStoreV2`. Development hot reload
does not reuse the previous `maxballStore` promise with v1 TypeORM metadata.
The new initializer runs migration v2 before resolving the store to any new
request, and subsequent HMR evaluations reuse the same v2 promise. It does not
close the old connection or interrupt in-flight requests. The SQLite file and
all business records remain in place. A fresh process follows normal startup.

A non-HMR process still running old source must be restarted during rollout;
starting another preview does not patch it. The coordinating agent owns preview
lifecycle and current-preview validation. This change does not terminate the
user's port-3000 process or manually open/mutate its database. No deployment is
performed; the running app initializes its migration on its next store request.

Do not roll back by deleting migration markers or restoring legacy permissions.
The schema downgrade in the regression fixture runs only on temporary test
databases to reproduce a genuine v1 physical schema, never on application data.

## Verification

`tests/legacy-grants.test.ts` checks fresh v1/v2 initialization, a physical v1
database containing both legacy grant rows, denial after migration, preservation
of all other tables and a synthetic file, original-code unlock, and two further
reopens retaining the new explicit grant. Independent QA additionally injects a
legacy-shaped row through each adapter after initialization and checks denial
until explicit unlock in `tests/qa-ownership.test.ts`.

`tests/storage-cache.test.ts` holds a real three-column v1 TypeORM connection
in the old global cache, then loads the current initializer. It proves that the
old connection remains open, v2 migration finishes before unlock, stored posts
survive, and another HMR module evaluation reuses the new promise and grant.

These are engineering regression tests, not independent QA approval. Issue #22
stays open until QA executes its own acceptance against the pushed commit.
