// Storage selection (issues #9/#10). The genuine in-memory repository is the
// current default backend; the TypeORM + better-sqlite3 file adapter is
// selected with MAXBALL_ADAPTER=sqlite (+ MAXBALL_SQLITE_PATH, which must
// live outside the repository). The historical PGlite database at
// .local/postgres is no longer read or written.

import type { Store } from "./store/types";
import { MemoryStore } from "./store/memory";
import { seed } from "./seed";

export { localMode } from "./mode";

export type Adapter = "memory" | "sqlite";

export function requestedAdapter(): Adapter {
  const value = process.env.MAXBALL_ADAPTER;
  if (value === "sqlite") return "sqlite";
  return "memory";
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
    const target = await openSqliteStore();
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
