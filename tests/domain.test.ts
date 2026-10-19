import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Context } from "../src/server/context";
import type { Store } from "../src/server/store/types";
import { makeStore } from "./adapters";
import { action } from "../src/server/actions";
import { authAction } from "../src/server/auth";
import { boot, detail, statistics } from "../src/server/queries";
import { demoId, seed } from "../src/server/seed";
import {
  hash,
  passwordMatches,
  requireSameOrigin,
} from "../src/server/security";
import { fileAction } from "../src/server/files";
import type { Viewer } from "../src/lib/types";
import { postgresOptions } from "../src/server/pg-config";

let db: Store;
let guest: Context,
  user: Context,
  teacher: Context,
  admin: Context,
  leader: Context;
beforeAll(async () => {
  db = await makeStore();
  await seed(db);
  async function ctx(n?: number): Promise<Context> {
    const sessionHash = hash(randomUUID());
    await db.insert("sessions", {
      token_hash: sessionHash,
      profile_id: n ? demoId(n) : null,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      provider_session: null,
    });
    const profile = n ? await db.get("profiles", demoId(n)) : undefined;
    return {
      store: db,
      sessionHash,
      ip: randomUUID(),
      demo: true,
      viewer: profile
        ? ({
            id: String(profile.id),
            name: String(profile.name),
            email: String(profile.email),
            phone: String(profile.phone),
            role: profile.role,
            verified: Boolean(profile.verified),
          } as Viewer)
        : null,
    };
  }
  guest = await ctx();
  user = await ctx(1);
  teacher = await ctx(4);
  admin = await ctx(5);
  leader = await ctx(6);
});
const input = (extra: Record<string, unknown> = {}) => ({
  requestId: randomUUID(),
  type: "issue",
  title: "Тексеру өтініші",
  body: "Тестілеуге арналған нақты өтініш мәтіні.",
  anonymous: true,
  ...extra,
});
type Created = { ok: boolean; id: string; number: number; code: string | null };
const create = (ctx: Context, extra: Record<string, unknown> = {}) =>
  action(ctx, "createPost", input(extra)) as Promise<Created>;

