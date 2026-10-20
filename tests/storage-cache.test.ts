import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { DataSource, EntitySchema } from "typeorm";
import { openSqliteStore, SqliteStore } from "../src/server/store/sqlite";
import type { Store } from "../src/server/store/types";
import type { Context } from "../src/server/context";
import { action } from "../src/server/actions";
import { detail } from "../src/server/queries";
import { seed } from "../src/server/seed";
import { hash } from "../src/server/security";

const globals = globalThis as unknown as {
  maxballStore?: Promise<Store>; maxballStoreV2?: Promise<Store>;
};
const original = { legacy: globals.maxballStore, current: globals.maxballStoreV2 };
const connections = new Set<DataSource>();
let directory: string | undefined;
function track(store: Store) {
  connections.add((store as unknown as { root: DataSource }).root);
}
afterEach(async () => {
  globals.maxballStore = original.legacy;
  globals.maxballStoreV2 = original.current;
  for (const source of connections) if (source.isInitialized) await source.destroy();
  connections.clear();
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("replaces a v1 global cache without closing it, awaits migration, and reuses v2 across HMR", async () => {
  directory = await mkdtemp(path.join(tmpdir(), "maxball-storage-hmr-"));
  const file = path.join(directory, "v1.sqlite");
  const fixture = await openSqliteStore(file);
  await seed(fixture);
  const sessionHash = hash(randomUUID());
  await fixture.insert("sessions", {
    token_hash: sessionHash, profile_id: null, provider_session: null,
    expires_at: new Date(Date.now() + 86400_000).toISOString(),
  });
  const ctx: Context = { store: fixture, viewer: null, sessionHash, ip: randomUUID(), demo: true };
  const receipt = await action(ctx, "createPost", {
    requestId: randomUUID(), type: "issue", anonymous: true,
    title: "HMR migration fixture", body: "Synthetic saved feedback must survive schema cache rotation.",
  }) as { id: string; number: number; code: string };
  await fixture.insert("guest_grants", {
    token_hash: sessionHash, feedback_id: receipt.id,
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
  });
  await (fixture as unknown as { root: DataSource }).root.destroy();
  const raw = new Database(file);
  try {
    raw.exec("ALTER TABLE guest_grants DROP COLUMN explicit_unlock");
    raw.prepare("DELETE FROM store_migrations WHERE version = 2").run();
  } finally { raw.close(); }

  // Keep a real v1-metadata connection alive to model Next's existing global.
  const legacySource = new DataSource({
    type: "better-sqlite3", database: file, synchronize: false,
    entities: [new EntitySchema({
      name: "maxball_guest_grants", tableName: "guest_grants",
      columns: {
        token_hash: { type: "text", primary: true },
        feedback_id: { type: "text", primary: true },
        expires_at: { type: "text" },
      },
    })],
  });
  await legacySource.initialize();
  connections.add(legacySource);
  const legacyStore = new SqliteStore(legacySource);
  const legacyPromise = Promise.resolve(legacyStore);
  globals.maxballStore = legacyPromise;
  delete globals.maxballStoreV2;
  vi.stubEnv("MAXBALL_ADAPTER", "sqlite");
  vi.stubEnv("MAXBALL_SQLITE_PATH", file);
  vi.resetModules();
  const module = await import("../src/server/storage");
  const pending = module.store();
  expect(module.store()).toBe(pending);
  const current = await pending;
  track(current);
  expect(current).not.toBe(legacyStore);
  expect(globals.maxballStore).toBe(legacyPromise);
  expect(legacySource.isInitialized).toBe(true);
  expect(await legacyStore.all("guest_grants")).toHaveLength(1);
  ctx.store = current;
  expect((await detail(ctx, receipt.id)).post.canEdit).toBe(false);
  await action(ctx, "unlockPost", { number: receipt.number, code: receipt.code });
  expect((await detail(ctx, receipt.id)).post.canEdit).toBe(true);
  expect((await current.get("feedback", receipt.id))?.title).toBe("HMR migration fixture");

  vi.resetModules();
  const reloaded = await import("../src/server/storage");
  expect(reloaded.store()).toBe(pending);
  expect(await reloaded.store()).toBe(current);
  expect((await detail(ctx, receipt.id)).post.canEdit).toBe(true);
});
