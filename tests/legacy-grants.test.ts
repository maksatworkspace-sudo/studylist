import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { DataSource } from "typeorm";
import { openSqliteStore, type SqliteStore } from "../src/server/store/sqlite";
import { seed } from "../src/server/seed";
import { action } from "../src/server/actions";
import { owns, type Context } from "../src/server/context";
import { detail } from "../src/server/queries";
import { hash } from "../src/server/security";
import { primaryKeys, type Row, type Table } from "../src/server/store/types";

const stores = new Set<SqliteStore>();
const directories: string[] = [];
async function open(file: string) {
  const store = await openSqliteStore(file);
  stores.add(store);
  return store;
}
async function close(store: SqliteStore) {
  // Fixture lifecycle only: Store has no public connection-management API.
  await (store as unknown as { root: DataSource }).root.destroy();
  stores.delete(store);
}
afterEach(async () => {
  for (const store of stores) await close(store);
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function location() {
  const directory = await mkdtemp(path.join(tmpdir(), "maxball-legacy-grants-"));
  directories.push(directory);
  return { directory, file: path.join(directory, "legacy.sqlite") };
}
async function context(store: SqliteStore): Promise<Context> {
  const sessionHash = hash(randomUUID());
  await store.insert("sessions", {
    token_hash: sessionHash, profile_id: null, provider_session: null,
    expires_at: new Date(Date.now() + 86400_000).toISOString(),
  });
  return { store, viewer: null, sessionHash, ip: randomUUID(), demo: true };
}

describe("#22 legacy guest grant security migration", () => {
  it("tracks v1 and v2 exactly once on a fresh database, adding the proof column only once", async () => {
    const { file } = await location();
    const store = await open(file);
    await close(store);
    const raw = new Database(file);
    try {
      expect(raw.prepare("SELECT version FROM store_migrations ORDER BY version").all())
        .toEqual([{ version: 1 }, { version: 2 }]);
      expect(raw.prepare("PRAGMA table_info(guest_grants)").all().map((row) =>
        (row as { name: string }).name)).toEqual(["token_hash", "feedback_id", "expires_at", "explicit_unlock"]);
    } finally { raw.close(); }
    await close(await open(file));
    const check = new Database(file);
    try {
      expect(check.prepare("SELECT COUNT(*) AS total FROM store_migrations").get()).toEqual({ total: 2 });
    } finally { check.close(); }
  });

  it("invalidates v1 auto/explicit grants, preserving records, files, codes and later unlocks", async () => {
    const { file, directory } = await location();
    let store = await open(file);
    await seed(store);
    const creator = await context(store);
    const other = await context(store);
    const receipt = await action(creator, "createPost", {
      requestId: randomUUID(), type: "issue", anonymous: true,
      title: "Legacy grant fixture", body: "Synthetic receipt retained across the security migration.",
    }) as { id: string; number: number; code: string };
    // Historical auto and explicit grants were indistinguishable in v1.
    for (const ctx of [creator, other])
      await store.insert("guest_grants", {
        token_hash: ctx.sessionHash, feedback_id: receipt.id,
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      });
    const fileId = randomUUID();
    const objectPath = path.join(directory, "retained-fixture.txt");
    await writeFile(objectPath, "Synthetic private attachment content.");
    await store.insert("attachments", {
      id: fileId, feedback_id: receipt.id, token_hash: creator.sessionHash,
      name: "fixture.txt", size: 37, mime: "text/plain", object_path: objectPath,
      ready: true, created_at: new Date().toISOString(),
    });
    const preserved = (Object.keys(primaryKeys) as Table[]).filter((table) => table !== "guest_grants");
    const snapshots = new Map<Table, Row[]>();
    for (const table of preserved) snapshots.set(table, await store.all(table));
    expect(await owns(creator, receipt.id)).toBe(false);
    await close(store);
    // Recreate the actual three-column v1 schema on a disposable fixture only.
    // No migration code gets to generate or silently repair this old shape.
    const legacy = new Database(file);
    try {
      legacy.exec("ALTER TABLE guest_grants DROP COLUMN explicit_unlock");
      legacy.prepare("DELETE FROM store_migrations WHERE version = 2").run();
    }
    finally { legacy.close(); }

    store = await open(file);
    creator.store = store;
    other.store = store;
    expect(await store.all("guest_grants")).toHaveLength(2);
    expect((await store.all("guest_grants")).every((grant) => grant.explicit_unlock === false)).toBe(true);
    for (const table of preserved) expect(await store.all(table)).toEqual(snapshots.get(table));
    expect(await readFile(objectPath, "utf8")).toBe("Synthetic private attachment content.");
    expect(await owns(creator, receipt.id)).toBe(false);
    expect((await detail(creator, receipt.id)).post).toMatchObject({
      isOwner: false, isAccountOwner: false, canEdit: false,
    });
    await expect(action(creator, "editPost", {
      id: receipt.id, title: "Denied legacy edit", body: "Legacy auto grant must no longer authorize edits.",
    })).rejects.toMatchObject({ status: 403 });
    await action(creator, "unlockPost", { number: receipt.number, code: receipt.code });
    expect(await owns(creator, receipt.id)).toBe(true);
    expect(await owns(other, receipt.id)).toBe(false);
    const explicit = await store.all("guest_grants");
    expect(explicit.find((grant) => grant.token_hash === creator.sessionHash)?.explicit_unlock).toBe(true);
    await close(store);

    for (let restart = 0; restart < 2; restart++) {
      store = await open(file);
      creator.store = store;
      expect(await store.all("guest_grants")).toEqual(explicit);
      expect((await detail(creator, receipt.id)).post.canEdit).toBe(true);
      await close(store);
    }
  });
});
