# Isolated verification runner (issue #19)

One documented command builds/starts the real application in a throwaway
environment and runs the live checks against it:

```sh
node scripts/verify.mts                 # phases: http, e2e, restart
node scripts/verify.mts --phase http,restart
node scripts/verify.mts --strict        # PENDING capabilities become failures
node scripts/verify.mts --keep          # keep staging dirs for debugging
VERIFY_VERBOSE=1 node scripts/verify.mts   # stream child output
```

See `scripts/verify.mts` for the implementation. CI uses the same runner in
`.github/workflows/check.yml`.

## Phases

| Phase    | What it proves                                                              |
| -------- | --------------------------------------------------------------------------- |
| `http`   | Live HTTP suite (`tests/http.test.ts`) against a real server; zero tests executed or any skipped test is a failure, never a silent pass. |
| `e2e`    | Committed Playwright browser suite (`e2e/`, `playwright.config.ts`) against a second isolated server. |
| `restart`| A guest post submitted in one server process is still readable after the process is stopped and a new one starts on the same data directory; cross-origin POST is denied (403) first. Receipt codes are never written to logs or artifacts. |

Every phase uses its **own staging directory**, so per-IP rate-limit buckets
(post 12/600s, upload 20/3600s, comment 30/60s) start empty per phase and
parallel suites cannot exhaust each other. Production limits are never
weakened; no forwarded-IP tricks are needed with this isolation.

## Isolation model (AC1/AC4)

- The application runs from a **staging copy** under the repository's
  gitignored `.local/verify/` directory: only `src/`, `public/`, `supabase/`,
  `package.json`, `next.config.ts`, `postcss.config.mjs`, `tsconfig.json` are
  copied. Because the app resolves its local data at `cwd/.local/...`, the
  baseline dev backend lands **inside the staging copy** — the repository's
  `.local/postgres`, prior uploads and the port-3000 preview are never read
  or written. Module resolution anchors at the repository lockfile, so the
  staging copy needs no `node_modules` of its own.
- `.env*` files are never copied. `DATABASE_URL`, `VERCEL*` and Supabase
  variables are stripped from child environments, so an accidental shell
  export cannot redirect the run at an external database or the user's
  preview.
- `APP_SECRET` is generated per run (controlled test secret); `APP_URL`
  points at the throwaway loopback origin.
- A free `127.0.0.1` port is reserved per server start (never port 3000),
  with startup retry if the port is stolen, and a hard failure on
  startup refusal.
- Only runner-spawned children are tracked and terminated (SIGTERM, grace,
  SIGKILL); only runner-created staging directories under `.local/verify/`
  are removed. Teardown runs on success, failure and SIGINT/SIGTERM/SIGHUP.

## Adapter contract (AC6)

`MAXBALL_ADAPTER` selects the backend under test:

- `dev-pglite` (default): the current baseline dev backend, isolated via the
  staging copy.
- `memory`: the genuine in-memory repository from issue #9.
- `sqlite`: the TypeORM/better-sqlite3 backend from issue #10; requires
  `MAXBALL_SQLITE_PATH` outside the repository, and the runner refuses
  incomplete adapter configuration instead of silently falling back.

The final E2E acceptance run targets the default real SQLite mode.

## Browser phase status

`@playwright/test` is not yet a dependency (ownership transfer pending, per
the multi-agent dependency protocol). Until it transfers, the `e2e` phase
prints an explicit **PENDING** result — not a skip and not a pass — and
`--strict` (used by CI once activated) turns it into a failure. Activation:

1. Install `@playwright/test` as a devDependency (dependency slot permitting).
2. `npx playwright install chromium`.
3. Flip CI to `node scripts/verify.mts --strict`.

## Negative controls (AC7)

```sh
node scripts/verify.mts --self-test busy-port       # occupied port must fail startup
node scripts/verify.mts --self-test failing-command # exit codes propagate
node scripts/verify.mts --self-test missing-env     # incomplete adapter rejected
```

Unit coverage for the runner helpers lives in `tests/test-runner.test.ts`
(runs as part of plain `npm test`).

## Limits

- The runner does not prove fresh-install acceptance: `npm ci` in an isolated
  checkout of the pushed commit is still required near final acceptance
  (issue #18).
- Browser traces may capture DOM content of the isolated synthetic instance;
  screenshots taken by specs mask receipt codes, and codes are never asserted
  by value or logged.
