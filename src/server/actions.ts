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
import type { Database } from "./db";

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
async function notify(
  db: Database,
  profile: string,
  post: string,
  title: string,
) {
  await db.query(
    "INSERT INTO private.notifications(id,profile_id,feedback_id,title) VALUES($1,$2,$3,$4)",
    [randomUUID(), profile, post, title],
  );
}
async function lockPost(db: Database, id: string) {
  const row = (
    await db.query<{
      id: string;
      type: string;
      status: string;
      deleted: boolean;
      hidden: boolean;
      outcome: string | null;
    }>(
      "SELECT id,type,status,deleted,hidden,outcome FROM feedback WHERE id=$1 FOR UPDATE",
      [id],
    )
  )[0];
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
    return ctx.db.transaction(async (db) => {
      await db.query(
        "INSERT INTO private.submissions(key) VALUES($1) ON CONFLICT DO NOTHING",
        [key],
      );
      const previous = (
        await db.query<{ feedback_id: string | null }>(
          "SELECT feedback_id FROM private.submissions WHERE key=$1 FOR UPDATE",
          [key],
        )
      )[0];
      if (previous.feedback_id) {
        const record = (
          await db.query<{ number: number }>(
            "SELECT number FROM feedback WHERE id=$1",
            [previous.feedback_id],
          )
        )[0];
        return {
          ok: true,
          id: previous.feedback_id,
          number: Number(record.number),
          duplicate: true,
        };
      }
      await rateLimit(db, `post:${ctx.ip}`, 12, 600);
      const files = await db.query<{
        id: string;
        size: number;
        ready: boolean;
      }>(
        "SELECT id,size,ready FROM private.attachments WHERE id=ANY($1::uuid[]) AND token_hash=$2 AND feedback_id IS NULL FOR UPDATE",
        [data.attachments, ctx.sessionHash],
      );
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
      const row = (
        await db.query<{ number: number }>(
          `INSERT INTO feedback(id,type,title,body,course_id,teacher_id,custom_target,anonymous,author_name,status)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING number`,
          [
            postId,
            data.type,
            data.title,
            data.body,
            data.courseId,
            data.teacherId,
            data.customTarget || null,
            data.anonymous,
            data.anonymous ? null : ctx.viewer?.name || data.authorName,
            status,
          ],
        )
      )[0];
      await db.query(
        "INSERT INTO private.feedback_access(feedback_id,profile_id,recovery_email,code_hash) VALUES($1,$2,$3,$4)",
        [
          postId,
          ctx.viewer?.id || null,
          ctx.viewer?.email || data.email || null,
          code ? passwordHash(code) : null,
        ],
      );
      if (code)
        await db.query(
          "INSERT INTO private.guest_grants(token_hash,feedback_id,expires_at) VALUES($1,$2,now()+interval '12 hours')",
          [ctx.sessionHash, postId],
        );
      if (status)
        await db.query(
          "INSERT INTO status_history(id,feedback_id,status) VALUES($1,$2,$3)",
          [randomUUID(), postId, status],
        );
      if (files.length)
        await db.query(
          "UPDATE private.attachments SET feedback_id=$2 WHERE id=ANY($1::uuid[])",
          [data.attachments, postId],
        );
      for (const manager of await db.query<{ id: string }>(
        "SELECT id FROM profiles WHERE role IN ('admin','leadership') AND active",
      ))
        await notify(db, manager.id, postId, "Жаңа кері байланыс түсті");
      await db.query(
        "INSERT INTO private.jobs(id,kind,subject_id) VALUES($1,'moderation',$2)",
        [randomUUID(), postId],
      );
      await db.query(
        "UPDATE private.submissions SET feedback_id=$2 WHERE key=$1",
        [key, postId],
      );
      return { ok: true, id: postId, number: Number(row.number), code };
    });
  }
  if (name === "unlockPost") {
    const data = z
      .object({
        number: z.coerce.number().int().positive(),
        code: z.string().min(1).max(200),
      })
      .parse(input);
    await rateLimit(ctx.db, `code:${ctx.ip}:${data.number}`, 5, 600);
    const row = (
      await ctx.db.query<{ id: string; code_hash: string }>(
        "SELECT f.id,a.code_hash FROM feedback f JOIN private.feedback_access a ON a.feedback_id=f.id WHERE f.number=$1 AND NOT f.deleted",
        [data.number],
      )
    )[0];
    if (!row?.code_hash || !passwordMatches(data.code, row.code_hash))
      throw new AppError("Өтініш нөмірі немесе құпия код қате.", 401);
    await ctx.db.query(
      "INSERT INTO private.guest_grants(token_hash,feedback_id,expires_at) VALUES($1,$2,now()+interval '12 hours') ON CONFLICT(token_hash,feedback_id) DO UPDATE SET expires_at=excluded.expires_at",
      [ctx.sessionHash, row.id],
    );
    return { ok: true, id: row.id };
  }
  if (name === "recoverPost") {
    const data = z.object({ email: z.email() }).parse(input);
    await rateLimit(ctx.db, `recover:${hash(data.email)}`, 3, 600);
    const records = await ctx.db.query<{ id: string }>(
      "SELECT a.feedback_id AS id FROM private.feedback_access a JOIN feedback f ON f.id=a.feedback_id WHERE lower(a.recovery_email)=lower($1) AND a.profile_id IS NULL AND NOT f.deleted",
      [data.email],
    );
    let localToken: string | undefined;
    for (const record of records) {
      const proof = token();
      localToken = proof;
      await ctx.db.transaction(async (db) => {
        await db.query(
          "INSERT INTO private.tokens(token_hash,purpose,subject_id,expires_at) VALUES($1,'guest',$2,now()+interval '30 minutes')",
          [hash(proof), record.id],
        );
        if (!ctx.demo)
          await db.query(
            "INSERT INTO private.jobs(id,kind,subject_id,payload) VALUES($1,'email',$2,$3)",
            [
              randomUUID(),
              record.id,
              await encrypt(
                JSON.stringify({
                  to: data.email,
                  subject: "Өтінішке қолжетімділікті қалпына келтіру",
                  text: `${process.env.APP_URL}/#guestRecovery=${encodeURIComponent(proof)}`,
                }),
              ),
            ],
          );
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
    const result = await ctx.db.transaction(async (db) => {
      const record = (
        await db.query<{ subject_id: string }>(
          "DELETE FROM private.tokens WHERE token_hash=$1 AND purpose='guest' AND expires_at>now() RETURNING subject_id",
          [hash(data.token)],
        )
      )[0];
      if (!record) throw new AppError("Қалпына келтіру сілтемесі жарамсыз.");
      await db.query(
        "DELETE FROM private.tokens WHERE purpose='guest' AND subject_id=$1",
        [record.subject_id],
      );
      await db.query(
        "UPDATE private.feedback_access SET code_hash=$2 WHERE feedback_id=$1",
        [record.subject_id, passwordHash(code)],
      );
      await db.query("DELETE FROM private.guest_grants WHERE feedback_id=$1", [
        record.subject_id,
      ]);
      await db.query(
        "INSERT INTO private.guest_grants(token_hash,feedback_id,expires_at) VALUES($1,$2,now()+interval '12 hours')",
        [ctx.sessionHash, record.subject_id],
      );
      const post = (
        await db.query<{ number: number }>(
          "SELECT number FROM feedback WHERE id=$1 AND NOT deleted",
          [record.subject_id],
        )
      )[0];
      if (!post) throw new AppError("Өтініш қолжетімсіз.", 404);
      return { id: record.subject_id, number: Number(post.number) };
    });
    return { ok: true, ...result, code };
  }
  if (name === "toggleSupport" || name === "toggleBookmark") {
    const viewer = requireUser(ctx);
    const data = z.object({ id }).parse(input);
    await detail(ctx, data.id);
    const table = name === "toggleSupport" ? "supports" : "bookmarks";
    await ctx.db.transaction(async (db) => {
      const post = await lockPost(db, data.id);
      if (post.hidden)
        throw new AppError("Жасырылған жазбаға бұл әрекет қолжетімсіз.", 403);
      const existing = await db.query(
        `DELETE FROM ${table} WHERE profile_id=$1 AND feedback_id=$2 RETURNING profile_id`,
        [viewer.id, data.id],
      );
      if (!existing.length)
        await db.query(
          `INSERT INTO ${table}(profile_id,feedback_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,
          [viewer.id, data.id],
        );
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
    await ctx.db.transaction(async (db) => {
      await lockPost(db, data.id);
      if (!(await owns(ctx, data.id, db)))
        throw new AppError("Бұл жазбаға авторлық құқығыңыз жоқ.", 403);
      if (
        (
          await db.query(
            "SELECT id FROM official_replies WHERE feedback_id=$1",
            [data.id],
          )
        ).length
      )
        throw new AppError(
          "Ресми жауаптан кейін жазбаны өзгертуге немесе өшіруге болмайды.",
          409,
        );
      if (name === "editPost") {
        if (!data.title || !data.body)
          throw new AppError("Тақырып пен мәтінді толтырыңыз.");
        await db.query(
          "UPDATE feedback SET title=$2,body=$3,updated_at=now() WHERE id=$1",
          [data.id, data.title, data.body],
        );
        await db.query(
          "INSERT INTO private.jobs(id,kind,subject_id) VALUES($1,'moderation',$2)",
          [randomUUID(), data.id],
        );
      } else await deletePost(db, data.id);
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
    await rateLimit(ctx.db, `comment:${viewer.id}`, 30, 60);
    await ctx.db.transaction(async (db) => {
      const post = await lockPost(db, data.id);
      if (post.hidden)
        throw new AppError("Жасырылған жазбаға пікір қосылмайды.", 403);
      if (
        data.parentId &&
        !(
          await db.query(
            "SELECT id FROM comments WHERE id=$1 AND feedback_id=$2 AND parent_id IS NULL AND NOT deleted",
            [data.parentId, data.id],
          )
        ).length
      )
        throw new AppError("Бір деңгейдегі пікірге ғана жауап беруге болады.");
      const commentId = randomUUID();
      await db.query(
        "INSERT INTO comments(id,feedback_id,profile_id,parent_id,body) VALUES($1,$2,$3,$4,$5)",
        [commentId, data.id, viewer.id, data.parentId, data.body],
      );
      await db.query(
        "INSERT INTO private.jobs(id,kind,subject_id,payload) VALUES($1,'moderation',$2,$3)",
        [randomUUID(), data.id, JSON.stringify({ commentId })],
      );
    });
    return { ok: true };
  }
  if (name === "editComment" || name === "deleteComment") {
    const viewer = requireUser(ctx);
    const data = z
      .object({ id, body: z.string().trim().min(1).max(5000).optional() })
      .parse(input);
    const row = (
      await ctx.db.query<{ feedback_id: string }>(
        "SELECT feedback_id FROM comments WHERE id=$1 AND profile_id=$2 AND NOT deleted",
        [data.id, viewer.id],
      )
    )[0];
    if (!row) throw new AppError("Пікірге құқығыңыз жоқ.", 403);
    await detail(ctx, row.feedback_id);
    if (name === "editComment") {
      if (!data.body) throw new AppError("Пікір мәтінін енгізіңіз.");
      await ctx.db.query(
        "UPDATE comments SET body=$2,updated_at=now() WHERE id=$1",
        [data.id, data.body],
      );
    } else
      await ctx.db.query(
        "UPDATE comments SET deleted=true,body='',updated_at=now() WHERE id=$1",
        [data.id],
      );
    await ctx.db.query(
      "INSERT INTO private.jobs(id,kind,subject_id,payload) VALUES($1,'moderation',$2,$3)",
      [randomUUID(), row.feedback_id, JSON.stringify({ commentId: data.id })],
    );
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
    if (
      !(
        await ctx.db.query("SELECT id FROM teachers WHERE id=$1 AND active", [
          data.id,
        ])
      ).length
    )
      throw new AppError("Оқытушы табылмады.", 404);
    await ctx.db.query(
      "INSERT INTO ratings(profile_id,teacher_id,stars,comment) VALUES($1,$2,$3,$4) ON CONFLICT(profile_id,teacher_id) DO UPDATE SET stars=excluded.stars,comment=excluded.comment,updated_at=now()",
      [viewer.id, data.id, data.stars, data.comment],
    );
    return { ok: true };
  }
  if (name === "officialReply") {
    const viewer = requireManager(ctx);
    const data = z
      .object({ id, body: z.string().trim().min(3).max(10000) })
      .parse(input);
    await ctx.db.transaction(async (db) => {
      await lockPost(db, data.id);
      await db.query(
        "INSERT INTO official_replies(id,feedback_id,profile_id,body) VALUES($1,$2,$3,$4)",
        [randomUUID(), data.id, viewer.id, data.body],
      );
      const author = (
        await db.query<{
          profile_id: string | null;
          recovery_email: string | null;
        }>(
          "SELECT profile_id,recovery_email FROM private.feedback_access WHERE feedback_id=$1",
          [data.id],
        )
      )[0];
      if (author?.profile_id)
        await notify(
          db,
          author.profile_id,
          data.id,
          "Өтінішіңізге ресми жауап берілді",
        );
      if (author?.recovery_email)
        await db.query(
          "INSERT INTO private.jobs(id,kind,subject_id,payload) VALUES($1,'email',$2,$3)",
          [
            randomUUID(),
            data.id,
            await encrypt(
              JSON.stringify({
                to: author.recovery_email,
                subject: "MAXBALL EDTECH: өтінішіңізге жауап берілді",
                text: `Өтінішіңізге ресми жауап берілді. ${process.env.APP_URL || "http://localhost:3000"}/?post=${data.id}`,
              }),
            ),
          ],
        );
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
    await ctx.db.transaction(async (db) => {
      const post = await lockPost(db, data.id);
      if (name === "resolution") {
        if (!(await owns(ctx, data.id, db)))
          throw new AppError("Авторлық қолжетімділік қажет.", 403);
        if (
          post.type !== "issue" ||
          post.status !== "resolved" ||
          typeof data.resolved !== "boolean"
        )
          throw new AppError("Бұл әрекет шешілген мәселеге ғана қолданылады.");
        if (data.resolved) {
          await db.query("UPDATE feedback SET confirmed=true WHERE id=$1", [
            data.id,
          ]);
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
      await db.query(
        "UPDATE feedback SET status=$2,outcome=$3,confirmed=false,resolved_at=CASE WHEN $2='resolved' THEN now() ELSE NULL END,updated_at=now() WHERE id=$1",
        [data.id, data.status, outcome],
      );
      await db.query(
        "INSERT INTO status_history(id,feedback_id,status,outcome) VALUES($1,$2,$3,$4)",
        [randomUUID(), data.id, data.status, outcome],
      );
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
    await ctx.db.transaction(async (db) => {
      await lockPost(db, data.id);
      if (data.mode === "delete") await deletePost(db, data.id);
      else
        await db.query(
          "UPDATE feedback SET hidden=$2,hidden_reason=$3,updated_at=now() WHERE id=$1",
          [
            data.id,
            data.mode === "hide",
            data.mode === "hide" ? data.reason : null,
          ],
        );
    });
    return { ok: true };
  }
  if (name === "readNotifications") {
    const viewer = requireUser(ctx);
    const data = z.object({ id: id.optional() }).parse(input);
    await ctx.db.query(
      "UPDATE private.notifications SET read_at=now() WHERE profile_id=$1 AND read_at IS NULL AND ($2::uuid IS NULL OR id=$2)",
      [viewer.id, data.id || null],
    );
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
      await ctx.db.query("INSERT INTO courses(id,name) VALUES($1,$2)", [
        randomUUID(),
        data.name,
      ]);
    else
      await ctx.db.query(
        "INSERT INTO teachers(id,name,subject) VALUES($1,$2,$3)",
        [randomUUID(), data.name, data.subject],
      );
    return { ok: true };
  }
  if (name === "setRole") {
    const viewer = requireLeadership(ctx);
    const data = z
      .object({ id, role: z.enum(["user", "teacher", "admin", "leadership"]) })
      .parse(input);
    if (data.id === viewer.id)
      throw new AppError("Өз басқару құқығыңызды осы беттен өзгерте алмайсыз.");
    await ctx.db.transaction(async (db) => {
      const person = (
        await db.query<{ name: string; role: string; active: boolean }>(
          "SELECT name,role,active FROM profiles WHERE id=$1 FOR UPDATE",
          [data.id],
        )
      )[0];
      if (!person) throw new AppError("Аккаунт табылмады.", 404);
      await db.query("UPDATE profiles SET role=$2 WHERE id=$1", [
        data.id,
        data.role,
      ]);
      if (data.role === "teacher")
        await db.query(
          "INSERT INTO teachers(id,profile_id,name,subject,active) VALUES($1,$2,$3,'Жалпы курс',$4) ON CONFLICT(profile_id) DO UPDATE SET active=excluded.active",
          [randomUUID(), data.id, person.name, person.active],
        );
      else if (person.role === "teacher")
        await db.query("UPDATE teachers SET active=false WHERE profile_id=$1", [
          data.id,
        ]);
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
    if (data.kind === "course")
      await ctx.db.query("UPDATE courses SET name=$2,active=$3 WHERE id=$1", [
        data.id,
        data.name,
        data.active,
      ]);
    else
      await ctx.db.transaction(async (db) => {
        const record = (
          await db.query<{ profile_id: string | null }>(
            "UPDATE teachers SET name=$2,subject=$3,active=$4 WHERE id=$1 RETURNING profile_id",
            [data.id, data.name, data.subject, data.active],
          )
        )[0];
        if (record?.profile_id)
          await db.query("UPDATE profiles SET name=$2 WHERE id=$1", [
            record.profile_id,
            data.name,
          ]);
      });
    return { ok: true };
  }
  if (name === "setAccountActive") {
    const viewer = requireLeadership(ctx);
    const data = z.object({ id, active: z.boolean() }).parse(input);
    if (data.id === viewer.id)
      throw new AppError("Өз аккаунтыңызды бұғаттай алмайсыз.");
    await ctx.db.transaction(async (db) => {
      await db.query("UPDATE profiles SET active=$2 WHERE id=$1", [
        data.id,
        data.active,
      ]);
      if (!data.active)
        await db.query("DELETE FROM private.sessions WHERE profile_id=$1", [
          data.id,
        ]);
      await db.query(
        "UPDATE teachers SET active=$2 AND EXISTS(SELECT 1 FROM profiles WHERE id=$1 AND role='teacher') WHERE profile_id=$1",
        [data.id, data.active],
      );
    });
    return { ok: true };
  }
  throw new AppError("Белгісіз әрекет.", 404);
}
async function deletePost(db: Database, id: string) {
  const files = await db.query<{ object_path: string }>(
    "SELECT object_path FROM private.attachments WHERE feedback_id=$1",
    [id],
  );
  for (const file of files)
    await db.query(
      "INSERT INTO private.jobs(id,kind,payload) VALUES($1,'deleteFile',$2)",
      [randomUUID(), JSON.stringify({ path: file.object_path })],
    );
  await db.query("DELETE FROM feedback WHERE id=$1", [id]);
}
