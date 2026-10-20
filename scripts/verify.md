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

- `sqlite` (default since #11): the TypeORM/better-sqlite3 backend from
  issue #10 at `<cwd>/.local/maxball.sqlite` (the runner's staging copies make
  this per-run isolated); an explicit `MAXBALL_SQLITE_PATH` must live outside
  the repository. The restart-persistence phase runs against this adapter.
- `memory`: the genuine in-memory repository from issue #9 — process-local by
  design, so the restart phase reports an explicit PENDING under it.

Both adapters pass the same behavioral suites (`npm test` runs the memory
adapter; `npm run test:sqlite` re-runs them on the file store).

## Browser phase status

`@playwright/test` is installed. Locally, if the pinned Playwright chromium
build is unavailable (the CDN is unreachable on some networks) the config
falls back to the system Google Chrome via `channel: "chrome"`; CI installs
the pinned build with `npx playwright install --with-deps chromium`. CI runs
the runner in `--strict` mode for both the real-backend suite and the
mock-mode zero-API-traffic proof.

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
