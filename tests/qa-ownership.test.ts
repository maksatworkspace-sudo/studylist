import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { makeStore, adapterName } from "./adapters";
import type { Store } from "../src/server/store/types";
import type { Context } from "../src/server/context";
import type { Viewer } from "../src/lib/types";
import { action } from "../src/server/actions";
import { authAction } from "../src/server/auth";
import { rotateSession } from "../src/server/context";
import { boot, detail } from "../src/server/queries";
import { hash } from "../src/server/security";
import { demoId, seed } from "../src/server/seed";
import { createMockService } from "../src/services/mock";
import type { Result } from "../src/services/types";

// Independent regression cases for #22's strict, explicit receipt-code access.
let store: Store;
beforeAll(async () => { store = await makeStore(); await seed(store); });

async function context(profile?: number): Promise<Context> {
  const sessionHash = hash(randomUUID());
  await store.insert("sessions", {
    token_hash: sessionHash, profile_id: profile ? demoId(profile) : null,
    expires_at: new Date(Date.now() + 86_400_000).toISOString(), provider_session: null,
  });
  const row = profile ? await store.get("profiles", demoId(profile)) : undefined;
  return {
    store, sessionHash, ip: randomUUID(), demo: true,
    viewer: row ? {
      id: String(row.id), name: String(row.name), email: String(row.email),
      phone: String(row.phone), role: row.role, verified: Boolean(row.verified),
    } as Viewer : null,
  };
}
const input = (extra: Record<string, unknown> = {}) => ({
  requestId: randomUUID(), type: "issue" as const, title: "QA ownership fixture",
  body: "Synthetic isolated receipt ownership regression fixture.", anonymous: true,
  ...extra,
});
type Receipt = { id: string; number: number; code: string };
const create = (ctx: Context, extra: Record<string, unknown> = {}) =>
  action(ctx, "createPost", input(extra)) as Promise<Receipt>;
const unlock = (ctx: Context, receipt: Receipt) =>
  action(ctx, "unlockPost", { number: receipt.number, code: receipt.code });
const edit = (ctx: Context, id: string) => action(ctx, "editPost", {
  id, title: "QA changed title", body: "Synthetic edited feedback text for QA.",
});

