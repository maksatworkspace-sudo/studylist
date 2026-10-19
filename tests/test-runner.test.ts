// Unit coverage for the isolated verification runner (issue #19).
// These tests exercise the runner helpers only: no dev server, no browser,
// no network beyond loopback port probes. They run as part of plain `npm test`.
import { describe, expect, it } from "vitest";
import { mkdtemp, lstat, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ProcessTracker,
  buildChildEnv,
  createStaging,
  isFreePort,
  occupyPort,
  parseArgs,
  pickFreePort,
  summarizeVitestJson,
  validateEnvironment,
} from "../scripts/verify.mts";

describe("verify runner argument parsing", () => {
  it("defaults to all phases without strict or keep", () => {
    const options = parseArgs([]);
    expect(options.phases).toEqual(["http", "e2e", "restart"]);
    expect(options.strict).toBe(false);
    expect(options.keep).toBe(false);
    expect(options.selfTest).toBeUndefined();
  });

  it("accepts an explicit phase list and flags", () => {
    const options = parseArgs(["--phase", "http,restart", "--strict", "--keep"]);
    expect(options.phases).toEqual(["http", "restart"]);
    expect(options.strict).toBe(true);
    expect(options.keep).toBe(true);
  });

  it("rejects unknown phases and arguments", () => {
    expect(() => parseArgs(["--phase", "deploy"])).toThrow(/Unknown phase/);
    expect(() => parseArgs(["--wat"])).toThrow(/Unknown argument/);
    expect(() => parseArgs(["--phase"])).toThrow(/requires a list/);
  });
});

describe("verify runner environment validation", () => {
  it("defaults to the genuine memory adapter", () => {
    expect(validateEnvironment({})).toEqual({ adapter: "memory" });
  });

  it("refuses an incomplete sqlite adapter instead of falling back", () => {
    expect(() => validateEnvironment({ MAXBALL_ADAPTER: "sqlite" })).toThrow(
      /MAXBALL_SQLITE_PATH/,
    );
  });

  it("refuses sqlite paths inside the repository or at .local/postgres", () => {
    expect(() =>
      validateEnvironment({
        MAXBALL_ADAPTER: "sqlite",
        MAXBALL_SQLITE_PATH: path.join(process.cwd(), "data", "test.sqlite"),
      }),
    ).toThrow(/outside the repository/);
    expect(() =>
      validateEnvironment({
        MAXBALL_ADAPTER: "sqlite",
        MAXBALL_SQLITE_PATH: path.join(process.cwd(), "..", ".local", "postgres", "x.sqlite"),
      }),
    ).toThrow(/\.local\/postgres/);
  });

  it("sanitizes isolation-breaking variables and injects controlled secrets", () => {
    const env = buildChildEnv(
      {
        DATABASE_URL: "postgres://user:pass@db.example/x",
        SUPABASE_SERVICE_ROLE_KEY: "secret",
        NEXT_PUBLIC_SUPABASE_URL: "https://sup.example",
        PATH: "/usr/bin",
      },
      "http://127.0.0.1:45678",
    );
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBeUndefined();
    expect(env.PATH).toBe("/usr/bin");
    expect(env.NODE_ENV).toBe("development");
    expect(env.APP_URL).toBe("http://127.0.0.1:45678");
    expect(env.APP_SECRET && env.APP_SECRET.length).toBeGreaterThanOrEqual(64);
  });
});

describe("verify runner port allocation", () => {
  it("picks a free loopback port and detects occupation", async () => {
    const blocker = await occupyPort();
    try {
      expect(await isFreePort(blocker.port)).toBe(false);
      const other = await pickFreePort();
      expect(other).toBeGreaterThan(0);
      expect(other).not.toBe(blocker.port);
      expect(await isFreePort(other)).toBe(true);
    } finally {
      await blocker.release();
    }
    expect(await isFreePort(blocker.port)).toBe(true);
  });
});