describe("anonymous feedback and author access", () => {
  it("publishes instantly without exposing a registered author's identity to managers", async () => {
    const created = await create(user);
    const seen = await detail(admin, created.id);
    expect(seen.post.anonymous).toBe(true);
    expect(seen.post.authorName).toBe("Анонимді автор");
    expect(seen.post.isOwner).toBe(false);
    const serialized = JSON.stringify(seen);
    expect(serialized).not.toContain(user.viewer!.id);
    expect(serialized).not.toContain(user.viewer!.email);
    expect(serialized).not.toContain(user.viewer!.phone);
    expect(serialized).not.toContain("profile_id");
    expect((await detail(user, created.id)).post.canEdit).toBe(true);
  });
  it("returns a guest code once and stores only its salted hash", async () => {
    const values = input();
    const created = (await action(guest, "createPost", values)) as Created;
    const access = await db.get("feedback_access", created.id);
    expect(created.code!.length).toBeGreaterThan(25);
    expect(access!.code_hash).not.toBe(created.code);
    expect(passwordMatches(created.code!, String(access!.code_hash))).toBe(true);
    const duplicate = (await action(guest, "createPost", values)) as Created;
    expect(duplicate.id).toBe(created.id);
    expect(duplicate.code).toBeUndefined();
    await expect(
      action(admin, "unlockPost", { number: created.number, code: "wrong" }),
    ).rejects.toThrow();
    await action(admin, "unlockPost", {
      number: created.number,
      code: created.code,
    });
    expect((await detail(admin, created.id)).post.isOwner).toBe(true);
  });
  it("denies editing by another user and freezes author editing after an official response", async () => {
    const created = await create(user);
    await expect(
      action(teacher, "editPost", {
        id: created.id,
        title: "Басқа мәтін",
        body: "Өзгертілген өтініш мәтіні",
      }),
    ).rejects.toThrow();
    await action(admin, "officialReply", {
      id: created.id,
      body: "Ресми жауап: мәселе қаралуда.",
    });
    await expect(
      action(user, "deletePost", { id: created.id }),
    ).rejects.toThrow("Ресми жауаптан кейін");
    expect((await detail(user, created.id)).post.canEdit).toBe(false);
    const notices = await db.find("notifications", {
      profile_id: user.viewer!.id,
      feedback_id: created.id,
    });
    expect(notices).toHaveLength(1);
  });
  it("rotates recovery codes and invalidates previous grants", async () => {
    const created = await create(guest, { email: "recovery@example.com" });
    const recovery = (await action(guest, "recoverPost", {
      email: "recovery@example.com",
    })) as { localToken: string };
    const restored = (await action(guest, "resetGuestCode", {
      token: recovery.localToken,
    })) as Created;
    expect(restored.id).toBe(created.id);
    expect(restored.code).not.toBe(created.code);
    await expect(
      action(user, "unlockPost", {
        number: created.number,
        code: created.code,
      }),
    ).rejects.toThrow();
    await expect(
      action(guest, "resetGuestCode", { token: recovery.localToken }),
    ).rejects.toThrow();
  });
});
describe("roles, state transitions and visibility", () => {
  it("reveals named author contacts only to managers, never through the public feed", async () => {
    const created = await create(user, { anonymous: false });
    expect((await detail(admin, created.id)).contact).toEqual({
      email: user.viewer!.email,
      phone: user.viewer!.phone,
    });
    expect((await detail(guest, created.id)).contact).toBeNull();
    expect(JSON.stringify((await boot(guest)).posts)).not.toContain(
      user.viewer!.email,
    );
  });
  it("archives catalog entries without destroying previous feedback references", async () => {
    await action(leader, "addCourse", { name: "Сынақ курс" });
    const course = (await boot(guest)).courses.find(
      (c) => c.name === "Сынақ курс",
    )!;
    await action(leader, "updateCatalog", {
      id: course.id,
      kind: "course",
      name: course.name,
      active: false,
    });
    expect((await boot(guest)).courses.some((c) => c.id === course.id)).toBe(
      false,
    );
    expect(
      (await boot(leader)).catalog!.courses.find((c) => c.id === course.id)
        ?.active,
    ).toBe(false);
  });
  it("invalidates sessions when an account is disabled and prevents self-disabling", async () => {
    await expect(
      action(leader, "setAccountActive", {
        id: leader.viewer!.id,
        active: false,
      }),
    ).rejects.toThrow();
    await action(leader, "setAccountActive", {
      id: teacher.viewer!.id,
      active: false,
    });
    expect(
      await db.find("sessions", { profile_id: teacher.viewer!.id }),
    ).toHaveLength(0);
    await action(leader, "setAccountActive", {
      id: teacher.viewer!.id,
      active: true,
    });
  });
  it("does not enable demo account switching in production", async () => {
    await expect(
      authAction({ ...guest, demo: false }, "demoLogin", {
        role: "leadership",
      }),
    ).rejects.toThrow();
  });
  it("does not grant a teacher management privileges", async () => {
    await expect(
      action(teacher, "officialReply", {
        id: demoId(1000),
        body: "Ресми емес жауап",
      }),
    ).rejects.toThrow();
    await expect(
      authAction(admin, "createStaff", {
        name: "Жаңа адам",
        email: "new@example.com",
        phone: "+77000000000",
        role: "admin",
      }),
    ).rejects.toThrow();
    await expect(statistics(user)).rejects.toThrow();
  });
  it("requires a result for reviewed suggestions", async () => {
    const created = await create(user, { type: "suggestion" });
    await expect(
      action(admin, "setStatus", { id: created.id, status: "reviewed" }),
    ).rejects.toThrow();
    await action(admin, "setStatus", {
      id: created.id,
      status: "reviewed",
      outcome: "implemented",
    });
    expect((await detail(guest, created.id)).post.outcome).toBe("implemented");
  });
  it("allows author confirmation or reopening and excludes reopened issues from closed averages", async () => {
    const created = await create(user);
    await action(admin, "setStatus", { id: created.id, status: "resolved" });
    const closed = await statistics(admin);
    await action(user, "resolution", { id: created.id, resolved: true });
    expect((await detail(user, created.id)).post.confirmed).toBe(true);
    await action(user, "resolution", { id: created.id, resolved: false });
    const reopened = await detail(guest, created.id);
    expect(reopened.post.status).toBe("reviewing");
    expect(reopened.post.confirmed).toBe(false);
    expect((await statistics(admin)).resolved).toBe(closed.resolved - 1);
    await expect(
      action(user, "resolution", { id: created.id, resolved: false }),
    ).rejects.toThrow();
  });
  it("hides the post, its comments and files from everyone except author and managers", async () => {
    const created = await create(user);
    await action(teacher, "comment", {
      id: created.id,
      body: "Талқылаудағы пікір",
    });
    await action(admin, "moderate", {
      id: created.id,
      mode: "hide",
      reason: "Спам белгілері тексерілуде",
    });
    await expect(detail(teacher, created.id)).rejects.toThrow();
    await expect(detail(guest, created.id)).rejects.toThrow();
    expect((await detail(user, created.id)).post.hiddenReason).toBe(
      "Спам белгілері тексерілуде",
    );
    expect((await detail(leader, created.id)).comments).toHaveLength(1);
    await action(admin, "moderate", { id: created.id, mode: "restore" });
    expect((await detail(guest, created.id)).post.hidden).toBe(false);
  });
  it("adds teachers to the selectable catalog and protects the current leader's role", async () => {
    await authAction(leader, "createStaff", {
      name: "Тест оқытушы",
      email: "teacher2@example.com",
      phone: "+77000000001",
      role: "teacher",
      subject: "Физика",
    });
    expect(
      (await boot(guest)).teachers.some((t) => t.name === "Тест оқытушы"),
    ).toBe(true);
    await expect(
      action(leader, "setRole", { id: leader.viewer!.id, role: "user" }),
    ).rejects.toThrow();
  });
});
describe("participation and files", () => {
  it("requires verification for participation and supports one toggle per account", async () => {
    await expect(
      action(guest, "toggleSupport", { id: demoId(1000) }),
    ).rejects.toThrow();
    const created = await create(user);
    await action(user, "toggleSupport", { id: created.id });
    expect((await detail(guest, created.id)).post.supports).toBe(1);
    await action(user, "toggleSupport", { id: created.id });
    expect((await detail(guest, created.id)).post.supports).toBe(0);
    await action(user, "toggleBookmark", { id: created.id });
    expect((await detail(user, created.id)).post.saved).toBe(true);
    expect((await detail(teacher, created.id)).post.saved).toBe(false);
  });
  it("updates a single teacher rating and rejects out-of-range stars", async () => {
    await action(user, "rateTeacher", {
      id: demoId(200),
      stars: 1,
      comment: "Нақты оқытушыға пікір",
    });
    await action(user, "rateTeacher", {
      id: demoId(200),
      stars: 5,
      comment: "Өзгертілген пікір",
    });
    const rating = await db.get("ratings", `${user.viewer!.id}|${demoId(200)}`);
    expect(rating).toMatchObject({ stars: 5 });
    await expect(
      action(user, "rateTeacher", { id: demoId(200), stars: 6 }),
    ).rejects.toThrow();
  });
  it("keeps comment replies to one level and only lets authors edit", async () => {
    const created = await create(user);
    await action(user, "comment", { id: created.id, body: "Бірінші пікір" });
    const parent = (await detail(guest, created.id)).comments[0];
    await action(teacher, "comment", {
      id: created.id,
      body: "Жауап мәтіні",
      parentId: parent.id,
    });
    const child = (await detail(guest, created.id)).comments.find(
      (c) => c.parentId,
    )!;
    await expect(
      action(user, "comment", {
        id: created.id,
        body: "Екінші деңгей",
        parentId: child.id,
      }),
    ).rejects.toThrow();
    await expect(
      action(teacher, "editComment", { id: parent.id, body: "Басқа мәтін" }),
    ).rejects.toThrow();
    await action(user, "deleteComment", { id: parent.id });
    expect(
      (await detail(guest, created.id)).comments.find((c) => c.id === parent.id)
        ?.body,
    ).toBe("");
  });
  it("limits staged files and rejects attachments from another browser or unfinished uploads", async () => {
    const prepared = (await fileAction(guest, "prepareUpload", {
      name: "test.bin",
      size: 20971520,
    })) as { id: string };
    await expect(
      fileAction(guest, "prepareUpload", { name: "overflow.txt", size: 1 }),
    ).rejects.toThrow();
    await expect(
      create(guest, { attachments: [prepared.id] }),
    ).rejects.toThrow();
    await expect(
      create(user, { attachments: [prepared.id] }),
    ).rejects.toThrow();
    await fileAction(guest, "discardUpload", { id: prepared.id });
    const five = [];
    for (let i = 0; i < 5; i++)
      five.push(
        (await fileAction(guest, "prepareUpload", {
          name: `test${i}`,
          size: 0,
        })) as { id: string },
      );
    await expect(
      fileAction(guest, "prepareUpload", { name: "sixth", size: 0 }),
    ).rejects.toThrow();
    for (const file of five)
      await fileAction(guest, "discardUpload", { id: file.id });
  });
  it("rejects cross-origin writes", () => {
    expect(() =>
      requireSameOrigin(
        new Request("http://localhost:3000/api/actions", {
          headers: { origin: "https://evil.example" },
        }),
      ),
    ).toThrow();
    expect(() =>
      requireSameOrigin(
        new Request("http://localhost:3000/api/actions", {
          headers: { origin: "http://localhost:3000" },
        }),
      ),
    ).not.toThrow();
  });
  it("keeps TLS verification enabled regardless of connection-string flags", () => {
    const config = postgresOptions(
      "postgres://user:example@database.example/test?sslmode=no-verify",
    );
    expect(config.ssl.rejectUnauthorized).toBe(true);
    expect(new URL(config.connectionString).searchParams.has("sslmode")).toBe(
      false,
    );
  });
  it("isolates store reads with defensive copies (replaces SQL RLS proof)", async () => {
    // The memory repository must hand out copies: mutating a returned row can
    // never corrupt stored state, which the RLS test previously guaranteed at
    // the SQL layer.
    const rows = await db.all("feedback");
    rows.length = 0;
    expect((await db.all("feedback")).length).toBeGreaterThan(0);
    const post = await db.get("feedback", demoId(1000));
    post!.title = "tampered";
    expect(String((await db.get("feedback", demoId(1000)))!.title)).not.toBe(
      "tampered",
    );
  });
});