describe(`QA #22 explicit guest access (${adapterName()})`, () => {
  it("returns a receipt but creates no grant or editing permission", async () => {
    const guest = await context();
    const receipt = await create(guest);
    expect(receipt.code.length).toBeGreaterThan(25);
    expect(receipt.number).toBeGreaterThan(0);
    expect(await store.find("guest_grants", { feedback_id: receipt.id })).toEqual([]);
    expect((await detail(guest, receipt.id)).post).toMatchObject({
      isOwner: false, canEdit: false, isAccountOwner: false,
    });
  });

  it("rejects immediate direct edit and delete even in the creation session", async () => {
    const guest = await context();
    const receipt = await create(guest);
    await expect(edit(guest, receipt.id)).rejects.toMatchObject({ status: 403 });
    await expect(action(guest, "deletePost", { id: receipt.id })).rejects.toMatchObject({ status: 403 });
    expect((await detail(guest, receipt.id)).post.title).toBe("QA ownership fixture");
  });

  it("rejects immediate reopen and permits it only after an explicit unlock", async () => {
    const guest = await context();
    const admin = await context(5);
    const receipt = await create(guest);
    await action(admin, "setStatus", { id: receipt.id, status: "resolved" });
    await expect(action(guest, "resolution", { id: receipt.id, resolved: false }))
      .rejects.toMatchObject({ status: 403 });
    await unlock(guest, receipt);
    await action(guest, "resolution", { id: receipt.id, resolved: false });
    expect((await detail(guest, receipt.id)).post.status).toBe("reviewing");
  });

  it("valid unlock affects only the selected post and not a separate session", async () => {
    const guest = await context();
    const other = await context();
    const first = await create(guest);
    const second = await create(guest);
    await unlock(guest, first);
    expect((await detail(guest, first.id)).post.canEdit).toBe(true);
    expect((await detail(guest, second.id)).post.canEdit).toBe(false);
    expect((await detail(other, first.id)).post.canEdit).toBe(false);
    await expect(edit(other, first.id)).rejects.toMatchObject({ status: 403 });
    await edit(guest, first.id);
  });

  it("wrong, missing and mismatched codes never create a grant", async () => {
    const guest = await context();
    const other = await context();
    const first = await create(guest);
    const second = await create(guest);
    await expect(action(other, "unlockPost", { number: first.number, code: "incorrect-code" })).rejects.toThrow();
    await expect(action(other, "unlockPost", { number: first.number })).rejects.toThrow();
    await expect(action(other, "unlockPost", { number: second.number, code: first.code })).rejects.toThrow();
    expect(await store.find("guest_grants", { token_hash: other.sessionHash })).toEqual([]);
  });

  it("unlocked guest access is not registered ownership while signed in", async () => {
    const receipt = await create(await context());
    const account = await context(1);
    await unlock(account, receipt);
    const post = (await boot(account)).posts.find((p) => p.id === receipt.id)!;
    expect(post.isOwner).toBe(true);
    expect(post.canEdit).toBe(true);
    expect(post).toHaveProperty("isAccountOwner", false);
    expect((await store.get("feedback_access", receipt.id))!.profile_id).toBeNull();
    await edit(account, receipt.id);
  });

  it("signed-in anonymous posts remain owned only by their actual account", async () => {
    const accountA = await context(1);
    const accountB = await context(4);
    const receipt = await create(accountA);
    expect((await detail(accountA, receipt.id)).post).toMatchObject({
      anonymous: true, isOwner: true, canEdit: true, isAccountOwner: true,
    });
    expect((await detail(accountB, receipt.id)).post).toMatchObject({
      isOwner: false, canEdit: false, isAccountOwner: false,
    });
    await expect(edit(accountB, receipt.id)).rejects.toMatchObject({ status: 403 });
  });

  it("guest -> A -> B -> logout drops code grants on every rotation", async () => {
    const browser = await context();
    const receipt = await create(browser);
    await unlock(browser, receipt);
    const previous = browser.sessionHash;
    await authAction(browser, "demoLogin", { role: "user" });
    expect(await store.get("sessions", previous)).toBeUndefined();
    expect((await detail(browser, receipt.id)).post.isOwner).toBe(false);
    await unlock(browser, receipt);
    await authAction(browser, "demoLogin", { role: "teacher" });
    expect((await detail(browser, receipt.id)).post.isOwner).toBe(false);
    await unlock(browser, receipt);
    await authAction(browser, "logout", {});
    expect((await detail(browser, receipt.id)).post.isOwner).toBe(false);
    expect(await store.find("guest_grants", { feedback_id: receipt.id })).toEqual([]);
  });

  it("expired and revoked grants cannot edit or reopen", async () => {
    const guest = await context();
    const admin = await context(5);
    const receipt = await create(guest);
    await unlock(guest, receipt);
    await store.update("guest_grants", `${guest.sessionHash}|${receipt.id}`, {
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    expect((await detail(guest, receipt.id)).post.canEdit).toBe(false);
    await expect(edit(guest, receipt.id)).rejects.toMatchObject({ status: 403 });
    await action(admin, "setStatus", { id: receipt.id, status: "resolved" });
    await expect(action(guest, "resolution", { id: receipt.id, resolved: false })).rejects.toThrow();
    await unlock(guest, receipt);
    await store.deleteWhere("guest_grants", { feedback_id: receipt.id });
    await expect(edit(guest, receipt.id)).rejects.toMatchObject({ status: 403 });
  });

  it("recovery rotates codes and revokes every prior grant without automatically unlocking", async () => {
    const guest = await context();
    const other = await context(1);
    const email = `qa-${randomUUID()}@example.invalid`;
    const receipt = await create(guest, { email });
    await unlock(guest, receipt);
    await unlock(other, receipt);
    const proof = await action(guest, "recoverPost", { email }) as Result;
    const changed = await action(guest, "resetGuestCode", { token: proof.localToken }) as Receipt;
    expect(changed.code).not.toBe(receipt.code);
    expect(await store.find("guest_grants", { feedback_id: receipt.id })).toEqual([]);
    expect((await detail(guest, receipt.id)).post.canEdit).toBe(false);
    expect((await detail(other, receipt.id)).post.canEdit).toBe(false);
    await expect(edit(guest, receipt.id)).rejects.toMatchObject({ status: 403 });
    await expect(unlock(other, receipt)).rejects.toThrow();
    await expect(action(guest, "resetGuestCode", { token: proof.localToken })).rejects.toThrow();
    await unlock(guest, changed);
    await edit(guest, receipt.id);
  });

  it("preserves hidden-post privacy and official-reply edit restrictions after unlock", async () => {
    const guest = await context();
    const stranger = await context();
    const admin = await context(5);
    const receipt = await create(guest);
    await unlock(guest, receipt);
    await action(admin, "moderate", { id: receipt.id, mode: "hide", reason: "Synthetic privacy fixture" });
    await expect(detail(stranger, receipt.id)).rejects.toMatchObject({ status: 404 });
    expect((await detail(guest, receipt.id)).post.hidden).toBe(true);
    await action(admin, "officialReply", { id: receipt.id, body: "Synthetic official QA reply." });
    expect((await detail(guest, receipt.id)).post.canEdit).toBe(false);
    await expect(edit(guest, receipt.id)).rejects.toThrow();
  });

  it("does not expose receipt secrets or hashes in feed/detail DTOs", async () => {
    const guest = await context();
    const receipt = await create(guest);
    const access = await store.get("feedback_access", receipt.id);
    const serialized = JSON.stringify([await boot(guest), await detail(guest, receipt.id)]);
    expect(serialized).not.toContain(receipt.code);
    expect(serialized).not.toContain(String(access!.code_hash));
    expect(serialized).not.toContain("code_hash");
  });

  it("retains staged attachment ownership on login without inheriting guest grants", async () => {
    const browser = await context();
    const receipt = await create(browser);
    await unlock(browser, receipt);
    const fileId = randomUUID();
    await store.insert("attachments", {
      id: fileId, token_hash: browser.sessionHash, feedback_id: null,
      object_path: `qa/${fileId}`, name: "qa.txt", mime: "text/plain", size: 10,
      ready: false, created_at: new Date().toISOString(),
    });
    await rotateSession(browser, demoId(1));
    expect((await store.get("attachments", fileId))!.token_hash).toBe(browser.sessionHash);
    expect((await detail(browser, receipt.id)).post.isOwner).toBe(false);
  });
});

describe("QA #22 mock parity", () => {
  it("requires explicit code unlock immediately after guest creation", async () => {
    const mock = createMockService();
    const receipt = await mock.send("createPost", input());
    expect((await mock.detail(receipt.id!)).post.canEdit).toBe(false);
    await expect(mock.send("editPost", { id: receipt.id!, title: "Changed", body: "Changed synthetic mock text." })).rejects.toThrow();
    await mock.send("unlockPost", { number: receipt.number!, code: receipt.code! });
    expect((await mock.detail(receipt.id!)).post.canEdit).toBe(true);
  });

  it("keeps code-unlocked guest posts out of account ownership and drops access on rotation", async () => {
    const mock = createMockService();
    const receipt = await mock.send("createPost", input());
    await mock.send("demoLogin", { role: "user" });
    await mock.send("unlockPost", { number: receipt.number!, code: receipt.code! });
    expect((await mock.detail(receipt.id!)).post).toMatchObject({ isOwner: true, isAccountOwner: false });
    await mock.send("demoLogin", { role: "teacher" });
    expect((await mock.detail(receipt.id!)).post.canEdit).toBe(false);
    await mock.send("logout", {});
    expect((await mock.detail(receipt.id!)).post.canEdit).toBe(false);
  });

  it("recovery returns a new code without granting mock editing permission", async () => {
    const mock = createMockService();
    const receipt = await mock.send("createPost", input({ email: "qa-recovery@example.invalid" }));
    const proof = await mock.send("recoverPost", { email: "qa-recovery@example.invalid" });
    const recovered = await mock.send("resetGuestCode", { token: proof.localToken! });
    expect((await mock.detail(receipt.id!)).post.canEdit).toBe(false);
    await mock.send("unlockPost", { number: recovered.number!, code: recovered.code! });
    expect((await mock.detail(receipt.id!)).post.canEdit).toBe(true);
  });
});
