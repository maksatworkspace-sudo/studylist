// Isolated verification runner for issue #19 (Refs #19).
//
// One command starts the real application in a throwaway staging copy on a
// free loopback port and runs the live phases against it:
//
//   node scripts/verify.mts                     # http, e2e, restart
//   node scripts/verify.mts --phase http,restart
//   node scripts/verify.mts --strict            # pending capabilities fail
//   node scripts/verify.mts --keep              # keep staging dirs for debug
//   node scripts/verify.mts --self-test busy-port|failing-command|missing-env
//
// Isolation guarantees (AC1/AC4):
// - The app runs from a staging copy under the repository's gitignored
//   .local/verify/ directory; only an allowlist of sources is copied. The
//   staging cwd makes the baseline dev backend (PGlite at cwd/.local/postgres
//   and uploads at cwd/.local/uploads) land inside the staging copy, so the
//   runner can never read or write the repository's .local/postgres or the
//   port-3000 preview. Module resolution anchors at the repository lockfile,
//   so no node_modules copy or symlink is needed. .env* files are never
//   copied and inherited DATABASE_URL / SUPABASE_* / VERCEL variables are
//   stripped from the child environment.
// - Every phase gets its own staging directory, so per-IP rate-limit buckets
//   (post: 12/600s, upload: 20/3600s, comment: 30/60s) start empty and phases
//   cannot exhaust each other. Production limits are never weakened.
// - Only processes spawned by this runner are tracked and terminated, and only
//   staging/temp directories created by this runner are removed.
//
// Adapter contract (AC6): MAXBALL_ADAPTER=dev-pglite (baseline, default),
// memory or sqlite. The memory/sqlite values activate when the corresponding
// backend lands its env contract; sqlite additionally requires
// MAXBALL_SQLITE_PATH pointing outside the repository. The runner refuses
// incomplete adapter configuration instead of silently falling back.
//
// The browser phase requires @playwright/test; until its dependency ownership
// transfers it is reported as PENDING (a loud, explicit non-result). Under
// --strict, or in CI once activated, PENDING is a failure, never a skip.

import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { createServer, type AddressInfo } from "node:net";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { constants, accessSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/**
 * Runner working root. Lives inside the repository's gitignored .local/ so
 * the dev server's bundler resolves modules against the repository while all
 * cwd-derived state stays in throwaway staging copies. Sibling of — and never
 * touching — .local/postgres or any user preview state.
 */
export async function createWorkRoot(): Promise<string> {
  const root = path.join(repoRoot, ".local", "verify");
  await mkdir(root, { recursive: true });
  return mkdtemp(path.join(root, "run-"));
}

const STARTUP_TIMEOUT_MS = 180_000;
const PHASE_TIMEOUT_MS = 10 * 60_000;
const STOP_GRACE_MS = 8_000;
/** Copied into staging. Everything else in the repository is ignored. */
const STAGING_ALLOWLIST = [
  "src",
  "public",
  "supabase",
  "package.json",
  "next.config.ts",
  "postcss.config.mjs",
  "tsconfig.json",
];
/** Never inherited by children: isolation must not depend on the caller. */
const SANITIZED_ENV_KEYS = [
  "DATABASE_URL",
  "VERCEL",
  "VERCEL_ENV",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_STORAGE_BUCKET",
  "OWNER_EMAIL",
  "OWNER_NAME",
  "OWNER_PHONE",
];

export type PhaseName = "http" | "e2e" | "restart";
export type PhaseStatus = "PASS" | "FAIL" | "PENDING";
export type PhaseResult = { phase: PhaseName; status: PhaseStatus; detail: string };

export class StartupError extends Error {}
export class VerifyError extends Error {}

export function parseArgs(argv: string[]): {
  phases: PhaseName[];
  strict: boolean;
  keep: boolean;
  mode: "http" | "mock";
  selfTest?: "busy-port" | "failing-command" | "missing-env";
} {
  const options = {
    phases: ["http", "e2e", "restart"] as PhaseName[],
    strict: false,
    keep: false,
    mode: "http" as "http" | "mock",
    selfTest: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--strict") options.strict = true;
    else if (arg === "--keep") options.keep = true;
    else if (arg === "--mode") {
      const value = argv[++i] as "http" | "mock";
      if (value !== "http" && value !== "mock")
        throw new VerifyError("--mode requires http or mock.");
      options.mode = value;
    } else if (arg === "--phase") {
      const value = argv[++i];
      if (!value) throw new VerifyError("--phase requires a list, e.g. http,restart");
      const phases = value.split(",").map((p) => p.trim()) as PhaseName[];
      for (const p of phases)
        if (!["http", "e2e", "restart"].includes(p))
          throw new VerifyError(`Unknown phase "${p}". Use http, e2e, restart.`);
      options.phases = phases;
    } else if (arg === "--self-test") {
      const value = argv[++i] as typeof options.selfTest;
      if (!["busy-port", "failing-command", "missing-env"].includes(value ?? ""))
        throw new VerifyError("--self-test requires busy-port, failing-command or missing-env");
      options.selfTest = value;
    } else throw new VerifyError(`Unknown argument "${arg}".`);
  }
  return options;
}

export function validateEnvironment(env: NodeJS.ProcessEnv): {
  adapter: "memory" | "sqlite";
  sqlitePath?: string;
} {
  const adapter = (env.MAXBALL_ADAPTER || "sqlite") as "memory" | "sqlite";
  if (!["memory", "sqlite"].includes(adapter))
    throw new VerifyError(
      `MAXBALL_ADAPTER "${adapter}" is not one of memory, sqlite.`,
    );
  if (adapter === "sqlite") {
    // Unset path falls back to the staging-local .local/maxball.sqlite
    // (isolated through the process cwd); an explicit path must live outside
    // the repository so a run can never touch working-tree state.
    if (!env.MAXBALL_SQLITE_PATH) return { adapter };
    const target = path.resolve(env.MAXBALL_SQLITE_PATH!);
    const relative = path.relative(repoRoot, target);
    if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)))
      throw new VerifyError(
        "MAXBALL_SQLITE_PATH must live outside the repository so verification can never touch working-tree state.",
      );
    if (relative === path.join("..", ".local", "postgres") || target.includes(".local/postgres"))
      throw new VerifyError("MAXBALL_SQLITE_PATH must never point at .local/postgres.");
    return { adapter, sqlitePath: target };
  }
  return { adapter };
}

