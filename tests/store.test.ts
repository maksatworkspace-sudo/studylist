// Repository semantics for the genuine in-memory backend (Refs #9): the
// same behavioral contract the TypeORM/better-sqlite3 adapter must satisfy.
import { describe, expect, it } from "vitest";
import { StoreError } from "../src/server/store/types";
import { adapterName, makeStore } from "./adapters";

const profile = (id: string) => ({
  id,
  name: `Адам ${id}`,
  email: `${id}@example.com`,
  phone: "+77000000000",
  role: "user",
  verified: true,
  active: true,
  created_at: new Date().toISOString(),
});

describe(`${adapterName()} repository`, () => {
  it("enforces primary-key and unique constraints", async () => {
    const repo = await makeStore();
    await repo.insert("profiles", profile("p1"));
    await expect(repo.insert("profiles", profile("p1"))).rejects.toMatchObject({
      code: "unique",
    });
    await expect(
      repo.insert("profiles", { ...profile("p2"), email: "p1@example.com" }),
    ).rejects.toMatchObject({ code: "unique" });
    await expect(repo.insert("courses", { id: "c1", name: "A", active: true }))
      .resolves.toBeUndefined();
    await expect(
      repo.insert("courses", { id: "c2", name: "A", active: true }),
    ).rejects.toBeInstanceOf(StoreError);
  });

  it("rejects inserts referencing missing rows and cascades deletes", async () => {
    const repo = await makeStore();
    await repo.insert("profiles", profile("p1"));
    await expect(
      repo.insert("feedback", {
        id: "f1",
        number: 1001,
        type: "opinion",
        title: "t",
        body: "b",
        course_id: "missing",
        teacher_id: null,
        custom_target: null,
        anonymous: false,
        author_name: "x",
        status: null,
        outcome: null,
        confirmed: false,
        hidden: false,
        hidden_reason: null,
        deleted: false,
        resolved_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    ).rejects.toMatchObject({ code: "foreign" });

    await repo.insert("feedback", {
      id: "f1",
      number: 1001,
      type: "opinion",
      title: "t",
      body: "b",
      course_id: null,
      teacher_id: null,
      custom_target: null,
      anonymous: false,
      author_name: "x",
      status: null,
      outcome: null,
      confirmed: false,
      hidden: false,
      hidden_reason: null,
      deleted: false,
      resolved_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await repo.insert("feedback_access", {
      feedback_id: "f1",
      profile_id: "p1",
      recovery_email: null,
      code_hash: null,
    });
    await repo.insert("supports", { profile_id: "p1", feedback_id: "f1" });
    await repo.insert("comments", {
      id: "cm1",
      feedback_id: "f1",
      profile_id: "p1",
      parent_id: null,
      body: "hi",
      deleted: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await repo.delete("feedback", "f1");
    expect(await repo.get("feedback_access", "f1")).toBeUndefined();
    expect(await repo.find("supports", { feedback_id: "f1" })).toHaveLength(0);
    expect(await repo.get("comments", "cm1")).toBeUndefined();
    // The profile itself survives the cascade.
    expect(await repo.get("profiles", "p1")).toBeDefined();
  });

  it("detaches SET NULL references (attachments lose their session)", async () => {
    const repo = await makeStore();
    await repo.insert("sessions", {
      token_hash: "s1",
      profile_id: null,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      provider_session: null,
    });
    await repo.insert("attachments", {
      id: "a1",
      feedback_id: null,
      token_hash: "s1",
      name: "x",
      size: 1,
      mime: "text/plain",
      object_path: "staged/a1",
      ready: false,
      created_at: new Date().toISOString(),
    });
    await repo.delete("sessions", "s1");
    expect((await repo.get("attachments", "a1"))!.token_hash).toBeNull();
  });

  it("rolls transactions back completely on failure", async () => {
    const repo = await makeStore();
    await repo.insert("profiles", profile("p1"));
    await expect(
      repo.transaction(async (tx) => {
        await tx.insert("profiles", profile("p2"));
        await tx.insert("profiles", profile("p1")); // conflict -> rollback
      }),
    ).rejects.toBeInstanceOf(StoreError);
    expect(await repo.get("profiles", "p2")).toBeUndefined();
    expect(await repo.get("profiles", "p1")).toBeDefined();
  });

  it("never lets reads observe a partial transaction", async () => {
    const repo = await makeStore();
    await repo.insert("profiles", profile("p1"));
    let observed = 0;
    const reader = (async () => {
      for (let i = 0; i < 50; i++) {
        const rows = await repo.all("profiles");
        // Either the transaction has not started or it fully committed —
        // never exactly one of the two inserted rows.
        if (rows.length === 2) observed++;
        if (rows.length === 3) observed++;
      }
    })();
    await repo.transaction(async (tx) => {
      await tx.insert("profiles", profile("p2"));
      await new Promise((resolve) => setTimeout(resolve, 5));
      await tx.insert("profiles", profile("p3"));
    });
    await reader;
    expect(await repo.all("profiles")).toHaveLength(3);
  });

  it("hands out defensive copies", async () => {
    const repo = await makeStore();
    await repo.insert("profiles", profile("p1"));
    const row = await repo.get("profiles", "p1");
    row!.email = "mutated@example.com";
    expect((await repo.get("profiles", "p1"))!.email).toBe("p1@example.com");
    const all = await repo.all("profiles");
    all[0].name = "mutated";
    expect((await repo.get("profiles", "p1"))!.name).toBe("Адам p1");
  });

  it("numbers feedback from 1001 and past explicitly seeded numbers", async () => {
    const repo = await makeStore();
    expect(await repo.nextNumber()).toBe(1001);
    expect(await repo.nextNumber()).toBe(1002);
    await repo.insert("feedback", {
      id: "fx",
      number: 5000,
      type: "opinion",
      title: "t",
      body: "b",
      course_id: null,
      teacher_id: null,
      custom_target: null,
      anonymous: false,
      author_name: "x",
      status: null,
      outcome: null,
      confirmed: false,
      hidden: false,
      hidden_reason: null,
      deleted: false,
      resolved_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    expect(await repo.nextNumber()).toBe(5001);
  });

  it("update merges patches and keeps uniqueness intact", async () => {
    const repo = await makeStore();
    await repo.insert("profiles", profile("p1"));
    await repo.insert("profiles", profile("p2"));
    await repo.update("profiles", "p1", { name: "Жаңа аты" });
    expect((await repo.get("profiles", "p1"))!.name).toBe("Жаңа аты");
    await expect(
      repo.update("profiles", "p1", { email: "p2@example.com" }),
    ).rejects.toMatchObject({ code: "unique" });
    await expect(repo.update("profiles", "ghost", { name: "x" })).rejects.toMatchObject(
      { code: "missing" },
    );
  });
});
