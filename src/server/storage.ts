// Storage selection (issues #9/#10/#11). The TypeORM + better-sqlite3 file
// store at .local/maxball.sqlite is the default backend; MAXBALL_ADAPTER=memory
// selects the genuine in-memory repository (process-local by design) and
// MAXBALL_SQLITE_PATH overrides the file location (outside the repository
// only, enforced by the verification runner). The historical PGlite database
// at .local/postgres is never read or written.

import path from "node:path";
import type { Store } from "./store/types";
import { MemoryStore } from "./store/memory";
import { seed } from "./seed";

export { localMode } from "./mode";

export type Adapter = "memory" | "sqlite";

export function requestedAdapter(): Adapter {
  const value = process.env.MAXBALL_ADAPTER;
  if (value === "memory") return "memory";
  return "sqlite";
}

const globals = globalThis as unknown as { maxballStore?: Promise<Store> };

/** Lazily created singleton store for the running process. */
export function store(): Promise<Store> {
  return (globals.maxballStore ??= initialize());
}

async function initialize(): Promise<Store> {
  const adapter = requestedAdapter();
  if (adapter === "sqlite") {
    const { openSqliteStore } = await import("./store/sqlite");
    // Default lives under the process working directory (.local/), which the
    // verification runner points at its isolated staging copies.
    const target = await openSqliteStore(
      process.env.MAXBALL_SQLITE_PATH ||
        path.join(process.cwd(), ".local", "maxball.sqlite"),
    );
    await seed(target);
    return target;
  }
  const memory = new MemoryStore();
  await seed(memory);
  return memory;
}

/** Test helper: a fresh store with demo fixtures, never cached. */
export async function freshStore(): Promise<Store> {
  const memory = new MemoryStore();
  await seed(memory);
  return memory;
}
