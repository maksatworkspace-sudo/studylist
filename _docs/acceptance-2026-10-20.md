# Final Acceptance Record — 2026-10-20

Assignment: staged rebuild per `_docs/assignment-2026-10-20.md` and the
GitHub issue workflow (#4 → #5 → #6 → #9 → #10 → #11 → #12–#16, #19, #7/#8,
#17, #18).

## Stage commits (honest, one per checkpoint)

| Stage | Commit | Issue |
| --- | --- | --- |
| Process/roles baseline | 87867f0 | #4 |
| Replaceable mockService | 1fb0cef | #5 |
| OpenAPI contract + tests | a05dcdb | #6 |
| True in-memory repository | 8eba624 + 8094916 | #9 |
| TypeORM EntitySchema + better-sqlite3 | 84b9acd | #10 |
| Connected SQLite default | 2b99226 | #11 |
| Verification runner + strict CI | c8bd778 + 606e8d6 | #19 |
| user-test-bug fixes (RED→GREEN) | d4f8235 | #7, #8 |
| Coverage extensions | e4146ee | #12–#16 |

## Fresh-install acceptance (near-final proof)

Clean `git archive` export of HEAD into an empty directory, no working-tree
node_modules/.local state, 2026-10-20:

- `npm ci` → success
- `npm run typecheck` → clean
- `npm test` → 60 passed / 0 failed (memory adapter)
- `npm run test:sqlite` → 34 passed / 0 failed (file adapter)
- `npm run build` → success
- `node scripts/verify.mts --strict` → http PASS (20/20 live incl. the 17
  QA catalog regressions), e2e PASS (15 browser tests), restart PASS
  (cross-process persistence + CSRF denial), mock-mode browser proof PASS
  (zero API traffic). Negative controls: busy-port / failing-command /
  unsafe-path all PASS.

## Coverage snapshot

- Unit/domain/store: 60 memory + 34 sqlite behavioral parity tests.
- Contract: 11 openapi.yml structural/parity tests.
- Runner infrastructure: 15 unit tests.
- Live HTTP: 3 workflow scenarios + 17 independent QA regressions.
- Browser: 16 scenarios (guest flows incl. share, roles/privacy/denials,
  responsive 1280×720 / 390×844 / 320×780, mock zero-traffic).

## Honest limitations

- Live email/AI providers and publication remain gated by issues #1/#2
  (never claimed; local transports are inspectable and deterministic).
- Historical PGlite evidence (`verification.md`) predates the staged rebuild
  and is preserved as history only.
- Supabase auth/storage code paths remain for a future production decision;
  the default local stack is SQLite via TypeORM.
