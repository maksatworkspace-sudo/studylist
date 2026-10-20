import type { Context } from "./context";
import { requireManager } from "./context";
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
import type { Row } from "./store/types";

const iso = (value: unknown) => new Date(String(value)).toISOString();

export async function posts(ctx: Context, id?: string): Promise<Post[]> {
  const manager = isManager(ctx.viewer?.role);
  const repo = ctx.store;
  const [feedback, courses, teachers, supports, comments, bookmarks, replies, access, grants, flags] =
    await Promise.all([
      repo.all("feedback"),
      repo.all("courses"),
      repo.all("teachers"),
      repo.all("supports"),
      repo.all("comments"),
      repo.all("bookmarks"),
      repo.all("official_replies"),
      repo.all("feedback_access"),
      repo.all("guest_grants"),
      manager ? repo.all("moderation_flags") : Promise.resolve([] as Row[]),
    ]);
  const now = Date.now();
  return feedback
    .filter((f) => !f.deleted && (!id || f.id === id))
    .sort((a, b) => Date.parse(iso(b.created_at)) - Date.parse(iso(a.created_at)))
    .map((f) => {
      const accountOwner = Boolean(
        ctx.viewer && access.some((a) => a.feedback_id === f.id && a.profile_id === ctx.viewer!.id),
      );
      const owner =
        accountOwner ||
        grants.some(
          (g) =>
            g.feedback_id === f.id &&
            g.token_hash === ctx.sessionHash &&
            Date.parse(iso(g.expires_at)) > now,
        );
      return {
        id: String(f.id),
        number: Number(f.number),
        type: f.type as Post["type"],
        title: String(f.title),
        body: String(f.body),
        course:
          (courses.find((c) => c.id === f.course_id)?.name as string) ?? null,
        teacher:
          (teachers.find((t) => t.id === f.teacher_id)?.name as string) ?? null,
        courseId: (f.course_id as string) ?? null,
        teacherId: (f.teacher_id as string) ?? null,
        customTarget: (f.custom_target as string) ?? null,
        anonymous: Boolean(f.anonymous),
        authorName: f.anonymous ? "Анонимді автор" : String(f.author_name),
        status: (f.status as Post["status"]) ?? null,
        outcome: (f.outcome as string) ?? null,
        confirmed: Boolean(f.confirmed),
        hidden: Boolean(f.hidden),
        hiddenReason: (f.hidden_reason as string) ?? null,
        createdAt: iso(f.created_at),
        updatedAt: iso(f.updated_at),
        supports: supports.filter((s) => s.feedback_id === f.id).length,
        comments: comments.filter(
          (c) => c.feedback_id === f.id && !c.deleted,
        ).length,
        supported:
          !!ctx.viewer &&
          supports.some(
            (s) => s.feedback_id === f.id && s.profile_id === ctx.viewer!.id,
          ),
        saved:
          !!ctx.viewer &&
          bookmarks.some(
            (b) => b.feedback_id === f.id && b.profile_id === ctx.viewer!.id,
          ),
        isAccountOwner: accountOwner,
        isOwner: Boolean(owner),
        canEdit: Boolean(owner) && !replies.some((r) => r.feedback_id === f.id),
        answered: replies.some((r) => r.feedback_id === f.id),
        flagged: manager && flags.some((m) => m.feedback_id === f.id),
      } satisfies Post;
    })
    .filter((p) => !p.hidden || manager || p.isOwner);
}
export async function detail(ctx: Context, id: string): Promise<Detail> {
  const post = (await posts(ctx, id))[0];
  if (!post) throw new AppError("Жазба табылмады немесе қолжетімсіз.", 404);
  const repo = ctx.store;
  const [profiles, replies, comments, attachments, history, access, flags] =
    await Promise.all([
      repo.all("profiles"),
      repo.all("official_replies"),
      repo.all("comments"),
      repo.all("attachments"),
      repo.all("status_history"),
      repo.all("feedback_access"),
      isManager(ctx.viewer?.role)
        ? repo.all("moderation_flags")
        : Promise.resolve([] as Row[]),
    ]);
  const byTime = (a: Row, b: Row) =>
    Date.parse(iso(a.created_at)) - Date.parse(iso(b.created_at));
  const contactRow = access.find((a) => a.feedback_id === id);
  const author = contactRow?.profile_id
    ? profiles.find((p) => p.id === contactRow.profile_id)
    : undefined;
  return JSON.parse(
    JSON.stringify({
      post,
      contact:
        isManager(ctx.viewer?.role) && !post.anonymous && author
          ? { email: String(author.email), phone: String(author.phone) }
          : null,
      moderationReasons: isManager(ctx.viewer?.role)
        ? flags.filter((f) => f.feedback_id === id).map((f) => String(f.reason))
        : [],
      replies: replies
        .filter((r) => r.feedback_id === id)
        .sort(byTime)
        .map((r) => ({
          id: String(r.id),
          name: String(profiles.find((p) => p.id === r.profile_id)?.name),
          body: String(r.body),
          createdAt: iso(r.created_at),
        })),
      comments: comments
        .filter((c) => c.feedback_id === id)
        .sort(byTime)
        .map((c) => {
          const profile = profiles.find((p) => p.id === c.profile_id);
          return {
            id: String(c.id),
            name: c.deleted ? "Өшірілген пікір" : String(profile?.name),
            role: profile?.role as Detail["comments"][number]["role"],
            body: c.deleted ? "" : String(c.body),
            parentId: (c.parent_id as string) ?? null,
            mine: !!ctx.viewer && c.profile_id === ctx.viewer.id,
            deleted: Boolean(c.deleted),
            createdAt: iso(c.created_at),
          };
        }),
      attachments: attachments
        .filter((a) => a.feedback_id === id && a.ready)
        .sort(byTime)
        .map((a) => ({
          id: String(a.id),
          name: String(a.name),
          size: Number(a.size),
          mime: String(a.mime),
        })),
      history: history
        .filter((h) => h.feedback_id === id)
        .sort(byTime)
        .map((h) => ({
          status: h.status as Detail["history"][number]["status"],
          outcome: (h.outcome as string) ?? null,
          createdAt: iso(h.created_at),
        })),
    }),
  );
}
export async function teachers(ctx: Context): Promise<Teacher[]> {
  const repo = ctx.store;
  const [rows, ratings, profiles] = await Promise.all([
    repo.all("teachers"),
    repo.all("ratings"),
    repo.all("profiles"),
  ]);
  return JSON.parse(
    JSON.stringify(
      rows
        .filter((t) => t.active)
        .sort((a, b) => String(a.name).localeCompare(String(b.name)))
        .map((t) => {
          const mine = ctx.viewer
            ? ratings.find(
                (r) => r.teacher_id === t.id && r.profile_id === ctx.viewer!.id,
              )
            : undefined;
          const all = ratings.filter((r) => r.teacher_id === t.id);
          return {
            id: String(t.id),
            name: String(t.name),
            subject: String(t.subject),
            color: String(t.color),
            average:
              all.length === 0
                ? 0
                : Math.round(
                    (all.reduce((sum, r) => sum + Number(r.stars), 0) / all.length) * 10,
                  ) / 10,
            count: all.length,
            myStars: mine ? Number(mine.stars) : 0,
            myComment: mine ? String(mine.comment) : "",
            reviews: ratings
              .filter((r) => r.teacher_id === t.id && r.comment !== "")
              .sort(
                (a, b) =>
                  Date.parse(iso(b.updated_at)) - Date.parse(iso(a.updated_at)),
              )
              .map((r) => ({
                name: String(profiles.find((p) => p.id === r.profile_id)?.name),
                stars: Number(r.stars),
                comment: String(r.comment),
                date: iso(r.updated_at),
              })),
          } satisfies Teacher;
        }),
    ),
  );
}

