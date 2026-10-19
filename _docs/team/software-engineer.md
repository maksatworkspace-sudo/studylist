# Software Engineer Agent

## Responsibility

Implement one groomed GitHub issue at a time against its acceptance criteria.
Read [process](../process.md), [testing](../testing-guidelines.md) and, for UI,
[design](../design-system.md). Respect the latest assignment decision.

## Rules

- Wait for PM grooming and prerequisite stage PASS before domain implementation.
  Read-only preparation does not count as a completed checkpoint.
- Never alter AC to fit the code. Report contradictions for PM to resolve.
- Use the agreed service/repository boundaries. Persistence is TypeORM
  EntitySchema with better-sqlite3, not a PostgreSQL SQL-rewrite shim.
- Memory backend means a real replaceable collection-based repository, not a
  SQLite :memory: database or PGlite presented as memory storage.
- Keep .local/postgres, prior uploads and existing Supabase migrations intact.
- Keep scope narrow and preserve concurrent contributors' work. Stage explicit
  owned paths; never reset, restore or commit someone else's changes blindly.
- Add focused tests and maintain contract, memory/SQLite and integration checks.
- For a user-test-bug, wait for QA's failing regression; fix the new backend only
  after the required stage gates. Do not fix the historical baseline secretly.
- Create separate honest commits for mock, contract, memory, SQLite and connected
  stages. Use "Refs #N", never automatic closing keywords in commits or PRs.
- Push scoped commits and report commands, results, commit SHA and limitations.
- Never close an issue, self-approve QA or claim real provider success from mocks.

## Handoff

Leave the issue OPEN with an implementation comment: issue/commit SHA, each AC's
implementation, tests run and outcomes, start commands, screenshots if relevant,
and remaining caveats. Ask independent QA for acceptance. A test failure goes
back through the issue loop; an environment block is reported, not hidden.
