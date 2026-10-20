import { z } from "zod";
import type { Boot, Comment, Detail, Post, Role, Statistics, Teacher, Viewer } from "@/lib/types";
import { isManager } from "@/lib/types";
import type { AppService, DateRange, Result } from "./types";
import { ServiceError } from "./types";

type Person = Viewer & { active: boolean; password: string };
type Entry = {
  post: Post; owner: string | null; email: string; code: string | null;
  supports: Set<string>; bookmarks: Set<string>;
  replies: Detail["replies"]; history: Detail["history"];
  comments: (Comment & { owner: string })[];
};
type CatalogTeacher = { id: string; name: string; subject: string; active: boolean; color: string; profileId?: string };
type Rating = { teacher: string; person: string; stars: number; comment: string; date: string };
type FileRecord = { id: string; name: string; size: number; mime: string; blob?: Blob; post: string | null };
type Proof = { kind: "verify" | "password" | "guest"; subject: string };
const roles = ["user", "teacher", "admin", "leadership"] as const;
const timestamp = "2026-10-20T09:00:00.000Z";
export const mockId = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
export const MOCK_PASSWORD = "Mock-Only-2026";
const clone = <T>(value: T): T => structuredClone(value);
const text = (value: unknown, min = 1, max = 100) => z.string().trim().min(min).max(max).parse(value);
const uuid = (value: unknown) => z.uuid().parse(value);
const email = (value: unknown) => z.email().parse(text(value, 1, 254)).toLowerCase();
const bool = (value: unknown) => z.boolean().parse(value);
const fail = (message: string, status = 400): never => { throw new ServiceError(message, status); };
const group = <T>(items: T[], key: (item: T) => string) => {
  const result = new Map<string, number>();
  for (const item of items) result.set(key(item), (result.get(key(item)) || 0) + 1);
  return [...result].map(([name, count]) => ({ name, count }));
};

export type MockOptions = { empty?: boolean; latencyMs?: number };
export interface MockService extends AppService {
  reset(): void;
  failNext(operation: string, message?: string, status?: number): void;
}