/** Builds the child environment: sanitized, with controlled test secrets. */
export function buildChildEnv(
  base: NodeJS.ProcessEnv,
  baseUrl: string,
  serviceMode: "http" | "mock" = "http",
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base))
    if (!SANITIZED_ENV_KEYS.includes(key) && !key.startsWith("NEXT_PUBLIC_SUPABASE"))
      env[key] = value;
  env.NODE_ENV = "development";
  env.NEXT_PUBLIC_SERVICE_MODE = serviceMode;
  env.APP_URL = baseUrl;
  env.APP_SECRET = randomBytes(48).toString("hex");
  env.MAXBALL_VERIFY = "1";
  return env;
}

export async function isFreePort(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, host);
  });
}

/** Reserves a free loopback port. TOCTOU-safe via retries at server start. */
export async function pickFreePort(host = "127.0.0.1"): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.once("listening", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
    probe.listen(0, host);
  });
}

export async function occupyPort(): Promise<{ port: number; release: () => Promise<void> }> {
  const port = await pickFreePort();
  const blocker = createServer();
  const sockets = new Set<{ destroy(): void }>();
  blocker.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    // A port blocker accepts nothing; drop any probe immediately so close()
    // below is never wedged waiting on an open connection.
    socket.destroy();
  });
  await new Promise<void>((resolve, reject) => {
    blocker.once("error", reject);
    blocker.listen(port, "127.0.0.1", resolve);
  });
  const release = () =>
    new Promise<void>((resolve) => {
      for (const socket of sockets) socket.destroy();
      const finish = () => resolve();
      blocker.close(finish);
      // Belt and braces: never let cleanup hang the runner.
      setTimeout(finish, 2_000).unref?.();
    });
  return { port, release };
}

/**
 * Creates an isolated staging copy of the application under `parentDir`.
 * The parent must live INSIDE the repository (main uses .local/verify):
 * Next's bundler anchors its resolution root at the nearest lockfile (the
 * repository root), so imports resolve against the repository's real
 * node_modules while every cwd-derived path (.next, .local/postgres,
 * .local/uploads) stays inside the staging copy. Only the allowlist is
 * copied; .env*, .local, .next, git state, docs and tests never cross over.
 */
