import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Context } from "./context";
import {
  owns,
  requireLeadership,
  requireManager,
  requireUser,
} from "./context";
import {
  AppError,
  encrypt,
  hash,
  passwordHash,
  passwordMatches,
  rateLimit,
  token,
} from "./security";
import { detail } from "./queries";
import type { Store } from "./store/types";

const id = z.uuid();
const postInput = z.object({
  requestId: z.uuid(),
  type: z.enum(["opinion", "suggestion", "issue"]),
  title: z.string().trim().min(3).max(160),
  body: z.string().trim().min(10).max(10000),
  anonymous: z.boolean(),
  authorName: z.string().trim().max(100).default(""),
  email: z.union([z.email(), z.literal("")]).default(""),
  courseId: id.nullable().default(null),
  teacherId: id.nullable().default(null),
  customTarget: z.string().trim().max(160).default(""),
  attachments: z.array(id).max(5).default([]),
});
const now = () => new Date().toISOString();
const inHours = (hours: number) =>
  new Date(Date.now() + hours * 3_600_000).toISOString();
async function notify(
  repo: Store,
  profile: string,
  post: string,
  title: string,
) {
  await repo.insert("notifications", {
    id: randomUUID(),
    profile_id: profile,
    feedback_id: post,
    title,
    read_at: null,
    created_at: now(),
  });
}
async function lockPost(repo: Store, id: string) {
  const row = await repo.get("feedback", id);
  if (!row || row.deleted) throw new AppError("Жазба табылмады.", 404);
  return row;
}
export async function action(ctx: Context, name: string, input: unknown) {
  if (name === "createPost") {
    const data = postInput.parse(input);
    if (!data.anonymous && !ctx.viewer && !data.authorName)
      throw new AppError(
        "Атыңызды енгізіңіз немесе анонимді жариялауды таңдаңыз.",
      );
    const key = hash(`${ctx.sessionHash}:${data.requestId}`);
    return ctx.store.transaction(async (repo) => {
      const previous = await repo.get("submissions", key);
      if (previous?.feedback_id) {
        const record = await repo.get("feedback", String(previous.feedback_id));
        return {
          ok: true,
          id: String(previous.feedback_id),
          number: Number(record?.number),
          duplicate: true,
        };
      }
      if (!previous) await repo.insert("submissions", { key, feedback_id: null });
      await rateLimit(repo, `post:${ctx.ip}`, 12, 600);
      const files = data.attachments.length
        ? (
            await repo.all("attachments")
          ).filter(
            (file) =>
              data.attachments.includes(String(file.id)) &&
              file.token_hash === ctx.sessionHash &&
              file.feedback_id === null,
          )
        : [];
      if (
        files.length !== new Set(data.attachments).size ||
        files.some((f) => !f.ready) ||
        files.reduce((sum, f) => sum + Number(f.size), 0) > 20971520
      )
        throw new AppError(
          "Файлдардың жүктелуі мен жалпы 20 МБ шегін тексеріңіз.",
        );
      const postId = randomUUID();
      const code = ctx.viewer ? null : token();
      const status =
        data.type === "issue"
          ? "new"
          : data.type === "suggestion"
            ? "in_progress"
            : null;
      const number = await repo.nextNumber();
      await repo.insert("feedback", {
        id: postId,
        number,
        type: data.type,
        title: data.title,
        body: data.body,
        course_id: data.courseId,
        teacher_id: data.teacherId,
        custom_target: data.customTarget || null,
        anonymous: data.anonymous,
        author_name: data.anonymous
          ? null
          : ctx.viewer?.name || data.authorName,
        status,
        outcome: null,
        confirmed: false,
        hidden: false,
        hidden_reason: null,
        deleted: false,
        resolved_at: null,
        created_at: now(),
        updated_at: now(),
      });
      await repo.insert("feedback_access", {
        feedback_id: postId,
        profile_id: ctx.viewer?.id || null,
        recovery_email: ctx.viewer?.email || data.email || null,
        code_hash: code ? passwordHash(code) : null,
      });
      if (code)
        await repo.insert("guest_grants", {
          token_hash: ctx.sessionHash,
          feedback_id: postId,
          expires_at: inHours(12),
        });
      if (status)
        await repo.insert("status_history", {
          id: randomUUID(),
          feedback_id: postId,
          status,
          outcome: null,
          created_at: now(),
        });
      for (const file of files)
        await repo.update("attachments", String(file.id), {
          feedback_id: postId,
        });
      for (const manager of await repo.all("profiles"))
        if (["admin", "leadership"].includes(String(manager.role)) && manager.active)
          await notify(repo, String(manager.id), postId, "Жаңа кері байланыс түсті");
      await repo.insert("jobs", {
        id: randomUUID(),
        kind: "moderation",
        subject_id: postId,
        payload: "{}",
        status: "pending",
        attempts: 0,
        available_at: now(),
        last_error: null,
        created_at: now(),
      });
      await repo.update("submissions", key, { feedback_id: postId });
      return { ok: true, id: postId, number, code };
    });
  }
  if (name === "unlockPost") {
    const data = z
      .object({
        number: z.coerce.number().int().positive(),
        code: z.string().min(1).max(200),
      })
      .parse(input);
    await rateLimit(ctx.store, `code:${ctx.ip}:${data.number}`, 5, 600);
    const post = (
      await ctx.store.find("feedback", { number: data.number })
    ).find((f) => !f.deleted);
    const access = post
      ? await ctx.store.get("feedback_access", String(post.id))
      : undefined;
    if (!post || !access?.code_hash || !passwordMatches(data.code, String(access.code_hash)))
      throw new AppError("Өтініш нөмірі немесе құпия код қате.", 401);
    const grantKey = `${ctx.sessionHash}|${post.id}`;
    const existing = await ctx.store.get("guest_grants", grantKey);
    if (existing)
      await ctx.store.update("guest_grants", grantKey, { expires_at: inHours(12) });
    else
      await ctx.store.insert("guest_grants", {
        token_hash: ctx.sessionHash,
        feedback_id: String(post.id),
        expires_at: inHours(12),
      });
    return { ok: true, id: String(post.id) };
  }
  if (name === "recoverPost") {
    const data = z.object({ email: z.email() }).parse(input);
    await rateLimit(ctx.store, `recover:${hash(data.email)}`, 3, 600);
    const access = await ctx.store.all("feedback_access");
    const feedback = await ctx.store.all("feedback");
    const records = access.filter(
      (a) =>
        a.profile_id === null &&
        String(a.recovery_email ?? "").toLowerCase() === data.email &&
        !feedback.find((f) => f.id === a.feedback_id)?.deleted,
    );
    let localToken: string | undefined;
    for (const record of records) {
      const proof = token();
      localToken = proof;
      await ctx.store.transaction(async (repo) => {
        await repo.insert("tokens", {
          token_hash: hash(proof),
          purpose: "guest",
          subject_id: record.feedback_id,
          expires_at: inHours(0.5),
        });
        if (!ctx.demo)
          await repo.insert("jobs", {
            id: randomUUID(),
            kind: "email",
            subject_id: record.feedback_id,
            payload: await encrypt(
              JSON.stringify({
                to: data.email,
                subject: "Өтінішке қолжетімділікті қалпына келтіру",
                text: `${process.env.APP_URL}/#guestRecovery=${encodeURIComponent(proof)}`,
              }),
            ),
            status: "pending",
            attempts: 0,
            available_at: now(),
            last_error: null,
            created_at: now(),
          });
      });
    }
    return {
      ok: true,
      message:
        "Email алдын ала қалдырылған болса, қалпына келтіру хаты жіберілді.",
      ...(ctx.demo && localToken ? { localToken, tokenPurpose: "guest" } : {}),
    };
  }
  if (name === "resetGuestCode") {
    const data = z.object({ token: z.string().min(10).max(200) }).parse(input);
    const code = token();
    const result = await ctx.store.transaction(async (repo) => {
      const record = await repo.get("tokens", hash(data.token));
      if (
        !record ||
        record.purpose !== "guest" ||
        Date.parse(String(record.expires_at)) <= Date.now()
      )
        throw new AppError("Қалпына келтіру сілтемесі жарамсыз.");
      const subjectId = String(record.subject_id);
      await repo.delete("tokens", hash(data.token));
      for (const other of await repo.find("tokens", {
        purpose: "guest",
        subject_id: subjectId,
      }))
        await repo.delete("tokens", String(other.token_hash));
      await repo.update("feedback_access", subjectId, {
        code_hash: passwordHash(code),
      });
      await repo.deleteWhere("guest_grants", { feedback_id: subjectId });
      await repo.insert("guest_grants", {
        token_hash: ctx.sessionHash,
        feedback_id: subjectId,
        expires_at: inHours(12),
      });
      const post = await repo.get("feedback", subjectId);
      if (!post || post.deleted) throw new AppError("Өтініш қолжетімсіз.", 404);
      return { id: subjectId, number: Number(post.number) };
    });
    return { ok: true, ...result, code };
  }
  if (name === "toggleSupport" || name === "toggleBookmark") {
    const viewer = requireUser(ctx);
    const data = z.object({ id }).parse(input);
    await detail(ctx, data.id);
    const table = name === "toggleSupport" ? "supports" : "bookmarks";
    const key = `${viewer.id}|${data.id}`;
    await ctx.store.transaction(async (repo) => {
      const post = await lockPost(repo, data.id);
      if (post.hidden)
        throw new AppError("Жасырылған жазбаға бұл әрекет қолжетімсіз.", 403);
      const existing = await repo.get(table, key);
      if (existing) await repo.delete(table, key);
      else
        await repo.insert(table, {
          profile_id: viewer.id,
          feedback_id: data.id,
        });
    });
    return { ok: true };
  }
  if (name === "editPost" || name === "deletePost") {
    const data = z
      .object({
        id,
        title: z.string().trim().min(3).max(160).optional(),
        body: z.string().trim().min(10).max(10000).optional(),
      })
      .parse(input);
    await ctx.store.transaction(async (repo) => {
      await lockPost(repo, data.id);
      if (!(await owns(ctx, data.id, repo)))
        throw new AppError("Бұл жазбаға авторлық құқығыңыз жоқ.", 403);
      const replies = await repo.find("official_replies", {
        feedback_id: data.id,
      });
      if (replies.length)
        throw new AppError(
          "Ресми жауаптан кейін жазбаны өзгертуге немесе өшіруге болмайды.",
          409,
        );
      if (name === "editPost") {
        if (!data.title || !data.body)
          throw new AppError("Тақырып пен мәтінді толтырыңыз.");
        await repo.update("feedback", data.id, {
          title: data.title,
          body: data.body,
          updated_at: now(),
        });
        await repo.insert("jobs", {
          id: randomUUID(),
          kind: "moderation",
          subject_id: data.id,
          payload: "{}",
          status: "pending",
          attempts: 0,
          available_at: now(),
          last_error: null,
          created_at: now(),
        });
      } else await deletePost(repo, data.id);
    });
    return { ok: true };
  }
  if (name === "comment") {
    const viewer = requireUser(ctx);
    const data = z
      .object({
        id,
        body: z.string().trim().min(1).max(5000),
        parentId: id.nullable().default(null),
      })
      .parse(input);
    await detail(ctx, data.id);
    await rateLimit(ctx.store, `comment:${viewer.id}`, 30, 60);
    await ctx.store.transaction(async (repo) => {
      const post = await lockPost(repo, data.id);
      if (post.hidden)
        throw new AppError("Жасырылған жазбаға пікір қосылмайды.", 403);
      if (data.parentId) {
        const parent = await repo.get("comments", data.parentId);
        if (
          !parent ||
          parent.feedback_id !== data.id ||
          parent.parent_id !== null ||
          parent.deleted
        )
          throw new AppError("Бір деңгейдегі пікірге ғана жауап беруге болады.");
      }
      const commentId = randomUUID();
      await repo.insert("comments", {
        id: commentId,
        feedback_id: data.id,
        profile_id: viewer.id,
        parent_id: data.parentId,
        body: data.body,
        deleted: false,
        created_at: now(),
        updated_at: now(),
      });
      await repo.insert("jobs", {
        id: randomUUID(),
        kind: "moderation",
        subject_id: data.id,
        payload: JSON.stringify({ commentId }),
        status: "pending",
        attempts: 0,
        available_at: now(),
        last_error: null,
        created_at: now(),
      });
    });
    return { ok: true };
  }
  if (name === "editComment" || name === "deleteComment") {
    const viewer = requireUser(ctx);
    const data = z
      .object({ id, body: z.string().trim().min(1).max(5000).optional() })
      .parse(input);
    const row = await ctx.store.get("comments", data.id);
    if (!row || row.profile_id !== viewer.id || row.deleted)
      throw new AppError("Пікірге құқығыңыз жоқ.", 403);
    await detail(ctx, String(row.feedback_id));
    if (name === "editComment") {
      if (!data.body) throw new AppError("Пікір мәтінін енгізіңіз.");
      await ctx.store.update("comments", data.id, {
        body: data.body,
        updated_at: now(),
      });
    } else
      await ctx.store.update("comments", data.id, {
        deleted: true,
        body: "",
        updated_at: now(),
      });
    await ctx.store.insert("jobs", {
      id: randomUUID(),
      kind: "moderation",
      subject_id: row.feedback_id,
      payload: JSON.stringify({ commentId: data.id }),
      status: "pending",
      attempts: 0,
      available_at: now(),
      last_error: null,
      created_at: now(),
    });
    return { ok: true };
  }
  if (name === "rateTeacher") {
    const viewer = requireUser(ctx);
    const data = z
      .object({
        id,
        stars: z.number().int().min(1).max(5),
        comment: z.string().trim().max(3000).default(""),
      })
      .parse(input);
    const teacher = await ctx.store.get("teachers", data.id);
    if (!teacher || !teacher.active)
      throw new AppError("Оқытушы табылмады.", 404);
    const key = `${viewer.id}|${data.id}`;
    const existing = await ctx.store.get("ratings", key);
    if (existing)
      await ctx.store.update("ratings", key, {
        stars: data.stars,
        comment: data.comment,
        updated_at: now(),
      });
    else
      await ctx.store.insert("ratings", {
        profile_id: viewer.id,
        teacher_id: data.id,
        stars: data.stars,
        comment: data.comment,
        updated_at: now(),
      });
    return { ok: true };
  }
  if (name === "officialReply") {
    const viewer = requireManager(ctx);
    const data = z
      .object({ id, body: z.string().trim().min(3).max(10000) })
      .parse(input);
    await ctx.store.transaction(async (repo) => {
      await lockPost(repo, data.id);
      await repo.insert("official_replies", {
        id: randomUUID(),
        feedback_id: data.id,
        profile_id: viewer.id,
        body: data.body,
        created_at: now(),
      });
      const author = await repo.get("feedback_access", data.id);
      if (author?.profile_id)
        await notify(
          repo,
          String(author.profile_id),
          data.id,
          "Өтінішіңізге ресми жауап берілді",
        );
      if (author?.recovery_email)
        await repo.insert("jobs", {
          id: randomUUID(),
          kind: "email",
          subject_id: data.id,
          payload: await encrypt(
            JSON.stringify({
              to: String(author.recovery_email),
              subject: "MAXBALL EDTECH: өтінішіңізге жауап берілді",
              text: `Өтінішіңізге ресми жауап берілді. ${process.env.APP_URL || "http://localhost:3000"}/?post=${data.id}`,
            }),
          ),
          status: "pending",
          attempts: 0,
          available_at: now(),
          last_error: null,
          created_at: now(),
        });
    });
    return { ok: true };
  }
  if (name === "setStatus" || name === "resolution") {
    const data = z
      .object({
        id,
        status: z
          .enum(["new", "reviewing", "resolved", "in_progress", "reviewed"])
          .optional(),
        outcome: z.enum(["implemented", "declined"]).nullable().optional(),
        resolved: z.boolean().optional(),
      })
      .parse(input);
    await ctx.store.transaction(async (repo) => {
      const post = await lockPost(repo, data.id);
      if (name === "resolution") {
        if (!(await owns(ctx, data.id, repo)))
          throw new AppError("Авторлық қолжетімділік қажет.", 403);
        if (
          post.type !== "issue" ||
          post.status !== "resolved" ||
          typeof data.resolved !== "boolean"
        )
          throw new AppError("Бұл әрекет шешілген мәселеге ғана қолданылады.");
        if (data.resolved) {
          await repo.update("feedback", data.id, { confirmed: true });
          return;
        }
        data.status = "reviewing";
      } else requireManager(ctx);
      if (post.type === "opinion")
        throw new AppError("Пікірге мәртебе берілмейді.");
      if (
        post.type === "issue" &&
        !["new", "reviewing", "resolved"].includes(data.status || "")
      )
        throw new AppError("Мәселенің мәртебесі қате.");
      if (
        post.type === "suggestion" &&
        !["in_progress", "reviewed"].includes(data.status || "")
      )
        throw new AppError("Ұсыныстың мәртебесі қате.");
      const outcome =
        post.type === "suggestion" && data.status === "reviewed"
          ? data.outcome
          : null;
      if (data.status === "reviewed" && !outcome)
        throw new AppError("Ұсыныстың нәтижесін көрсетіңіз.");
      if (post.status === data.status && post.outcome === outcome) return;
      await repo.update("feedback", data.id, {
        status: data.status ?? null,
        outcome,
        confirmed: false,
        resolved_at:
          data.status === "resolved" ? now() : null,
        updated_at: now(),
      });
      await repo.insert("status_history", {
        id: randomUUID(),
        feedback_id: data.id,
        status: data.status!,
        outcome,
        created_at: now(),
      });
    });
    return { ok: true };
  }
  if (name === "moderate") {
    requireManager(ctx);
    const data = z
      .object({
        id,
        mode: z.enum(["hide", "restore", "delete"]),
        reason: z.string().trim().max(1000).default(""),
      })
      .parse(input);
    if (data.mode === "hide" && data.reason.length < 3)
      throw new AppError("Жасыру себебін жазыңыз.");
    await ctx.store.transaction(async (repo) => {
      await lockPost(repo, data.id);
      if (data.mode === "delete") await deletePost(repo, data.id);
      else
        await repo.update("feedback", data.id, {
          hidden: data.mode === "hide",
          hidden_reason: data.mode === "hide" ? data.reason : null,
          updated_at: now(),
        });
    });
    return { ok: true };
  }
  if (name === "readNotifications") {
    const viewer = requireUser(ctx);
    const data = z.object({ id: id.optional() }).parse(input);
    for (const notice of await ctx.store.find("notifications", {
      profile_id: viewer.id,
    }))
      if (
        (notice.read_at === null || notice.read_at === undefined) &&
        (!data.id || notice.id === data.id)
      )
        await ctx.store.update("notifications", String(notice.id), {
          read_at: now(),
        });
    return { ok: true };
  }
  if (name === "addCourse" || name === "addTeacher") {
    requireLeadership(ctx);
    const data = z
      .object({
        name: z.string().trim().min(2).max(100),
        subject: z.string().trim().max(100).default("Жалпы курс"),
      })
      .parse(input);
    if (name === "addCourse")
      await ctx.store.insert("courses", {
        id: randomUUID(),
        name: data.name,
        active: true,
      });
    else
      await ctx.store.insert("teachers", {
        id: randomUUID(),
        profile_id: null,
        name: data.name,
        subject: data.subject,
        color: "blue",
        active: true,
      });
    return { ok: true };
  }
  if (name === "setRole") {
    const viewer = requireLeadership(ctx);
    const data = z
      .object({ id, role: z.enum(["user", "teacher", "admin", "leadership"]) })
      .parse(input);
    if (data.id === viewer.id)
      throw new AppError("Өз басқару құқығыңызды осы беттен өзгерте алмайсыз.");
    await ctx.store.transaction(async (repo) => {
      const person = await repo.get("profiles", data.id);
      if (!person) throw new AppError("Аккаунт табылмады.", 404);
      await repo.update("profiles", data.id, { role: data.role });
      if (data.role === "teacher") {
        const existing = (
          await repo.all("teachers")
        ).find((t) => t.profile_id === data.id);
        if (existing)
          await repo.update("teachers", String(existing.id), {
            active: Boolean(person.active),
          });
        else
          await repo.insert("teachers", {
            id: randomUUID(),
            profile_id: data.id,
            name: String(person.name),
            subject: "Жалпы курс",
            color: "blue",
            active: Boolean(person.active),
          });
      } else if (person.role === "teacher")
        for (const teacher of await repo.find("teachers", {
          profile_id: data.id,
        }))
          await repo.update("teachers", String(teacher.id), { active: false });
    });
    return { ok: true };
  }
  if (name === "updateCatalog") {
    requireLeadership(ctx);
    const data = z
      .object({
        id,
        kind: z.enum(["course", "teacher"]),
        name: z.string().trim().min(2).max(100),
        subject: z.string().trim().max(100).default("Жалпы курс"),
        active: z.boolean(),
      })
      .parse(input);
    if (data.kind === "course") {
      const course = await ctx.store.get("courses", data.id);
      if (!course) throw new AppError("Жазба табылмады.", 404);
      await ctx.store.update("courses", data.id, {
        name: data.name,
        active: data.active,
      });
    } else {
      const record = await ctx.store.get("teachers", data.id);
      if (!record) throw new AppError("Жазба табылмады.", 404);
      await ctx.store.update("teachers", data.id, {
        name: data.name,
        subject: data.subject,
        active: data.active,
      });
      if (record.profile_id)
        await ctx.store.update("profiles", String(record.profile_id), {
          name: data.name,
        });
    }
    return { ok: true };
  }
  if (name === "setAccountActive") {
    const viewer = requireLeadership(ctx);
    const data = z.object({ id, active: z.boolean() }).parse(input);
    if (data.id === viewer.id)
      throw new AppError("Өз аккаунтыңызды бұғаттай алмайсыз.");
    await ctx.store.transaction(async (repo) => {
      const person = await repo.get("profiles", data.id);
      if (!person) throw new AppError("Аккаунт табылмады.", 404);
      await repo.update("profiles", data.id, { active: data.active });
      if (!data.active)
        await repo.deleteWhere("sessions", { profile_id: data.id });
      if (person.role === "teacher")
        for (const teacher of await repo.find("teachers", {
          profile_id: data.id,
        }))
          await repo.update("teachers", String(teacher.id), {
            active: data.active,
          });
    });
    return { ok: true };
  }
  throw new AppError("Белгісіз әрекет.", 404);
}
async function deletePost(repo: Store, id: string) {
  for (const file of await repo.find("attachments", { feedback_id: id }))
    await repo.insert("jobs", {
      id: randomUUID(),
      kind: "deleteFile",
      subject_id: null,
      payload: JSON.stringify({ path: file.object_path }),
      status: "pending",
      attempts: 0,
      available_at: now(),
      last_error: null,
      created_at: now(),
    });
  await repo.delete("feedback", id);
}
