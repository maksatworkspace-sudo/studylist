// Storage selection (issues #9/#10). The genuine in-memory repository is the
// default backend for local/demo runs; the TypeORM + better-sqlite3 file
// adapter (issue #10) registers itself here once available via
// MAXBALL_ADAPTER=sqlite and MAXBALL_SQLITE_PATH. The historical PGlite
// database at .local/postgres is no longer read or written.

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
    // The TypeORM + better-sqlite3 adapter lands with issue #10; until then
    // requesting it is an explicit, loud failure rather than a fallback.
    throw new Error(
      "MAXBALL_ADAPTER=sqlite is not available yet (issue #10 delivers the TypeORM/better-sqlite3 store).",
    );
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
