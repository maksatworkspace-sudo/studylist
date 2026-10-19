<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## MAXBALL Working Rules

- Read [_docs/process.md](_docs/process.md) before implementation. GitHub issues
  are the canonical backlog; [_docs/tasks.md](_docs/tasks.md) is links only.
- Read the latest [_docs/assignment-2026-10-20.md](_docs/assignment-2026-10-20.md),
  [_docs/plan.md](_docs/plan.md) and the exact groomed issue. New storage decision
  supersedes the older PostgreSQL/Vercel target; do not claim it is implemented.
- Roles: [PM](_docs/team/pm.md), [engineer](_docs/team/software-engineer.md),
  [independent QA](_docs/team/qa-engineer.md). Engineer never closes issues;
  independent QA closes only after its PASS and committed/pushed evidence.
- Work in separate honest mock -> OpenAPI -> memory -> SQLite -> integration
  checkpoints. Wait for predecessor PASS. No invented earlier process history.
- Use TypeORM EntitySchema + better-sqlite3; a true memory repository is required.
  No SQL rewrite shim. Never erase .local/postgres, old uploads or synced sources/.
- No deployment now. Never commit keys, databases, personal owner details or
  private reference-account screenshots. Stage only owned paths in shared work.
- For UI read [_docs/design-system.md](_docs/design-system.md); before tests read
  [_docs/testing-guidelines.md](_docs/testing-guidelines.md). Bugs follow actual
  repro -> user-test-bug -> PM grooming -> QA cases -> engineer -> independent QA.

## Available Commands

- `npm ci`: install pinned dependencies (use an isolated source copy for final proof).
- `npm run dev -- --port 3001`: start a separate local preview if 3000 is occupied.
- `npm run typecheck`, `npm test`, `npm run build`: current baseline checks.
- `npm run test:http`: current live tests hardcode 3000; not an isolated runner.
- `npm audit --omit=dev`: dependency audit, report limitations honestly.

Future contract/isolated browser runner commands must be documented when actually
implemented in #6/#19. Required test environment missing must FAIL, not skip.