describe("verify runner staging isolation", () => {
  it("copies only the allowlist, symlinks node_modules and excludes secrets", async () => {
    const source = await mkdtemp(path.join(tmpdir(), "verify-src-"));
    const parent = await mkdtemp(path.join(tmpdir(), "verify-work-"));
    try {
      await mkdir(path.join(source, "src"), { recursive: true });
      await mkdir(path.join(source, "supabase", "migrations"), { recursive: true });
      await mkdir(path.join(source, "node_modules", ".bin"), { recursive: true });
      await mkdir(path.join(source, ".local", "postgres"), { recursive: true });
      await mkdir(path.join(source, ".next"), { recursive: true });
      await writeFile(path.join(source, "src", "index.ts"), "export {}");
      await writeFile(path.join(source, "package.json"), "{}");
      await writeFile(path.join(source, "next.config.ts"), "export {}");
      await writeFile(path.join(source, "postcss.config.mjs"), "export {}");
      await writeFile(path.join(source, "tsconfig.json"), "{}");
      await writeFile(
        path.join(source, "supabase", "migrations", "initial.sql"),
        "SELECT 1;",
      );
      await writeFile(path.join(source, ".env.local"), "SECRET=1");
      await writeFile(path.join(source, ".local", "postgres", "data"), "pg");

      const staging = await createStaging(source, parent);
      expect(await readFile(path.join(staging, "src", "index.ts"), "utf8")).toBe("export {}");
      expect(await readFile(path.join(staging, "supabase", "migrations", "initial.sql"), "utf8")).toBe(
        "SELECT 1;",
      );
      // node_modules is never copied into staging: in the real layout the
      // staging copy lives inside the repository so module resolution walks
      // up to the repository's own node_modules (see scripts/verify.mts).
      await expect(lstat(path.join(staging, "node_modules"))).rejects.toThrow();
      await expect(readFile(path.join(staging, ".env.local"), "utf8")).rejects.toThrow();
      await expect(readFile(path.join(staging, ".local", "postgres", "data"), "utf8")).rejects.toThrow();
      await expect(readFile(path.join(staging, ".next"), "utf8")).rejects.toThrow();
    } finally {
      await rm(source, { recursive: true, force: true });
      await rm(parent, { recursive: true, force: true });
    }
  });
});

describe("verify runner process ownership", () => {
  it("terminates tracked children and reports none left", async () => {
    const tracker = new ProcessTracker();
    const child = tracker.spawn(
      process.execPath,
      ["-e", "setTimeout(() => {}, 30000)"],
      { name: "sleeper", cwd: process.cwd(), env: {} },
    );
    expect(tracker.names()).toEqual(["sleeper"]);
    await tracker.stop(child, 2000);
    expect(child.exitCode !== null || child.signalCode).toBeTruthy();
    expect(tracker.names()).toEqual([]);
  });

  it("rejects a missing binary up front instead of wedging on spawn", async () => {
    const tracker = new ProcessTracker();
    // A failed spawn with piped stdio can hang the event loop on some
    // platforms, so the tracker must refuse before child_process runs.
    expect(() =>
      tracker.spawn("/nonexistent/verify-runner-binary", ["--nothing"], {
        name: "ghost",
        cwd: process.cwd(),
        env: {},
      }),
    ).toThrow(/missing or not executable/);
    expect(tracker.names()).toEqual([]);
  });
});

describe("verify runner anti-silent-skip guard", () => {
  const report = (overrides: Record<string, number>) =>
    JSON.stringify({
      numTotalTests: 3,
      numPassedTests: 3,
      numFailedTests: 0,
      numPendingTests: 0,
      numTodoTests: 0,
      ...overrides,
    });

  it("accepts a fully executed, fully passing suite", () => {
    expect(summarizeVitestJson(report({}))).toEqual({
      total: 3,
      passed: 3,
      failed: 0,
      skipped: 0,
    });
  });

  it("rejects a suite that executed zero tests", () => {
    expect(() =>
      summarizeVitestJson(report({ numTotalTests: 0, numPassedTests: 0 })),
    ).toThrow(/zero tests/);
  });

  it("rejects a suite with skipped or todo tests", () => {
    expect(() => summarizeVitestJson(report({ numPendingTests: 1, numPassedTests: 2 }))).toThrow(
      /skipped 1/,
    );
    expect(() => summarizeVitestJson(report({ numTodoTests: 2, numPassedTests: 1 }))).toThrow(
      /skipped 2/,
    );
  });

  it("surfaces failures without throwing so exit codes decide", () => {
    expect(summarizeVitestJson(report({ numFailedTests: 1, numPassedTests: 2 })).failed).toBe(1);
  });
});