/** Kazakhstan (Almaty) is a fixed UTC+06:00 offset. */
const ALMATY_OFFSET_MS = 6 * 3_600_000;
function almatyDay(value: string): string {
  return new Date(Date.parse(value) + ALMATY_OFFSET_MS).toISOString().slice(0, 10);
}
function almatyMonth(value: string): string {
  return new Date(Date.parse(value) + ALMATY_OFFSET_MS).toISOString().slice(0, 7);
}

export async function statistics(
  ctx: Context,
  from?: string,
  to?: string,
): Promise<Statistics> {
  requireManager(ctx);
  if (from && to && from > to) throw new AppError("Күн аралығы қате.");
  const feedback = (await ctx.store.all("feedback")).filter(
    (f) =>
      !f.deleted &&
      !f.hidden &&
      (!from || almatyDay(iso(f.created_at)) >= from) &&
      (!to || almatyDay(iso(f.created_at)) <= to),
  );
  const [courses, teachers] = await Promise.all([
    ctx.store.all("courses"),
    ctx.store.all("teachers"),
  ]);
  const inRange = feedback;
  const resolved = inRange.filter(
    (f) => f.type === "issue" && f.status === "resolved",
  );
  const reviewing = inRange.filter((f) =>
    ["reviewing", "in_progress"].includes(String(f.status)),
  );
  const monthOf = (date: string) => almatyMonth(date);
  const anchor = to ? monthOf(`${to}T00:00:00.000Z`) : monthOf(new Date().toISOString());
  const monthStart = (month: string) =>
    Date.parse(`${month}-01T00:00:00.000Z`) - ALMATY_OFFSET_MS;
  const allVisible = (await ctx.store.all("feedback")).filter(
    (f) => !f.deleted && !f.hidden,
  );
  const group = <T extends string>(values: T[]) => {
    const map = new Map<T, number>();
    for (const value of values) map.set(value, (map.get(value) ?? 0) + 1);
    return map;
  };
  const monthly = [...group(inRange.map((f) => monthOf(iso(f.created_at))))]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, count]) => ({ month, count }));
  const typesMap = group(inRange.map((f) => String(f.type)));
  const statusesMap = group(
    inRange.filter((f) => f.status !== null).map((f) => String(f.status)),
  );
  const courseGroups = group(
    inRange.map(
      (f) =>
        (courses.find((c) => c.id === f.course_id)?.name as string) ??
        "Орталық туралы",
    ),
  );
  const teacherGroups = group(
    inRange.map(
      (f) =>
        (teachers.find((t) => t.id === f.teacher_id)?.name as string) ??
        "Таңдалмаған",
    ),
  );
  const rank = (map: Map<string, number>) =>
    [...map].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  const anchorStart = monthStart(anchor);
  return {
    total: inRange.length,
    resolved: resolved.length,
    reviewing: reviewing.length,
    resolutionHours:
      resolved.length === 0
        ? 0
        : Math.round(
            (resolved.reduce(
              (sum, f) =>
                sum +
                (Date.parse(iso(f.resolved_at)) - Date.parse(iso(f.created_at))) /
                  3_600_000,
              0,
            ) /
              resolved.length) *
              100,
          ) / 100,
    monthly,
    types: [...typesMap].map(([type, count]) => ({ type, count })),
    courses: rank(courseGroups),
    instructors: rank(teacherGroups),
    statuses: [...statusesMap].map(([status, count]) => ({
      status: status as Statistics["statuses"][number]["status"],
      count,
    })),
    comparison: {
      current: allVisible.filter(
        (f) =>
          Date.parse(iso(f.created_at)) >= anchorStart &&
          Date.parse(iso(f.created_at)) < anchorStart + 31 * 86400_000 &&
          monthOf(iso(f.created_at)) === anchor,
      ).length,
      previous: allVisible.filter(
        (f) => monthOf(iso(f.created_at)) === previousMonth(anchor),
      ).length,
    },
  };
}
function previousMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 1
    ? `${year - 1}-12`
    : `${year}-${String(m - 1).padStart(2, "0")}`;
}
export async function boot(
  ctx: Context,
  from?: string,
  to?: string,
): Promise<Boot> {
  const repo = ctx.store;
  const [feed, courses, instructors, notifications, staff, catalogCourses, catalogTeachers] =
    await Promise.all([
      posts(ctx),
      repo.all("courses"),
      teachers(ctx),
      ctx.viewer
        ? repo.find("notifications", { profile_id: ctx.viewer.id })
        : Promise.resolve([] as Row[]),
      ctx.viewer?.role === "leadership"
        ? repo.all("profiles")
        : Promise.resolve([] as Row[]),
      ctx.viewer?.role === "leadership"
        ? repo.all("courses")
        : Promise.resolve([] as Row[]),
      ctx.viewer?.role === "leadership"
        ? repo.all("teachers")
        : Promise.resolve([] as Row[]),
    ]);
  return JSON.parse(
    JSON.stringify({
      viewer: ctx.viewer,
      demo: ctx.demo,
      posts: feed,
      courses: courses
        .filter((c) => c.active)
        .sort((a, b) => String(a.name).localeCompare(String(b.name)))
        .map((c) => ({ id: String(c.id), name: String(c.name) })),
      teachers: instructors,
      notifications: notifications
        .sort(
          (a, b) =>
            Date.parse(iso(b.created_at)) - Date.parse(iso(a.created_at)),
        )
        .slice(0, 100)
        .map((n) => ({
          id: String(n.id),
          feedbackId: (n.feedback_id as string) ?? null,
          title: String(n.title),
          read: n.read_at !== null && n.read_at !== undefined,
          createdAt: iso(n.created_at),
        })),
      staff:
        ctx.viewer?.role === "leadership"
          ? staff
              .sort((a, b) =>
                Number(b.active) - Number(a.active) ||
                Date.parse(iso(a.created_at)) - Date.parse(iso(b.created_at)),
              )
              .map((p) => ({
                id: String(p.id),
                name: String(p.name),
                email: String(p.email),
                phone: String(p.phone),
                role: p.role as Viewer["role"],
                verified: Boolean(p.verified),
                active: Boolean(p.active),
              }))
          : [],
      catalog:
        ctx.viewer?.role === "leadership"
          ? {
              courses: catalogCourses
                .sort((a, b) => String(a.name).localeCompare(String(b.name)))
                .map((c) => ({
                  id: String(c.id),
                  name: String(c.name),
                  active: Boolean(c.active),
                })),
              teachers: catalogTeachers
                .sort((a, b) => String(a.name).localeCompare(String(b.name)))
                .map((t) => ({
                  id: String(t.id),
                  name: String(t.name),
                  subject: String(t.subject),
                  active: Boolean(t.active),
                })),
            }
          : null,
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
  const row = await ctx.store.get("attachments", id);
  if (!row || !row.ready) throw new AppError("Файл табылмады.", 404);
  if (row.feedback_id) await detail(ctx, String(row.feedback_id));
  else if (row.token_hash !== ctx.sessionHash)
    throw new AppError("Файл қолжетімсіз.", 403);
  return {
    id: String(row.id),
    feedback_id: (row.feedback_id as string) ?? null,
    token_hash: String(row.token_hash),
    name: String(row.name),
    mime: String(row.mime),
    object_path: String(row.object_path),
    size: Number(row.size),
  };
}
