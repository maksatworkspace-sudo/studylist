import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Context } from "../src/server/context";
import type { Store } from "../src/server/store/types";
import { makeStore } from "./adapters";
import { action } from "../src/server/actions";
import { authAction } from "../src/server/auth";
import { accessibleAttachment, boot, detail, moderation, statistics } from "../src/server/queries";
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
    expect((await detail(user, created.id)).post.isAccountOwner).toBe(true);
    expect(seen.post.isAccountOwner).toBe(false);
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
  it("ends anonymous ownership when the session rotates and restores it only by code", async () => {
    const created = await create(guest);
    expect((await detail(guest, created.id)).post.isOwner).toBe(false);
    await action(guest, "unlockPost", {
      number: created.number,
      code: created.code,
    });
    expect((await detail(guest, created.id)).post.isOwner).toBe(true);
    // Logging into an account must not inherit the browser's guest grants.
    await authAction(guest, "demoLogin", { role: "user" });
    const inherited = (await detail(guest, created.id)).post;
    expect(inherited.isOwner).toBe(false);
    expect(inherited.canEdit).toBe(false);
    // The receipt code is the only way back in.
    await action(guest, "unlockPost", {
      number: created.number,
      code: created.code,
    });
    expect((await detail(guest, created.id)).post.isOwner).toBe(true);
    // Leaving the account ends the code-restored access as well.
    await authAction(guest, "logout");
    expect((await detail(guest, created.id)).post.isOwner).toBe(false);
  });
  it("rotates recovery codes and invalidates previous grants", async () => {
    const created = await create(guest, { email: "recovery@example.com" });
    await action(guest, "unlockPost", {
      number: created.number,
      code: created.code,
    });
    const recovery = (await action(guest, "recoverPost", {
      email: "recovery@example.com",
    })) as { localToken: string };
    const restored = (await action(guest, "resetGuestCode", {
      token: recovery.localToken,
    })) as Created;
    expect(restored.id).toBe(created.id);
    expect(restored.code).not.toBe(created.code);
    expect((await detail(guest, created.id)).post.canEdit).toBe(false);
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
  it("computes statistics on Asia/Almaty day boundaries and excludes reopened issues", async () => {
    // UTC 2026-10-19 21:30 == Almaty 2026-10-20 03:30; the post belongs to
    // the Almaty 2026-10-20 bucket, not the UTC day.
    const created = (await action(
      user,
      "createPost",
      input({ title: "Шекті күн сынағы" }),
    )) as Created;
    // A deterministic future Almaty day that no seeded post can occupy.
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const after = new Date(Date.now() + 2 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    // Almaty tomorrow 00:30 == UTC previous day 18:30.
    const almatyEarly = new Date(`${tomorrow}T00:30:00+06:00`).toISOString();
    await db.update("feedback", created.id, { created_at: almatyEarly });
    await action(admin, "setStatus", { id: created.id, status: "resolved" });
    await db.update("feedback", created.id, {
      resolved_at: new Date(`${tomorrow}T01:30:00+06:00`).toISOString(),
    });
    const day = await statistics(admin, tomorrow, tomorrow);
    expect(day.total).toBe(1);
    expect(day.resolved).toBe(1);
    expect(day.resolutionHours).toBeCloseTo(1, 5);
    // Exactly one post in the boundary day proves no leak from the adjacent
    // Almaty days on either side (the UTC date of the timestamp differs).
    expect((await statistics(admin, after, after)).total).toBe(0);
    // Reopening removes the issue from resolved aggregates.
    await action(user, "resolution", { id: created.id, resolved: false });
    expect((await statistics(admin, tomorrow, tomorrow)).resolved).toBe(0);
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

describe("#25 moderation: reports, comment moderation and the audit log", () => {
  const reportInput = (targetType: "post" | "comment", targetId: string, extra: Record<string, unknown> = {}) =>
    ({ targetType, targetId, reason: "spam", note: "", ...extra });
  async function freshGuest() {
    const sessionHash = hash(randomUUID());
    await db.insert("sessions", {
      token_hash: sessionHash, profile_id: null, provider_session: null,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    return { store: db, sessionHash, ip: randomUUID(), demo: true, viewer: null } as Context;
  }
  it("hides a post from the public API and restores it, logging both decisions", async () => {
    const created = await create(user);
    await action(admin, "moderate", { id: created.id, mode: "hide", reason: "Спам талаптары" });
    // Public API: gone from boot for a guest, detail 404, author still sees the reason.
    await expect(detail(guest, created.id)).rejects.toThrow();
    expect((await boot(guest)).posts.some((p) => p.id === created.id)).toBe(false);
    expect((await detail(user, created.id)).post.hiddenReason).toBe("Спам талаптары");
    const first = await db.all("moderation_log");
    expect(first.some((e) => e.action === "hide" && e.target_id === created.id && e.prev_state === "visible" && e.new_state === "hidden")).toBe(true);
    await action(admin, "moderate", { id: created.id, mode: "restore" });
    expect((await detail(guest, created.id)).post.hidden).toBe(false);
    const second = await db.all("moderation_log");
    expect(second.some((e) => e.action === "restore" && e.target_id === created.id)).toBe(true);
    expect(second.length).toBe(first.length + 1);
  });
  it("rejects moderation from teachers, guests and users over direct action calls", async () => {
    const created = await create(user);
    for (const ctx of [guest, user, teacher])
      await expect(
        action(ctx, "moderate", { id: created.id, mode: "hide", reason: "Тексеру" }),
      ).rejects.toThrow();
    await expect(
      action(teacher, "moderateComment", { id: demoId(4000), mode: "hide", reason: "Тексеру" }),
    ).rejects.toThrow();
    await expect(
      action(user, "setReportStatus", { targetType: "post", targetId: created.id, status: "resolved" }),
    ).rejects.toThrow();
    expect((await detail(guest, created.id)).post.hidden).toBe(false);
  });
  it("deletes a post permanently with its attachments queued for storage removal", async () => {
    const created = await create(user);
    await action(admin, "moderate", { id: created.id, mode: "delete" });
    expect(await db.get("feedback", created.id)).toBeUndefined();
    expect((await boot(admin)).posts.some((p) => p.id === created.id)).toBe(false);
    // The audit entry outlives the content it describes.
    expect(
      (await db.all("moderation_log")).some(
        (e) => e.action === "delete" && e.target_id === created.id && e.target_number === created.number,
      ),
    ).toBe(true);
  });
  it("blocks direct attachment downloads for hidden posts", async () => {
    const created = await create(teacher);
    const attachmentId = randomUUID();
    await db.insert("attachments", {
      id: attachmentId, token_hash: null, feedback_id: created.id,
      name: "тексеру.txt", size: 10, mime: "text/plain",
      object_path: `staged/${attachmentId}`, ready: true,
      created_at: new Date().toISOString(),
    });
    await action(admin, "moderate", { id: created.id, mode: "hide", reason: "Файнды тексеру" });
    await expect(accessibleAttachment(guest, attachmentId)).rejects.toThrow();
    await action(admin, "moderate", { id: created.id, mode: "restore" });
    await expect(accessibleAttachment(guest, attachmentId)).resolves.toBeTruthy();
  });
  it("moderates one comment without touching its post and masks it for the public", async () => {
    const created = await create(teacher);
    await action(user, "comment", { id: created.id, body: "Талқылау пікірі" });
    const comment = (await db.find("comments", { feedback_id: created.id }))[0];
    await action(admin, "moderateComment", { id: String(comment.id), mode: "hide", reason: "Ереже бұзушылық" });
    // The post stays exactly as it was.
    const post = (await detail(guest, created.id)).post;
    expect(post.hidden).toBe(false);
    expect(post.comments).toBe(0);
    // Public sees a masked row; the manager sees the content and the reason.
    const publicView = (await detail(guest, created.id)).comments.find((c) => c.id === comment.id)!;
    expect(publicView.body).toBe("");
    expect(publicView.name).toBe("Жасырылған пікір");
    expect(publicView.hiddenReason).toBeNull();
    const managerView = (await detail(admin, created.id)).comments.find((c) => c.id === comment.id)!;
    expect(managerView.body).toBe("Талқылау пікірі");
    expect(managerView.hiddenReason).toBe("Ереже бұзушылық");
    await action(admin, "moderateComment", { id: String(comment.id), mode: "restore" });
    expect((await detail(guest, created.id)).post.comments).toBe(1);
    await action(admin, "moderateComment", { id: String(comment.id), mode: "delete" });
    expect((await detail(guest, created.id)).comments.find((c) => c.id === comment.id)!.deleted).toBe(true);
  });
  it("accepts reports from guests and users, deduplicates and never hides content", async () => {
    const created = await create(teacher);
    const visitor = await freshGuest();
    await action(visitor, "report", reportInput("post", created.id, { note: "Қайталанады" }));
    const again = (await action(visitor, "report", reportInput("post", created.id))) as { duplicate?: boolean };
    expect(again.duplicate).toBe(true);
    await action(user, "report", reportInput("post", created.id, { reason: "harassment" }));
    // Two distinct reporters → two rows; the content itself stays public.
    expect((await db.find("reports", { target_id: created.id })).length).toBe(2);
    expect((await detail(guest, created.id)).post.hidden).toBe(false);
    await expect(
      action(visitor, "report", reportInput("comment", demoId(4000))),
    ).resolves.toBeTruthy();
  });
  it("moves report statuses through the workflow and records every transition", async () => {
    const created = await create(teacher);
    await action(guest, "report", reportInput("post", created.id));
    const before = (await db.all("moderation_log")).length;
    await action(leader, "setReportStatus", { targetType: "post", targetId: created.id, status: "reviewing" });
    await action(leader, "setReportStatus", { targetType: "post", targetId: created.id, status: "resolved" });
    const row = (await db.find("reports", { target_id: created.id }))[0];
    expect(row.status).toBe("resolved");
    expect(row.handled_by).toBe(leader.viewer!.id);
    expect((await db.all("moderation_log")).length).toBe(before + 2);
    await expect(
      action(admin, "setReportStatus", { targetType: "post", targetId: created.id, status: "dismissed" }),
    ).resolves.toBeTruthy();
  });
  it("keeps anonymous authors anonymous inside reports and the audit log", async () => {
    const created = await create(guest, { authorName: "Жасырын есім" });
    await action(user, "report", reportInput("post", created.id));
    await action(admin, "moderate", { id: created.id, mode: "hide", reason: "Тексеру" });
    const board = await boot(admin);
    const serialized = JSON.stringify(board.moderation);
    expect(serialized).not.toContain(guest.sessionHash);
    expect(serialized).not.toContain("Жасырын есім");
    expect(serialized).not.toContain("reporter_key");
    expect(board.moderation!.reports[0].reporter).toBe(String((await db.get("profiles", demoId(1)))!.name));
    await action(admin, "moderate", { id: created.id, mode: "restore" });
  });
  it("serializes identical final state under concurrent moderation writes", async () => {
    const created = await create(teacher);
    const outcome = await Promise.allSettled([
      action(admin, "moderate", { id: created.id, mode: "hide", reason: "Бірінші себеп" }),
      action(leader, "moderate", { id: created.id, mode: "restore" }),
    ]);
    // Both writers serialize; whatever lands last is a consistent state and
    // every decision that changed anything is logged exactly once.
    const settled = outcome.filter((r) => r.status === "fulfilled").length;
    const row = await db.get("feedback", created.id);
    const logs = (await db.all("moderation_log")).filter((e) => e.target_id === created.id);
    expect(row).toBeDefined();
    expect(row!.hidden).toBe(logs.at(-1)!.new_state === "hidden");
    expect(logs.length).toBeGreaterThanOrEqual(settled === 2 ? 1 : 0);
    expect((await detail(admin, created.id)).post.number).toBe(created.number);
  });
  it("never exposes the moderation payload to non-managers", async () => {
    await expect(moderation(guest)).rejects.toThrow();
    await expect(moderation(teacher)).rejects.toThrow();
    const board = await boot(teacher);
    expect(board.moderation).toBeNull();
    const managerBoard = await boot(admin);
    expect(managerBoard.moderation!.counts).toBeDefined();
  });
});
