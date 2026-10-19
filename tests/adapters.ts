// Dual-adapter harness (Refs #9/#10): the same behavioral suites run against
// the genuine memory repository and the TypeORM/better-sqlite3 file store.
// TEST_ADAPTER=sqlite selects the file adapter (a fresh temp database per run).
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Store } from "../src/server/store/types";

export async function makeStore(): Promise<Store> {
  if (process.env.TEST_ADAPTER === "sqlite") {
    const { openSqliteStore } = await import("../src/server/store/sqlite");
    const dir = await mkdtemp(path.join(tmpdir(), "maxball-sqlite-test-"));
    return openSqliteStore(path.join(dir, "test.sqlite"));
  }
  const { MemoryStore } = await import("../src/server/store/memory");
  return new MemoryStore();
}
export const adapterName = () => process.env.TEST_ADAPTER || "memory";