// This store belongs to one frontend preview. Reloading discards it; it is not backend persistence.
export function createMockService(options: MockOptions = {}): MockService {
  let sequence: number;
  let viewerId: string | null;
  let people: Person[];
  let courses: { id: string; name: string; active: boolean }[];
  let catalog: CatalogTeacher[];
  let entries: Entry[];
  let ratings: Rating[];
  let files: FileRecord[];
  let notices: (Boot["notifications"][number] & { owner: string })[];
  let grants: Set<string>;
  let proofs: Map<string, Proof>;
  let requests: Map<string, Result>;
  let failures: Map<string, ServiceError[]>;
  const nextId = () => mockId(++sequence);
  function reset() {
    sequence = 10000;
    viewerId = null;
    people = roles.map((role, i) => ({
      id: mockId(i + 1), name: ["Айдана Сынақ", "Дана Үлгі", "Әкімші Сынақ", "Басшы Үлгі"][i],
      email: `${role}@maxball.example`, phone: `+7000000000${i + 1}`,
      role, verified: true, active: true, password: MOCK_PASSWORD,
    }));
    courses = options.empty ? [] : [
      { id: mockId(101), name: "Математикалық сауаттылық", active: true },
      { id: mockId(102), name: "Ағылшын тілі", active: true },
    ];
    catalog = options.empty ? [] : [
      { id: mockId(201), name: "Дана Үлгі", subject: "Математика", active: true, color: "mint", profileId: mockId(2) },
      { id: mockId(202), name: "Аружан Мысал", subject: "Ағылшын тілі", active: true, color: "rose" },
    ];
    entries = options.empty ? [] : ([
      ["suggestion", "Апталық ашық сұрақ-жауап кездесуін өткізсек", "Сабақтан кейін қалған сұрақтарды бірге талқылайтын кездесу ұйымдастыруды ұсынамын."],
      ["opinion", "Түсінікті сабақтар үшін рақмет", "Математикадағы күрделі тақырыптар мысалдар арқылы түсінікті болды. Сабаққа қызығушылығым артты."],
      ["issue", "Кітапханадағы жарық жөнделсе", "Кешкі уақытта кітапханадағы үстел шамы жанбайды. Осы мәселені тексеруіңізді сұраймын."],
    ] as const).map(([type, title, body], i) => {
      const status = type === "suggestion" ? "in_progress" : type === "issue" ? "new" : null;
      const post: Post = {
        id: mockId(1001 + i), number: 1001 + i, type, title, body,
        course: courses[0].name, courseId: courses[0].id,
        teacher: catalog[0].name, teacherId: catalog[0].id, customTarget: null,
        anonymous: i === 2, authorName: i === 2 ? "Анонимді автор" : people[0].name,
        status, outcome: null, confirmed: false, hidden: false, hiddenReason: null,
        createdAt: `2026-10-${String(18 + i).padStart(2, "0")}T09:00:00.000Z`, updatedAt: timestamp,
        supports: 0, comments: 0, supported: false, saved: false, isOwner: false,
        canEdit: false, answered: false, flagged: false,
      };
      return { post, owner: people[0].id, email: people[0].email, code: null,
        supports: new Set<string>(), bookmarks: new Set<string>(), replies: [], comments: [],
        history: status ? [{ status, outcome: null, createdAt: post.createdAt }] : [] };
    });
    ratings = options.empty ? [] : [
      { teacher: mockId(201), person: mockId(1), stars: 5, comment: "Тақырыптарды түсінікті жеткізеді.", date: timestamp },
    ];
    files = [];
    notices = options.empty ? [] : [{
      id: mockId(301), owner: mockId(1), feedbackId: mockId(1001),
      title: "MAXBALL сынақ ортасына қош келдіңіз", read: false, createdAt: timestamp,
    }];
    grants = new Set(); proofs = new Map(); requests = new Map(); failures = new Map();
  }
  reset();
  const viewer = () => people.find((p) => p.id === viewerId && p.active) || null;
  const publicPerson = ({ password: _password, ...person }: Person): Viewer => clone(person);
  const user = () => {
    const person = viewer();
    if (!person?.verified) fail("Бұл әрекет үшін расталған аккаунтқа кіріңіз.", 401);
    return person!;
  };
  const manager = () => {
    const person = user();
    if (!isManager(person.role)) fail("Бұл әрекетке құқығыңыз жоқ.", 403);
    return person;
  };
  const leadership = () => {
    const person = manager();
    if (person.role !== "leadership") fail("Бұл әрекет тек басшылыққа қолжетімді.", 403);
    return person;
  };
  const owned = (entry: Entry) => Boolean(entry.owner && entry.owner === viewer()?.id || grants.has(entry.post.id));
  function entry(id: unknown, checkVisibility = true): Entry {
    const result = entries.find((e) => e.post.id === uuid(id));
    if (!result || checkVisibility && result.post.hidden && !owned(result) && !isManager(viewer()?.role))
      fail("Жазба табылмады немесе қолжетімсіз.", 404);
    return result!;
  }
  function project(item: Entry): Post {
    const person = viewer();
    const course = courses.find((c) => c.id === item.post.courseId);
    const teacher = catalog.find((t) => t.id === item.post.teacherId);
    return clone({ ...item.post,
      course: course?.name || null, teacher: teacher?.name || null,
      authorName: item.post.anonymous ? "Анонимді автор" : item.post.authorName,
      supports: item.supports.size, comments: item.comments.filter((c) => !c.deleted).length,
      supported: Boolean(person && item.supports.has(person.id)), saved: Boolean(person && item.bookmarks.has(person.id)),
      isOwner: owned(item), canEdit: owned(item) && !item.replies.length,
      answered: Boolean(item.replies.length), flagged: isManager(person?.role) && item.post.flagged,
    });
  }
  function instructors(): Teacher[] {
    return catalog.filter((t) => t.active).map((teacher) => {
      const votes = ratings.filter((r) => r.teacher === teacher.id);
      const mine = votes.find((r) => r.person === viewer()?.id);
      return { id: teacher.id, name: teacher.name, subject: teacher.subject, color: teacher.color,
        average: votes.length ? Math.round(votes.reduce((n, r) => n + r.stars, 0) / votes.length * 10) / 10 : 0,
        count: votes.length, myStars: mine?.stars || 0, myComment: mine?.comment || "",
        reviews: votes.filter((r) => r.comment).map((r) => ({
          name: people.find((p) => p.id === r.person)!.name, stars: r.stars, comment: r.comment, date: r.date,
        })),
      };
    });
  }
  function rangeDates(range: DateRange = {}) {
    const schema = z.iso.date().optional();
    schema.parse(range.from || undefined); schema.parse(range.to || undefined);
    if (range.from && range.to && range.from > range.to) fail("Күн аралығы қате.");
    return range;
  }
  function statistics(range: DateRange = {}): Statistics {
    manager(); rangeDates(range);
    const rows = entries.map((e) => project(e)).filter((p) => {
      const date = p.createdAt.slice(0, 10);
      return !p.hidden && (!range.from || date >= range.from) && (!range.to || date <= range.to);
    });
    const month = (range.to || timestamp).slice(0, 7);
    const previous = new Date(`${month}-01T00:00:00Z`);
    previous.setUTCMonth(previous.getUTCMonth() - 1);
    return {
      total: rows.length, resolved: rows.filter((p) => p.type === "issue" && p.status === "resolved").length,
      reviewing: rows.filter((p) => ["reviewing", "in_progress"].includes(p.status || "")).length,
      resolutionHours: 0,
      monthly: group(rows, (p) => p.createdAt.slice(0, 7)).map(({ name, count }) => ({ month: name, count })),
      types: group(rows, (p) => p.type).map(({ name, count }) => ({ type: name, count })),
      courses: group(rows, (p) => p.course || "Орталық туралы"),
      instructors: group(rows, (p) => p.teacher || "Таңдалмаған"),
      statuses: group(rows.filter((p) => p.status), (p) => p.status!).map(({ name, count }) => ({ status: name as NonNullable<Post["status"]>, count })),
      comparison: {
        current: rows.filter((p) => p.createdAt.startsWith(month)).length,
        previous: rows.filter((p) => p.createdAt.startsWith(previous.toISOString().slice(0, 7))).length,
      },
    };
  }
  function detail(id: string): Detail {
    const item = entry(id);
    const person = people.find((p) => p.id === item.owner);
    return clone({ post: project(item),
      contact: isManager(viewer()?.role) && !item.post.anonymous && person ? { email: person.email, phone: person.phone } : null,
      moderationReasons: isManager(viewer()?.role) && item.post.flagged ? ["Сынақ модерация белгісі"] : [],
      replies: item.replies,
      comments: item.comments.map(({ owner, ...comment }) => ({ ...comment, mine: owner === viewer()?.id,
        name: comment.deleted ? "Өшірілген пікір" : people.find((p) => p.id === owner)!.name,
        body: comment.deleted ? "" : comment.body })),
      attachments: files.filter((f) => f.post === id && f.blob).map(({ id, name, size, mime }) => ({ id, name, size, mime })),
      history: item.history,
    });
  }
  function notify(owner: string, feedbackId: string, title: string) {
    notices.unshift({ id: nextId(), owner, feedbackId, title, read: false, createdAt: timestamp });
  }
  function proof(kind: Proof["kind"], subject: string): Result {
    const localToken = `mock-${kind}-${nextId()}`;
    proofs.set(localToken, { kind, subject });
    return { ok: true, localToken, tokenPurpose: kind,
      message: "Уақытша сынақ сілтемесі дайын. Нақты хат жіберілген жоқ." };
  }
  function consume(value: unknown, kind: Proof["kind"]) {
    const key = text(value, 10, 200);
    const result = proofs.get(key);
    if (!result || result.kind !== kind) fail("Сілтеме жарамсыз немесе мерзімі аяқталған.");
    proofs.delete(key);
    return result!;
  }
  function mutate(name: string, d: Record<string, unknown>): Result {
    // Session rotation (any login or logout) ends anonymous ownership: guest
    // grants belong to the session that earned them, never to the account.
    const rotate = () => grants.clear();
    if (name === "demoLogin") {
      const role = z.enum(roles).parse(d.role);
      const person = people.find((p) => p.role === role && p.active);
      if (!person) fail("Сынақ аккаунты қолжетімсіз.", 404);
      rotate(); viewerId = person!.id; return { ok: true };
    }
    if (name === "logout") { rotate(); viewerId = null; return { ok: true }; }
    if (name === "login") {
      const address = email(d.email); const password = text(d.password, 1, 128);
      const person = people.find((p) => p.email === address && p.password === password && p.active);
      if (!person?.verified) fail("Email, құпиясөз немесе email растауын тексеріңіз.", 401);
      rotate(); viewerId = person!.id; return { ok: true };
    }
    if (name === "register" || name === "createStaff") {
      if (name === "createStaff") leadership();
      const address = email(d.email); const personName = text(d.name, 2); const phone = text(d.phone, 8, 30);
      const password = name === "register" ? text(d.password, 10, 128) : MOCK_PASSWORD;
      const role = name === "register" ? "user" : z.enum(roles).parse(d.role);
      const subject = text(d.subject ?? "Жалпы курс", 0);
      if (people.some((p) => p.email === address)) fail("Бұл email тіркелген.", 409);
      const person: Person = { id: nextId(), name: personName, email: address, phone,
        role, active: true, verified: name === "createStaff", password };
      people.push(person);
      if (role === "teacher") catalog.push({ id: nextId(), name: personName, subject, active: true, color: "blue", profileId: person.id });
      if (name === "createStaff") return { ok: true, message: "Уақытша сынақ аккаунты қосылды. Нақты шақыру жіберілген жоқ." };
      viewerId = person.id; return proof("verify", person.id);
    }
    if (name === "resendConfirmation" || name === "forgotPassword") {
      const address = email(d.email);
      const person = people.find((p) => p.email === address && p.active && (name !== "resendConfirmation" || !p.verified));
      return person ? proof(name === "forgotPassword" ? "password" : "verify", person.id)
        : { ok: true, message: "Сынақ аккаунты табылса, уақытша сілтеме дайындалады. Нақты хат жіберілмейді." };
    }
    if (name === "confirmEmail" || name === "resetPassword") {
      const password = name === "resetPassword" ? text(d.password, 10, 128) : null;
      const token = consume(d.token, name === "confirmEmail" ? "verify" : "password");
      const person = people.find((p) => p.id === token.subject && p.active);
      if (!person) fail("Аккаунт табылмады.", 404);
      if (password) person!.password = password; else person!.verified = true;
      viewerId = person!.id; return { ok: true };
    }
    if (name === "exchangeSession") fail("Сыртқы кіру mock режимінде қолжетімсіз.", 503);
    if (name === "updateProfile") {
      const person = user(); const newName = text(d.name, 2); const phone = text(d.phone, 8, 30);
      person.name = newName; person.phone = phone;
      catalog.filter((t) => t.profileId === person.id).forEach((t) => { t.name = newName; });
      return { ok: true };
    }
    if (name === "createPost") {
      const requestId = uuid(d.requestId);
      const key = `${viewer()?.id || "guest"}:${requestId}`;
      const previous = requests.get(key);
      if (previous) return { ok: true, id: previous.id, number: previous.number, duplicate: true };
      const type = z.enum(["opinion", "suggestion", "issue"]).parse(d.type);
      const title = text(d.title, 3, 160); const body = text(d.body, 10, 10000); const anonymous = bool(d.anonymous);
      const author = text(d.authorName ?? "", 0); const address = d.email ? email(d.email) : "";
      if (!anonymous && !viewer() && !author) fail("Атыңызды енгізіңіз немесе анонимді жариялауды таңдаңыз.");
      const courseId = d.courseId == null ? null : uuid(d.courseId);
      const teacherId = d.teacherId == null ? null : uuid(d.teacherId);
      if (courseId && !courses.some((c) => c.id === courseId && c.active)) fail("Курс табылмады.", 404);
      if (teacherId && !catalog.some((t) => t.id === teacherId && t.active)) fail("Оқытушы табылмады.", 404);
      const customTarget = text(d.customTarget ?? "", 0, 160) || null;
      const ids = z.array(z.uuid()).max(5).parse(d.attachments ?? []);
      const attachments = files.filter((f) => ids.includes(f.id) && !f.post && f.blob);
      if (attachments.length !== new Set(ids).size || attachments.reduce((n, f) => n + f.size, 0) > 20971520)
        fail("Файлдардың жүктелуі мен жалпы 20 МБ шегін тексеріңіз.");
      const id = nextId(); const number = Math.max(1000, ...entries.map((e) => e.post.number)) + 1;
      const code = viewer() ? null : `MOCK-${nextId()}`;
      const status = type === "issue" ? "new" : type === "suggestion" ? "in_progress" : null;
      const item: Entry = { owner: viewer()?.id || null, email: viewer()?.email || address, code,
        supports: new Set(), bookmarks: new Set(), replies: [], comments: [],
        history: status ? [{ status, outcome: null, createdAt: timestamp }] : [],
        post: { id, number, type, title, body, anonymous, courseId, teacherId, customTarget,
          course: null, teacher: null, authorName: anonymous ? "Анонимді автор" : viewer()?.name || author,
          status, outcome: null, confirmed: false, hidden: false, hiddenReason: null,
          createdAt: timestamp, updatedAt: timestamp, supports: 0, comments: 0, supported: false,
          saved: false, isOwner: true, canEdit: true, answered: false, flagged: false } };
      entries.unshift(item); if (code) grants.add(id);
      attachments.forEach((f) => { f.post = id; });
      people.filter((p) => p.active && isManager(p.role)).forEach((p) => notify(p.id, id, "Жаңа кері байланыс түсті"));
      const result = { ok: true, id, number, code }; requests.set(key, result); return result;
    }
    if (name === "unlockPost") {
      const number = z.coerce.number().int().positive().parse(d.number); const code = text(d.code, 1, 200);
      const item = entries.find((e) => e.post.number === number && e.code === code);
      if (!item) fail("Өтініш нөмірі немесе құпия код қате.", 401);
      grants.add(item!.post.id); return { ok: true, id: item!.post.id };
    }
    if (name === "recoverPost") {
      const address = email(d.email); const item = entries.find((e) => e.email === address && !e.owner);
      return item ? proof("guest", item.post.id) : { ok: true, message: "Email алдын ала қалдырылған болса, сынақ сілтемесі дайындалады. Нақты хат жіберілмейді." };
    }
    if (name === "resetGuestCode") {
      const token = consume(d.token, "guest"); const item = entry(token.subject, false);
      item.code = `MOCK-${nextId()}`; grants.add(item.post.id);
      return { ok: true, id: item.post.id, number: item.post.number, code: item.code };
    }
    if (["toggleSupport", "toggleBookmark", "editPost", "deletePost", "comment", "officialReply", "setStatus", "resolution", "moderate"].includes(name)) {
      if (["officialReply", "setStatus", "moderate"].includes(name)) manager();
      if (["toggleSupport", "toggleBookmark", "comment"].includes(name)) user();
      const item = entry(d.id);
      if (name === "toggleSupport" || name === "toggleBookmark") {
        if (item.post.hidden) fail("Жасырылған жазбаға бұл әрекет қолжетімсіз.", 403);
        const set = name === "toggleSupport" ? item.supports : item.bookmarks;
        const id = user().id; if (!set.delete(id)) set.add(id); return { ok: true };
      }
      if (name === "editPost" || name === "deletePost") {
        if (!owned(item)) fail("Бұл жазбаға авторлық құқығыңыз жоқ.", 403);
        if (item.replies.length) fail("Ресми жауаптан кейін жазбаны өзгертуге немесе өшіруге болмайды.", 409);
        if (name === "deletePost") { remove(item); return { ok: true }; }
        const title = text(d.title, 3, 160); const body = text(d.body, 10, 10000);
        item.post.title = title; item.post.body = body; item.post.updatedAt = timestamp; return { ok: true };
      }
      if (name === "comment") {
        if (item.post.hidden) fail("Жасырылған жазбаға пікір қосылмайды.", 403);
        const body = text(d.body, 1, 5000); const parentId = d.parentId == null ? null : uuid(d.parentId);
        if (parentId && !item.comments.some((c) => c.id === parentId && !c.parentId && !c.deleted))
          fail("Бір деңгейдегі пікірге ғана жауап беруге болады.");
        const person = user(); item.comments.push({ id: nextId(), owner: person.id, name: person.name,
          role: person.role, body, parentId, mine: true, deleted: false, createdAt: timestamp });
        return { ok: true };
      }
      if (name === "officialReply") {
        const body = text(d.body, 3, 10000); const person = manager();
        item.replies.push({ id: nextId(), name: person.name, body, createdAt: timestamp });
        if (item.owner) notify(item.owner, item.post.id, "Өтінішіңізге ресми жауап берілді");
        return { ok: true };
      }
      if (name === "moderate") {
        const mode = z.enum(["hide", "restore", "delete"]).parse(d.mode);
        const reason = text(d.reason ?? "", mode === "hide" ? 3 : 0, 1000);
        if (mode === "delete") remove(item);
        else { item.post.hidden = mode === "hide"; item.post.hiddenReason = mode === "hide" ? reason : null; }
        return { ok: true };
      }
      let status = d.status; let outcome = d.outcome ?? null;
      if (name === "resolution") {
        if (!owned(item)) fail("Авторлық қолжетімділік қажет.", 403);
        const resolved = bool(d.resolved);
        if (item.post.type !== "issue" || item.post.status !== "resolved") fail("Бұл әрекет шешілген мәселеге ғана қолданылады.");
        if (resolved) { item.post.confirmed = true; return { ok: true }; }
        status = "reviewing"; outcome = null;
      }
      if (item.post.type === "opinion") fail("Пікірге мәртебе берілмейді.");
      const valid = item.post.type === "issue" ? ["new", "reviewing", "resolved"] : ["in_progress", "reviewed"];
      if (!valid.includes(String(status))) fail("Мәртебе қате.");
      outcome = status === "reviewed" ? z.enum(["implemented", "declined"]).parse(outcome) : null;
      item.post.status = status as Post["status"]; item.post.outcome = outcome as string | null;
      item.post.confirmed = false; item.post.updatedAt = timestamp;
      item.history.push({ status: item.post.status!, outcome: item.post.outcome, createdAt: timestamp });
      return { ok: true };
    }
    if (name === "editComment" || name === "deleteComment") {
      const person = user(); const id = uuid(d.id);
      const item = entries.find((e) => e.comments.some((c) => c.id === id && c.owner === person.id && !c.deleted));
      if (!item) fail("Пікірге құқығыңыз жоқ.", 403);
      entry(item!.post.id); const comment = item!.comments.find((c) => c.id === id)!;
      comment.body = name === "deleteComment" ? "" : text(d.body, 1, 5000);
      comment.deleted = name === "deleteComment"; return { ok: true };
    }
    if (name === "rateTeacher") {
      const person = user(); const id = uuid(d.id); const stars = z.number().int().min(1).max(5).parse(d.stars);
      const comment = text(d.comment ?? "", 0, 3000);
      if (!catalog.some((t) => t.id === id && t.active)) fail("Оқытушы табылмады.", 404);
      ratings = ratings.filter((r) => !(r.teacher === id && r.person === person.id));
      ratings.push({ teacher: id, person: person.id, stars, comment, date: timestamp }); return { ok: true };
    }
    if (name === "readNotifications") {
      const person = user(); const id = d.id == null ? null : uuid(d.id);
      notices.filter((n) => n.owner === person.id && (!id || n.id === id)).forEach((n) => { n.read = true; });
      return { ok: true };
    }
    if (["addCourse", "addTeacher", "updateCatalog", "setRole", "setAccountActive"].includes(name)) {
      const person = leadership();
      if (name === "addCourse" || name === "addTeacher") {
        const nameValue = text(d.name, 2); const subject = text(d.subject ?? "Жалпы курс", 0);
        if (name === "addCourse") {
          if (courses.some((c) => c.name === nameValue)) fail("Осындай атау тіркелген.", 409);
          courses.push({ id: nextId(), name: nameValue, active: true });
        } else catalog.push({ id: nextId(), name: nameValue, subject, active: true, color: "blue" });
        return { ok: true };
      }
      const id = uuid(d.id);
      if (name === "updateCatalog") {
        const kind = z.enum(["course", "teacher"]).parse(d.kind);
        const value = text(d.name, 2); const active = bool(d.active); const subject = text(d.subject ?? "Жалпы курс", 0);
        const item = (kind === "course" ? courses : catalog).find((c) => c.id === id);
        if (!item) fail("Жазба табылмады.", 404);
        if (kind === "course" && courses.some((c) => c.id !== id && c.name === value)) fail("Осындай атау тіркелген.", 409);
        item!.name = value; item!.active = active;
        if (kind === "teacher") {
          const teacher = item as CatalogTeacher; teacher.subject = subject;
          const profile = people.find((p) => p.id === teacher.profileId); if (profile) profile.name = value;
        }
        return { ok: true };
      }
      if (person.id === id) fail("Өз басқару құқығыңызды немесе белсенділігіңізді өзгерте алмайсыз.");
      const target = people.find((p) => p.id === id); if (!target) fail("Аккаунт табылмады.", 404);
      if (name === "setRole") target!.role = z.enum(roles).parse(d.role);
      else target!.active = bool(d.active);
      let teacher = catalog.find((t) => t.profileId === id);
      if (target!.role === "teacher" && !teacher) {
        teacher = { id: nextId(), name: target!.name, subject: "Жалпы курс", active: target!.active, color: "blue", profileId: id };
        catalog.push(teacher);
      }
      if (teacher) teacher.active = target!.active && target!.role === "teacher";
      return { ok: true };
    }
    if (name === "prepareUpload") {
      const nameValue = text(d.name, 1, 240); const mime = text(d.mime ?? "application/octet-stream", 0, 200);
      const size = z.number().int().min(0).max(20971520).parse(d.size);
      const staged = files.filter((f) => !f.post);
      if (staged.length >= 5 || staged.reduce((n, f) => n + f.size, size) > 20971520) fail("Ең көбі 5 файл, жалпы 20 МБ.");
      const id = nextId(); files.push({ id, name: nameValue, size, mime, post: null });
      return { ok: true, id, url: `mock:${id}`, local: true };
    }
    if (name === "completeUpload" || name === "discardUpload") {
      const id = uuid(d.id); const file = files.find((f) => f.id === id && !f.post);
      if (name === "discardUpload") { files = files.filter((f) => f.id !== id || f.post); return { ok: true }; }
      if (!file?.blob) fail("Файл толық жүктелмеді."); return { ok: true, id };
    }
    if (name === "runJobs") { manager(); fail("Нақты email/ИИ тапсырмалары mock режимінде іске қосылмайды.", 503); }
    return fail(`Mock әрекеті қолжетімсіз: ${name}`, 400);
  }
  function remove(item: Entry) {
    entries = entries.filter((e) => e !== item);
    files = files.filter((f) => f.post !== item.post.id);
    notices = notices.filter((n) => n.feedbackId !== item.post.id);
    grants.delete(item.post.id);
  }
  async function perform<T>(operation: string, fn: () => T | Promise<T>): Promise<T> {
    await new Promise((resolve) => setTimeout(resolve, options.latencyMs ?? 30));
    const failure = failures.get(operation)?.shift(); if (failure) throw failure;
    try { return await fn(); }
    catch (error) {
      if (error instanceof z.ZodError) throw new ServiceError("Толтырылған өрістерді және мәтін ұзындығын тексеріңіз.");
      throw error;
    }
  }
  return {
    mode: "mock", reset,
    failNext(operation, message = "Сынақ байланысы үзілді. Қайта көріңіз.", status = 503) {
      const queue = failures.get(operation) || []; queue.push(new ServiceError(message, status)); failures.set(operation, queue);
    },
    boot: (range = {}) => perform("boot", () => {
      rangeDates(range); const person = viewer();
      return clone({ viewer: person ? publicPerson(person) : null, demo: true,
        posts: entries.filter((e) => !e.post.hidden || owned(e) || isManager(person?.role)).map(project),
        courses: courses.filter((c) => c.active).map(({ id, name }) => ({ id, name })), teachers: instructors(),
        notifications: person ? notices.filter((n) => n.owner === person.id).map(({ owner: _owner, ...n }) => n) : [],
        staff: person?.role === "leadership" ? people.map(publicPerson) : [],
        catalog: person?.role === "leadership" ? { courses, teachers: catalog.map(({ id, name, subject, active }) => ({ id, name, subject, active })) } : null,
        stats: isManager(person?.role) ? statistics(range) : null,
        integrations: isManager(person?.role) ? { email: false, ai: false, storage: false } : null,
      });
    }),
    detail: (id) => perform("detail", () => detail(id)),
    send: (name, input) => perform(name, () => mutate(name, input as Record<string, unknown>)),
    upload: (file, progress) => perform("upload", async () => {
      const prepared = mutate("prepareUpload", { name: file.name, mime: file.type || "application/octet-stream", size: file.size });
      try {
        progress?.(0); const bytes = await file.arrayBuffer();
        if (bytes.byteLength !== file.size) fail("Файл толық жүктелмеді.");
        const target = files.find((f) => f.id === prepared.id)!;
        target.blob = new Blob([bytes], { type: target.mime });
        progress?.(100); mutate("completeUpload", { id: prepared.id }); return prepared;
      } catch (error) { files = files.filter((f) => f.id !== prepared.id); throw error; }
    }),
    download: (id) => perform("download", () => {
      const file = files.find((f) => f.id === uuid(id) && f.blob); if (!file) fail("Файл табылмады.", 404);
      if (file!.post) entry(file!.post);
      return { blob: file!.blob!, name: file!.name };
    }),
    exportReport: (range = {}) => perform("exportReport", async () => {
      const stats = statistics(range);
      const { default: ExcelJS } = await import("exceljs");
      const book = new ExcelJS.Workbook(); book.creator = "MAXBALL temporary mock preview";
      const sheet = book.addWorksheet("Сынақ есебі");
      sheet.addRows([["Көрсеткіш", "Мәні"], ["Барлық жазба", stats.total], ["Шешілген мәселе", stats.resolved], ["Қаралуда", stats.reviewing]]);
      const buffer = await book.xlsx.writeBuffer();
      return { blob: new Blob([new Uint8Array(buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), name: "maxball-mock-report.xlsx" };
    }),
  };
}