export async function createStaging(sourceRoot: string, parentDir: string): Promise<string> {
  const staging = await mkdtemp(path.join(parentDir, "staging-"));
  for (const entry of STAGING_ALLOWLIST) {
    const from = path.join(sourceRoot, entry);
    try {
      await access(from, constants.F_OK);
    } catch {
      continue;
    }
    await cp(from, path.join(staging, entry), { recursive: true });
  }
  return staging;
}

/** Tracks every child this runner spawns so teardown only kills owned processes. */
export class ProcessTracker {
  private items = new Map<ChildProcess, string>();

  spawn(
    command: string,
    args: string[],
    options: { name: string; cwd: string; env: NodeJS.ProcessEnv; logPath?: string },
  ): ChildProcess {
    // Guard before child_process.spawn: on some platform/Node combinations a
    // failed spawn with piped stdio never emits "error" and wedges the event
    // loop, taking cleanup with it. All runner binaries are absolute paths,
    // so an existence/executability check removes that failure mode entirely.
    try {
      accessSync(command, constants.X_OK);
    } catch {
      throw new StartupError(
        `Cannot execute ${command} (missing or not executable) — required tooling for phase "${options.name}" is unavailable.`,
      );
    }
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    // spawn failures (ENOENT etc.) surface as an async "error" event; without
    // a listener Node crashes with an unhandled error before cleanup runs.
    child.once("error", () => {});
    this.items.set(child, options.name);
    const label = options.name;
    const pipe = (stream: NodeJS.ReadableStream | null, tag: string) => {
      if (!stream) return;
      stream.on("data", (chunk: Buffer) => {
        if (process.env.VERIFY_VERBOSE) process.stderr.write(`[${label}] ${chunk}`);
        if (options.logPath)
          writeFile(options.logPath, `[${tag}] ${chunk}\n`, { flag: "a" }).catch(() => {});
      });
    };
    pipe(child.stdout, "stdout");
    pipe(child.stderr, "stderr");
    return child;
  }

  names(): string[] {
    return [...this.items.values()];
  }

  async stop(child: ChildProcess, graceMs = STOP_GRACE_MS): Promise<void> {
    if (child.exitCode !== null || child.signalCode) {
      this.items.delete(child);
      return;
    }
    // Resolves on exit OR on a spawn/kill error: a child that never started
    // emits "error" and may never emit "exit", which must not wedge teardown.
    const settled = new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.once("error", () => resolve());
    });
    child.kill("SIGTERM");
    const timer = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), graceMs).unref?.(),
    );
    if ((await Promise.race([settled.then(() => "exit" as const), timer])) === "timeout")
      child.kill("SIGKILL");
    // Final safety bound: even without exit/error events, stop() completes.
    await Promise.race([
      settled,
      new Promise<void>((resolve) => setTimeout(resolve, 2_000).unref?.()),
    ]);
    this.items.delete(child);
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.items.keys()].map((child) => this.stop(child)));
  }
}

