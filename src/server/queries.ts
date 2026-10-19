import type { Context } from "./context";
import { requireManager, requireLeadership } from "./context";
import { AppError } from "./security";
import {
  isManager,
  type Boot,
  type Detail,
  type Post,
  type Statistics,
  type Teacher,
  type Viewer,
} from "@/lib/types";

export async function posts(ctx: Context, id?: string): Promise<Post[]> {
  const manager = isManager(ctx.viewer?.role);
  const rows = await ctx.db.query<Record<string, unknown>>(
    `SELECT f.id,f.number,f.type,f.title,f.body,f.course_id,f.teacher_id,c.name AS course,t.name AS teacher,
    f.custom_target,f.anonymous,f.author_name,f.status,f.outcome,f.confirmed,f.hidden,f.hidden_reason,f.created_at,f.updated_at,
    (SELECT count(*)::int FROM supports s WHERE s.feedback_id=f.id) AS supports,
    (SELECT count(*)::int FROM comments c WHERE c.feedback_id=f.id AND NOT c.deleted) AS comments,
    EXISTS(SELECT 1 FROM supports s WHERE s.feedback_id=f.id AND s.profile_id=$1) AS supported,
    EXISTS(SELECT 1 FROM bookmarks b WHERE b.feedback_id=f.id AND b.profile_id=$1) AS saved,
    EXISTS(SELECT 1 FROM official_replies r WHERE r.feedback_id=f.id) AS answered,
    EXISTS(SELECT 1 FROM private.feedback_access a WHERE a.feedback_id=f.id AND
      ((a.profile_id=$1 AND $1 IS NOT NULL) OR EXISTS(SELECT 1 FROM private.guest_grants g WHERE g.feedback_id=f.id AND g.token_hash=$2 AND g.expires_at>now()))) AS owner,
    CASE WHEN $3 THEN EXISTS(SELECT 1 FROM private.moderation_flags m WHERE m.feedback_id=f.id) ELSE false END AS flagged
    FROM feedback f LEFT JOIN courses c ON c.id=f.course_id LEFT JOIN teachers t ON t.id=f.teacher_id
    WHERE NOT f.deleted AND ($4::uuid IS NULL OR f.id=$4) ORDER BY f.created_at DESC`,
    [ctx.viewer?.id || null, ctx.sessionHash, manager, id || null],
  );
  return rows
    .filter((r) => !r.hidden || manager || r.owner)
    .map((r) => ({
      id: String(r.id),
      number: Number(r.number),
      type: r.type as Post["type"],
      title: String(r.title),
      body: String(r.body),
      course: r.course as string | null,
      teacher: r.teacher as string | null,
      courseId: r.course_id as string | null,
      teacherId: r.teacher_id as string | null,
      customTarget: r.custom_target as string | null,
      anonymous: Boolean(r.anonymous),
      authorName: r.anonymous ? "Анонимді автор" : String(r.author_name),
      status: r.status as Post["status"],
      outcome: r.outcome as string | null,
      confirmed: Boolean(r.confirmed),
      hidden: Boolean(r.hidden),
      hiddenReason: r.hidden_reason as string | null,
      createdAt: new Date(r.created_at as string).toISOString(),
      updatedAt: new Date(r.updated_at as string).toISOString(),
      supports: Number(r.supports),
      comments: Number(r.comments),
      supported: Boolean(r.supported),
      saved: Boolean(r.saved),
      isOwner: Boolean(r.owner),
      canEdit: Boolean(r.owner) && !r.answered,
      answered: Boolean(r.answered),
      flagged: Boolean(r.flagged),
    }));
}
export async function detail(ctx: Context, id: string): Promise<Detail> {
  const post = (await posts(ctx, id))[0];
  if (!post) throw new AppError("Жазба табылмады немесе қолжетімсіз.", 404);
  const replies = await ctx.db.query<{
    id: string;
    name: string;
    body: string;
    createdAt: string;
  }>(
    `SELECT r.id,p.name,r.body,r.created_at AS "createdAt" FROM official_replies r JOIN profiles p ON p.id=r.profile_id WHERE r.feedback_id=$1 ORDER BY r.created_at`,
    [id],
  );
  const comments = await ctx.db.query<Detail["comments"][number]>(
    `SELECT c.id,CASE WHEN c.deleted THEN 'Өшірілген пікір' ELSE p.name END AS name,p.role,
    CASE WHEN c.deleted THEN '' ELSE c.body END AS body,c.parent_id AS "parentId",c.profile_id=$2 AS mine,c.deleted,c.created_at AS "createdAt"
    FROM comments c JOIN profiles p ON p.id=c.profile_id WHERE c.feedback_id=$1 ORDER BY c.created_at`,
    [id, ctx.viewer?.id || null],
  );
  const attachments = await ctx.db.query<Detail["attachments"][number]>(
    "SELECT id,name,size::int,mime FROM private.attachments WHERE feedback_id=$1 AND ready ORDER BY created_at",
    [id],
  );
  const history = await ctx.db.query<Detail["history"][number]>(
    `SELECT status,outcome,created_at AS "createdAt" FROM status_history WHERE feedback_id=$1 ORDER BY created_at`,
    [id],
  );
  const contact =
    isManager(ctx.viewer?.role) && !post.anonymous
      ? (
          await ctx.db.query<NonNullable<Detail["contact"]>>(
            "SELECT p.email,p.phone FROM private.feedback_access a JOIN profiles p ON p.id=a.profile_id WHERE a.feedback_id=$1",
            [id],
          )
        )[0] || null
      : null;
  const moderationReasons = isManager(ctx.viewer?.role)
    ? (
        await ctx.db.query<{ reason: string }>(
          "SELECT reason FROM private.moderation_flags WHERE feedback_id=$1",
          [id],
        )
      ).map((r) => r.reason)
    : [];
  return JSON.parse(
    JSON.stringify({
      post,
      contact,
      moderationReasons,
      replies,
      comments,
      attachments,
      history,
    }),
  );
}
export async function teachers(ctx: Context): Promise<Teacher[]> {
  const rows = await ctx.db.query<Teacher>(
    `SELECT t.id,t.name,t.subject,t.color,coalesce(round(avg(r.stars)::numeric,1),0)::float AS average,count(r.stars)::int AS count,
    coalesce((SELECT stars FROM ratings WHERE teacher_id=t.id AND profile_id=$1),0)::int AS "myStars",
    coalesce((SELECT comment FROM ratings WHERE teacher_id=t.id AND profile_id=$1),'') AS "myComment"
    FROM teachers t LEFT JOIN ratings r ON r.teacher_id=t.id WHERE t.active GROUP BY t.id ORDER BY t.name`,
    [ctx.viewer?.id || null],
  );
  const reviews = await ctx.db.query<{
    teacher_id: string;
    name: string;
    stars: number;
    comment: string;
    date: string;
  }>(
    "SELECT r.teacher_id,p.name,r.stars,r.comment,r.updated_at AS date FROM ratings r JOIN profiles p ON p.id=r.profile_id WHERE r.comment<>'' ORDER BY r.updated_at DESC",
  );
  return JSON.parse(
    JSON.stringify(
      rows.map((t) => ({
        ...t,
        reviews: reviews
          .filter((r) => r.teacher_id === t.id)
          .map(({ name, stars, comment, date }) => ({
            name,
            stars,
            comment,
            date,
          })),
      })),
    ),
  );
}
export async function statistics(
  ctx: Context,
  from?: string,
  to?: string,
): Promise<Statistics> {
  requireManager(ctx);
  if (from && to && from > to) throw new AppError("Күн аралығы қате.");
  const filter =
    "NOT deleted AND NOT hidden AND ($1::date IS NULL OR (created_at AT TIME ZONE 'Asia/Almaty')::date >= $1::date) AND ($2::date IS NULL OR (created_at AT TIME ZONE 'Asia/Almaty')::date <= $2::date)";
  const args = [from || null, to || null];
  const totals = (
    await ctx.db.query<{
      total: number;
      resolved: number;
      reviewing: number;
      resolutionHours: number;
    }>(
      `SELECT count(*)::int AS total,
    count(*) FILTER(WHERE type='issue' AND status='resolved')::int AS resolved,
    count(*) FILTER(WHERE status IN ('reviewing','in_progress'))::int AS reviewing,
    coalesce(avg(extract(epoch FROM(resolved_at-created_at))/3600) FILTER(WHERE type='issue' AND status='resolved'),0)::float AS "resolutionHours" FROM feedback WHERE ${filter}`,
      args,
    )
  )[0];
  const monthly = await ctx.db.query<{ month: string; count: number }>(
    `SELECT to_char(created_at AT TIME ZONE 'Asia/Almaty','YYYY-MM') AS month,count(*)::int FROM feedback WHERE ${filter} GROUP BY month ORDER BY month`,
    args,
  );
  const types = await ctx.db.query<{ type: string; count: number }>(
    `SELECT type,count(*)::int FROM feedback WHERE ${filter} GROUP BY type`,
    args,
  );
  const courses = await ctx.db.query<{ name: string; count: number }>(
    `SELECT coalesce(c.name,'Орталық туралы') AS name,count(*)::int FROM feedback f LEFT JOIN courses c ON c.id=f.course_id WHERE NOT f.deleted AND NOT f.hidden AND ($1::date IS NULL OR (f.created_at AT TIME ZONE 'Asia/Almaty')::date >= $1::date) AND ($2::date IS NULL OR (f.created_at AT TIME ZONE 'Asia/Almaty')::date <= $2::date) GROUP BY c.name ORDER BY count DESC`,
    args,
  );
  const instructors = await ctx.db.query<{ name: string; count: number }>(
    `SELECT coalesce(t.name,'Таңдалмаған') AS name,count(*)::int FROM feedback f LEFT JOIN teachers t ON t.id=f.teacher_id WHERE NOT f.deleted AND NOT f.hidden AND ($1::date IS NULL OR (f.created_at AT TIME ZONE 'Asia/Almaty')::date >= $1::date) AND ($2::date IS NULL OR (f.created_at AT TIME ZONE 'Asia/Almaty')::date <= $2::date) GROUP BY t.name ORDER BY count DESC`,
    args,
  );
  const statuses = await ctx.db.query<Statistics["statuses"][number]>(
    `SELECT status,count(*)::int FROM feedback WHERE ${filter} AND status IS NOT NULL GROUP BY status`,
    args,
  );
  const comparison = (
    await ctx.db.query<Statistics["comparison"]>(
      `SELECT count(*) FILTER(WHERE (created_at AT TIME ZONE 'Asia/Almaty') >= date_trunc('month',coalesce($1::date,(now() AT TIME ZONE 'Asia/Almaty')::date)) AND (created_at AT TIME ZONE 'Asia/Almaty') < date_trunc('month',coalesce($1::date,(now() AT TIME ZONE 'Asia/Almaty')::date))+interval '1 month')::int AS current,
    count(*) FILTER(WHERE (created_at AT TIME ZONE 'Asia/Almaty') >= date_trunc('month',coalesce($1::date,(now() AT TIME ZONE 'Asia/Almaty')::date))-interval '1 month' AND (created_at AT TIME ZONE 'Asia/Almaty') < date_trunc('month',coalesce($1::date,(now() AT TIME ZONE 'Asia/Almaty')::date)))::int AS previous FROM feedback WHERE NOT deleted AND NOT hidden`,
      [to || null],
    )
  )[0];
  return {
    ...totals,
    monthly,
    types,
    courses,
    instructors,
    statuses,
    comparison,
  };
}
export async function boot(
  ctx: Context,
  from?: string,
  to?: string,
): Promise<Boot> {
  const [feed, courses, instructors] = await Promise.all([
    posts(ctx),
    ctx.db.query<{ id: string; name: string }>(
      "SELECT id,name FROM courses WHERE active ORDER BY name",
    ),
    teachers(ctx),
  ]);
  const notifications = ctx.viewer
    ? await ctx.db.query<Boot["notifications"][number]>(
        `SELECT n.id,n.feedback_id AS "feedbackId",n.title,(n.read_at IS NOT NULL) AS read,n.created_at AS "createdAt" FROM private.notifications n WHERE n.profile_id=$1 ORDER BY n.created_at DESC LIMIT 100`,
        [ctx.viewer.id],
      )
    : [];
  const staff =
    ctx.viewer?.role === "leadership"
      ? await ctx.db.query<Viewer>(
          "SELECT id,name,email,phone,role,verified,active FROM profiles ORDER BY active DESC,created_at",
        )
      : [];
  const catalog =
    ctx.viewer?.role === "leadership"
      ? {
          courses: await ctx.db.query(
            "SELECT id,name,active FROM courses ORDER BY name",
          ),
          teachers: await ctx.db.query(
            "SELECT id,name,subject,active FROM teachers ORDER BY name",
          ),
        }
      : null;
  return JSON.parse(
    JSON.stringify({
      viewer: ctx.viewer,
      demo: ctx.demo,
      posts: feed,
      courses,
      teachers: instructors,
      notifications,
      staff,
      catalog,
      stats: isManager(ctx.viewer?.role)
        ? await statistics(ctx, from, to)
        : null,
      integrations: isManager(ctx.viewer?.role)
        ? {
            email: Boolean(process.env.SMTP_PASS),
            ai: Boolean(
              process.env.AI_API_KEY &&
              process.env.AI_API_URL &&
              process.env.AI_MODEL,
            ),
            storage: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
          }
        : null,
    }),
  );
}
export async function accessibleAttachment(ctx: Context, id: string) {
  const row = (
    await ctx.db.query<{
      id: string;
      feedback_id: string | null;
      token_hash: string;
      name: string;
      mime: string;
      object_path: string;
      size: number;
    }>(
      "SELECT id,feedback_id,token_hash,name,mime,object_path,size FROM private.attachments WHERE id=$1 AND ready",
      [id],
    )
  )[0];
  if (!row) throw new AppError("Файл табылмады.", 404);
  if (row.feedback_id) await detail(ctx, row.feedback_id);
  else if (row.token_hash !== ctx.sessionHash)
    throw new AppError("Файл қолжетімсіз.", 403);
  return row;
}
