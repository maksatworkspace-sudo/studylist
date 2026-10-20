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

Start/restart a server using the upgraded code to initialize migration v2 and
new ORM metadata. Development hot reload can retain an older global store;
missing proof fails closed, but a full restart is needed for unlock to work
through the upgraded entity metadata. Do not continue serving requests from
old-code processes. A new preview on another port does not patch an old process.
The coordinating agent owns preview lifecycle; this change does not stop or
modify the user's port-3000 process or database. No deployment is performed.

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

These are engineering regression tests, not independent QA approval. Issue #22
stays open until QA executes its own acceptance against the pushed commit.