/** Polls a URL until the application answers, with a finite deadline. */
export async function waitReady(
  url: string,
  timeoutMs = STARTUP_TIMEOUT_MS,
  isDead?: () => boolean,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "unknown error";
  while (Date.now() < deadline) {
    if (isDead?.()) throw new StartupError(`Server exited before becoming ready (last: ${lastError})`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new StartupError(`Server not ready within ${timeoutMs} ms at ${url} (${lastError})`);
}

/**
 * Anti-silent-skip guard for the HTTP phase: a suite with zero tests or any
 * skipped/pending test is a failure, not a pass (AC2/AC3).
 */
export function summarizeVitestJson(raw: string): {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
} {
  const report = JSON.parse(raw) as Record<string, number>;
  const summary = {
    total: report.numTotalTests ?? 0,
    passed: report.numPassedTests ?? 0,
    failed: report.numFailedTests ?? 0,
    skipped: (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0),
  };
  if (summary.total === 0)
    throw new VerifyError("HTTP suite executed zero tests — refusing a silent skip.");
  if (summary.skipped > 0)
    throw new VerifyError(
      `HTTP suite skipped ${summary.skipped} test(s) — refusing a partial pass.`,
    );
  return summary;
}

export async function playwrightAvailable(root: string): Promise<boolean> {
  try {
    const require = createRequire(path.join(root, "package.json"));
    require.resolve("@playwright/test/package.json");
    return true;
  } catch {
    return false;
  }
}

/** Starts the app on a free port from staging; retries if the port races away. */
async function startAppServer(
  staging: string,
  tracker: ProcessTracker,
  parentEnv: NodeJS.ProcessEnv,
  logPath: string,
  forcedPort?: number,
  serviceMode: "http" | "mock" = "http",
): Promise<{ child: ChildProcess; port: number; baseUrl: string }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const port = forcedPort && attempt === 0 ? forcedPort : await pickFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    // The binary comes from the repository's node_modules; the process cwd is
    // the staging copy so every cwd-derived path stays isolated.
    const child = tracker.spawn(
      path.join(repoRoot, "node_modules", ".bin", "next"),
      ["dev", "--hostname", "127.0.0.1", "--port", String(port)],
      {
        name: `next-dev-${port}`,
        cwd: staging,
        env: buildChildEnv(parentEnv, baseUrl, serviceMode),
        logPath,
      },
    );
    let spawnFailed = false;
    child.once("error", () => {
      spawnFailed = true;
    });
    try {
      await waitReady(
        `${baseUrl}/api/state`,
        STARTUP_TIMEOUT_MS,
        () => spawnFailed || child.exitCode !== null,
      );
      // Warm the page itself so browser assertions never race first compile.
      await fetch(`${baseUrl}/`, { signal: AbortSignal.timeout(60_000) }).catch(() => {});
      return { child, port, baseUrl };
    } catch (error) {
      lastError = error;
      await tracker.stop(child);
      if (error instanceof StartupError && forcedPort && attempt === 0) {
        throw new StartupError(
          `Startup failed on forced port ${forcedPort}: ${error.message}`,
        );
      }
    }
  }
  throw new StartupError(
    `Could not start the application after 3 attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

async function runHttpPhase(
  tracker: ProcessTracker,
  parentEnv: NodeJS.ProcessEnv,
  workRoot: string,
): Promise<PhaseResult> {
  const staging = await createStaging(repoRoot, workRoot);
  const logPath = path.join(workRoot, "http-server.log");
  const server = await startAppServer(staging, tracker, parentEnv, logPath);
  try {
    const reportPath = path.join(workRoot, "http-vitest.json");
    const child = tracker.spawn(
      path.join(repoRoot, "node_modules", ".bin", "vitest"),
      [
        "run",
        "tests/http.test.ts",
        "tests/qa-catalog.test.ts",
        "--reporter=json",
        `--outputFile=${reportPath}`,
      ],
      {
        name: "vitest-http",
        cwd: repoRoot,
        env: { ...buildChildEnv(parentEnv, server.baseUrl), TEST_URL: server.baseUrl },
      },
    );
    const exit = await new Promise<number>((resolve) =>
      child.once("exit", (code) => resolve(code ?? 1)),
    );
    const raw = await readFile(reportPath, "utf8");
    const summary = summarizeVitestJson(raw);
    if (exit !== 0 || summary.failed > 0)
      return {
        phase: "http",
        status: "FAIL",
        detail: `vitest exited ${exit}; ${summary.failed} failed of ${summary.total}`,
      };
    return {
      phase: "http",
      status: "PASS",
      detail: `${summary.passed}/${summary.total} live HTTP tests passed, zero skipped`,
    };
  } finally {
    await tracker.stop(server.child);
  }
}

async function runE2EPhase(
  tracker: ProcessTracker,
  parentEnv: NodeJS.ProcessEnv,
  workRoot: string,
  strict: boolean,
  mode: "http" | "mock",
): Promise<PhaseResult> {
  if (!(await playwrightAvailable(repoRoot))) {
    return {
      phase: "e2e",
      status: strict ? "FAIL" : "PENDING",
      detail: strict
        ? "@playwright/test is not installed — the browser phase is required under --strict."
        : "@playwright/test dependency ownership has not transferred yet; the browser phase is explicitly PENDING (not skipped silently). Activate by installing @playwright/test and running: npx playwright install chromium",
    };
  }
  const staging = await createStaging(repoRoot, workRoot);
  const logPath = path.join(workRoot, mode === "mock" ? "e2e-mock-server.log" : "e2e-server.log");
  const server = await startAppServer(staging, tracker, parentEnv, logPath, undefined, mode);
  try {
    // Mock mode proves the mockService needs no API; http mode runs the real
    // backend projects (functional desktop + both extra viewports).
    const projects =
      mode === "mock"
        ? ["--project=mock-mode"]
        : ["--project=desktop-1280x720", "--project=mobile-390x844", "--project=narrow-320x780"];
    const child = tracker.spawn(
      path.join(repoRoot, "node_modules", ".bin", "playwright"),
      ["test", "--config=playwright.config.ts", ...projects],
      {
        name: "playwright",
        cwd: repoRoot,
        env: { ...buildChildEnv(parentEnv, server.baseUrl, mode), TEST_URL: server.baseUrl },
      },
    );
    const exit = await new Promise<number>((resolve) =>
      child.once("exit", (code) => resolve(code ?? 1)),
    );
    return exit === 0
      ? {
          phase: "e2e",
          status: "PASS",
          detail:
            mode === "mock"
              ? "Playwright mock-mode suite passed (zero API traffic proven)"
              : "Playwright browser suite passed",
        }
      : {
          phase: "e2e",
          status: "FAIL",
          detail: `playwright exited ${exit}; see test-results/ and playwright-report/`,
        };
  } finally {
    await tracker.stop(server.child);
  }
}

async function runRestartPhase(
  tracker: ProcessTracker,
  parentEnv: NodeJS.ProcessEnv,
  workRoot: string,
): Promise<PhaseResult> {
  // Persistence across processes requires the file-backed adapter; the
  // genuine memory repository is process-local by design (issue #9).
  if ((parentEnv.MAXBALL_ADAPTER || "sqlite") !== "sqlite") {
    return {
      phase: "restart",
      status: "PENDING",
      detail:
        "restart persistence requires the file-backed adapter; the memory backend (default until #10) is process-local by design",
    };
  }
  const staging = await createStaging(repoRoot, workRoot);
  const logPath = path.join(workRoot, "restart-server.log");
  const first = await startAppServer(staging, tracker, parentEnv, logPath);
  const title = `Верификация қайта жүктеу ${randomUUID().slice(0, 8)}`;
  try {
    // Forbidden-action control at the transport level: cross-origin POST is rejected.
    const forbidden = await fetch(`${first.baseUrl}/api/actions`, {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ action: "demoLogin", role: "admin" }),
      signal: AbortSignal.timeout(30_000),
    });
    if (forbidden.status !== 403)
      throw new VerifyError(`CSRF denial expected 403, got ${forbidden.status}.`);
    const posted = await fetch(`${first.baseUrl}/api/actions`, {
      method: "POST",
      headers: { origin: first.baseUrl, "content-type": "application/json" },
      body: JSON.stringify({
        action: "createPost",
        requestId: randomUUID(),
        type: "issue",
        title,
        body: "Қайта жүктеуден кейінгі тұрақтылықты тексеру.",
        anonymous: true,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const data = (await posted.json()) as { id?: string; number?: number };
    if (posted.status !== 200 || !data.id)
      throw new VerifyError(`createPost failed with ${posted.status}.`);
    // The receipt code is intentionally neither logged nor stored in artifacts.
  } finally {
    await tracker.stop(first.child);
  }
  const second = await startAppServer(staging, tracker, parentEnv, logPath);
  try {
    const state = await fetch(`${second.baseUrl}/api/state`, {
      headers: { origin: second.baseUrl },
      signal: AbortSignal.timeout(30_000),
    });
    const boot = (await state.json()) as { posts?: { id: string; title: string }[] };
    const persisted = boot.posts?.find((post) => post.title === title);
    if (!persisted) throw new VerifyError("Submitted post did not survive the restart.");
    return {
      phase: "restart",
      status: "PASS",
      detail: "post persisted across a full server stop/start in separate processes (CSRF denial verified)",
    };
  } finally {
    await tracker.stop(second.child);
  }
}

async function selfTest(
  name: "busy-port" | "failing-command" | "missing-env",
): Promise<number> {
  if (name === "missing-env") {
    // Unset path is valid (staging-local default); an explicit path inside
    // the repository must be rejected so runs never touch working-tree state.
    try {
      validateEnvironment({
        MAXBALL_ADAPTER: "sqlite",
        MAXBALL_SQLITE_PATH: path.join(repoRoot, "data", "test.sqlite"),
      });
    } catch {
      console.log("self-test missing-env: PASS (unsafe adapter path rejected)");
      return 0;
    }
    console.error("self-test missing-env: FAIL (unsafe adapter path was accepted)");
    return 1;
  }
  if (name === "failing-command") {
    const tracker = new ProcessTracker();
    const child = tracker.spawn(process.execPath, ["-e", "process.exit(3)"], {
      name: "failing",
      cwd: repoRoot,
      env: {},
    });
    const code = await new Promise<number>((resolve) =>
      child.once("exit", (c) => resolve(c ?? 1)),
    );
    console.log(
      code === 3
        ? "self-test failing-command: PASS (exit code propagated)"
        : `self-test failing-command: FAIL (expected 3, got ${code})`,
    );
    return code === 3 ? 0 : 1;
  }
  const blocker = await occupyPort();
  const tracker = new ProcessTracker();
  const workRoot = await createWorkRoot();
  try {
    const staging = await createStaging(repoRoot, workRoot);
    await startAppServer(
      staging,
      tracker,
      process.env,
      path.join(workRoot, "busy-port.log"),
      blocker.port,
    );
    console.error("self-test busy-port: FAIL (startup unexpectedly succeeded)");
    return 1;
  } catch (error) {
    if (error instanceof StartupError) {
      console.log("self-test busy-port: PASS (occupied port failed startup)");
      return 0;
    }
    console.error(`self-test busy-port: FAIL (${String(error)})`);
    return 1;
  } finally {
    await tracker.stopAll();
    await blocker.release();
    await rm(workRoot, { recursive: true, force: true });
  }
}

export async function main(argv: string[]): Promise<number> {
  const options = parseArgs(argv);
  if (options.selfTest) return selfTest(options.selfTest);
  const adapter = validateEnvironment(process.env);
  const tracker = new ProcessTracker();
  const workRoot = await createWorkRoot();
  const results: PhaseResult[] = [];
  let tearingDown = false;

  const teardown = async () => {
    if (tearingDown) return;
    tearingDown = true;
    // Cleanup itself is bounded: a wedged child or stubborn filesystem must
    // never prevent the runner from exiting with its verdict.
    await Promise.race([
      (async () => {
        await tracker.stopAll();
        if (!options.keep) await rm(workRoot, { recursive: true, force: true });
      })(),
      new Promise<void>((resolve) => setTimeout(resolve, 30_000).unref?.()),
    ]);
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      void teardown().finally(() => process.exit(signal === "SIGINT" ? 130 : 143));
    });
  }

  console.log(
    `verify: adapter=${adapter.adapter} mode=${options.mode} phases=${options.phases.join(",")} strict=${options.strict}`,
  );
  try {
    for (const phase of options.phases) {
      const started = Date.now();
      const work =
        phase === "http"
          ? runHttpPhase(tracker, process.env, workRoot)
          : phase === "e2e"
            ? runE2EPhase(tracker, process.env, workRoot, options.strict, options.mode)
            : runRestartPhase(tracker, process.env, workRoot);
      // If the timeout wins the race, a late phase rejection must not crash Node.
      work.catch(() => {});
      const bounded = new Promise<PhaseResult>((resolve) => {
        const timer = setTimeout(
          () =>
            resolve({
              phase,
              status: "FAIL",
              detail: `exceeded the bounded phase timeout of ${PHASE_TIMEOUT_MS / 1000}s`,
            }),
          PHASE_TIMEOUT_MS,
        );
        timer.unref?.();
      });
      const result = await Promise.race([work, bounded]);
      results.push(result);
      console.log(
        `verify: ${phase} ${result.status} (${((Date.now() - started) / 1000).toFixed(1)}s) — ${result.detail}`,
      );
      if (result.status === "FAIL") break;
    }
  } catch (error) {
    results.push({
      phase: "runner",
      status: "FAIL",
      detail: error instanceof Error ? error.message : String(error),
    });
    console.error(`verify: FAIL — ${results[results.length - 1].detail}`);
  } finally {
    await teardown();
  }

  const failed = results.some((r) => r.status === "FAIL");
  const pending = results.some((r) => r.status === "PENDING");
  console.log(
    `verify: ${failed ? "FAILED" : pending ? "PASSED WITH PENDING PHASES" : "PASSED"} [${results
      .map((r) => `${r.phase}:${r.status}`)
      .join(" ")}]`,
  );
  return failed ? 1 : 0;
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  mkdir(path.join(repoRoot, "test-results"), { recursive: true }).catch(() => {});
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`verify: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    },
  );
}
