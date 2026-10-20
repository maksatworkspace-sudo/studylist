"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownWideNarrow,
  ArrowRight,
  ArrowUp,
  Bell,
  Bookmark,
  ChartNoAxesCombined,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Download,
  EyeOff,
  FileText,
  Flag,
  GraduationCap,
  LayoutGrid,
  LoaderCircle,
  LogIn,
  LogOut,
  Menu,
  MessageCircle,
  Plus,
  Pencil,
  Power,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Users,
  X,
} from "lucide-react";
import type { Boot, FeedbackType, Post, Role, Teacher } from "@/lib/types";
import { isManager, roleLabels, statusLabels, typeLabels } from "@/lib/types";
import {
  date,
  exportReport,
  initials,
  read,
  send,
  teacherColor,
  type Result,
} from "@/lib/client";
import {
  Auth,
  CatalogEdit,
  Compose,
  ManageForm,
  Rating,
  Receipt,
  Track,
} from "./forms";
import { Dialog, Empty, StatusBadge, Tag, Presence, Reveal, Notice, SessionFeedback, type AuthFeedback } from "./ui";
import PostDetail from "./post-detail";

type Page =
  | "feed"
  | "mine"
  | "saved"
  | "teachers"
  | "stats"
  | "moderation"
  | "manage"
  | "notifications";
const titles: Record<Page, string> = {
  feed: "Кері байланыс",
  mine: "Менің жазбаларым",
  saved: "Сақталғандар",
  teachers: "Оқытушылар",
  stats: "Статистика",
  moderation: "Модерация",
  manage: "Басқару",
  notifications: "Хабарламалар",
};
export default function Maxball() {
  const [data, setData] = useState<Boot | null>(null);
  const [failure, setFailure] = useState("");
  const [page, setPage] = useState<Page>("feed");
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [course, setCourse] = useState("");
  const [sort, setSort] = useState("new");
  const [teacherFilter, setTeacherFilter] = useState("");
  const [limit, setLimit] = useState(8);
  const [filters, setFilters] = useState(false);
  const [menu, setMenu] = useState(false);
  const [compose, setCompose] = useState(false);
  const [auth, setAuth] = useState<string | null>(null);
  const [authProof, setAuthProof] = useState<string>();
  const [track, setTrack] = useState(false);
  const [receipt, setReceipt] = useState<Result | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [rating, setRating] = useState<Teacher | null>(null);
  const [review, setReview] = useState<Teacher | null>(null);
  const [manage, setManage] = useState<"person" | "course" | "teacher" | null>(
    null,
  );
  const [manageTab, setManageTab] = useState("people");
  const [catalogEdit, setCatalogEdit] = useState<{
    kind: "course" | "teacher";
    item: { id: string; name: string; active: boolean; subject?: string };
  } | null>(null);
  const [toastText, setToastText] = useState("");
  const [toastId, setToastId] = useState(0);
  const toastRef = useRef("");
  const toastReplacement = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [sessionUnknown, setSessionUnknown] = useState(false);
  const sessionLock = useRef(false);
  const requestVersion = useRef(0);
  const [feedback, setFeedback] = useState<AuthFeedback | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingCommands = useRef(new Set<string>());
  const [pending, setPending] = useState<Set<string>>(new Set());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const started = useRef(false);
  const workspace = useRef<HTMLElement>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const toast = useCallback((text: string) => {
    clearTimeout(toastTimer.current);
    clearTimeout(toastReplacement.current);
    const replace = !!toastRef.current;
    toastRef.current = text;
    setToastText("");
    const show = () => {
      setToastText(text);
      setToastId((id) => id + 1);
      toastTimer.current = setTimeout(() => { toastRef.current = ""; setToastText(""); }, 5000);
    };
    if (replace && !window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      toastReplacement.current = setTimeout(show, 280);
    else show();
  }, []);
  function dismissToast() {
    clearTimeout(toastTimer.current); clearTimeout(toastReplacement.current);
    toastRef.current = ""; setToastText("");
  }
  const reload = useCallback(async () => {
    const version = ++requestVersion.current;
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const next = await read<Boot>(`/api/state?${params}`);
    if (version === requestVersion.current) setData(next);
  }, [from, to]);
  useEffect(() => () => {
    clearTimeout(toastTimer.current);
    clearTimeout(toastReplacement.current);
    clearTimeout(feedbackTimer.current);
    ++requestVersion.current;
  }, []);
  function resetFilters() {
    setSearch(""); setType("all"); setStatus("all"); setCourse("");
    setTeacherFilter(""); setSort("new"); setLimit(8); setFilters(false);
  }
  function authPending(busy: boolean) {
    sessionLock.current = busy;
    setSessionBusy(busy);
    if (busy) {
      ++requestVersion.current;
      closePost(); setCompose(false); setRating(null); setReview(null);
      setManage(null); setCatalogEdit(null); setTrack(false);
    }
  }
  async function finishAuth(kind?: "login" | "register" | "demo" | "logout") {
    // Once a session mutation succeeds, old account data is unsafe until refetched.
    setSessionUnknown(true);
    const version = ++requestVersion.current;
    const next = await read<Boot>("/api/state");
    if (version !== requestVersion.current) return;
    setData(next);
    setSessionUnknown(false);
    if (kind) {
      resetFilters(); setFrom(""); setTo(""); setPage("feed"); setMenu(false);
      clearTimeout(feedbackTimer.current);
      setFeedback({ id: Date.now(), kind: kind === "logout" ? "farewell" : kind === "register" ? "register" : "welcome", name: next.viewer?.name || "Email-ды растаңыз" });
      feedbackTimer.current = setTimeout(() => setFeedback(null), 600);
    }
  }
  async function logout() {
    if (sessionLock.current) return;
    authPending(true);
    try { await send("logout"); await finishAuth("logout"); }
    catch (error) { toast((error as Error).message); }
    finally { authPending(false); }
  }
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const boot = await read<Boot>("/api/state");
        setData(boot);
        const url = new URL(location.href);
        const hash = new URLSearchParams(url.hash.slice(1));
        if (hash.get("access_token")) {
          await send("exchangeSession", {
            accessToken: hash.get("access_token"),
            refreshToken: hash.get("refresh_token"),
          });
          url.hash = "";
          history.replaceState(null, "", url);
          await reload();
          if (
            url.searchParams.has("recovery") ||
            hash.get("type") === "invite"
          ) {
            setAuth("reset");
            url.searchParams.delete("recovery");
            history.replaceState(null, "", url);
          }
        }
        if (
          hash.has("guestRecovery") ||
          url.searchParams.has("guestRecovery")
        ) {
          const result = await send("resetGuestCode", {
            token:
              hash.get("guestRecovery") ||
              url.searchParams.get("guestRecovery"),
          });
          url.hash = "";
          url.searchParams.delete("guestRecovery");
          history.replaceState(null, "", url);
          setReceipt(result);
          await reload();
        }
        const post = url.searchParams.get("post");
        if (post && /^[0-9a-f-]{36}$/.test(post)) setDetailId(post);
      } catch (e) {
        setFailure((e as Error).message);
      }
    })();
  }, [reload]);
  useEffect(() => {
    if (
      data?.viewer &&
      !isManager(data.viewer.role) &&
      ["stats", "moderation", "manage"].includes(page)
    )
      setPage("feed");
    if (
      !data?.viewer &&
      ["stats", "moderation", "manage", "notifications", "saved"].includes(page)
    )
      setPage("feed");
  }, [data?.viewer, page]);
  function openPost(id: string) {
    setDetailId(id);
    const url = new URL(location.href);
    url.searchParams.set("post", id);
    history.replaceState(null, "", url);
  }
  function closePost() {
    setDetailId(null);
    const url = new URL(location.href);
    url.searchParams.delete("post");
    history.replaceState(null, "", url);
  }
  async function quick(name: string, input: Record<string, unknown> = {}) {
    const key = String(input.id || name);
    if (sessionLock.current || pendingCommands.current.has(key)) return;
    pendingCommands.current.add(key);
    setPending(new Set(pendingCommands.current));
    try {
      await send(name, input);
      if (!sessionLock.current) await reload();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      pendingCommands.current.delete(key);
      setPending(new Set(pendingCommands.current));
    }
  }
  function authGate(action: () => void) {
    if (!data?.viewer?.verified) setAuth("login");
    else action();
  }
  function navigate(next: Page) {
    if ((next === "saved" || next === "notifications") && !data?.viewer) {
      setAuth("login");
      return;
    }
    setPage(next);
    resetFilters();
    setMenu(false);
    workspace.current?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }
  // Ownership/visibility is applied before the shared search/filter result.
  const scopePosts = useMemo(
    () =>
      data?.posts.filter((p) =>
        page === "mine"
          ? data?.viewer ? p.isAccountOwner : p.isOwner
          : page === "saved"
            ? p.saved
            : page === "moderation"
              ? p.hidden || p.flagged
              : !p.hidden,
      ) || [],
    [data, page],
  );
  const posts = useMemo(() => {
    const query = search.toLocaleLowerCase("kk").trim();
    let result = scopePosts;
    if (query)
      result = result.filter((p) =>
        [p.title, p.body, p.course, p.teacher, p.customTarget, `#${p.number}`]
          .join(" ")
          .toLocaleLowerCase("kk")
          .includes(query),
      );
    if (type !== "all") result = result.filter((p) => p.type === type);
    if (status !== "all") result = result.filter((p) => p.status === status);
    if (course) result = result.filter((p) => p.courseId === course);
    if (teacherFilter)
      result = result.filter((p) => p.teacherId === teacherFilter);
    return [...result].sort((a, b) =>
      sort === "popular"
        ? b.supports - a.supports
        : sort === "discussed"
          ? b.comments - a.comments
          : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [scopePosts, search, type, status, course, teacherFilter, sort]);
  if (!data)
    return (
      <div className="initial">
        <img src="/maxball-logo.png" alt="MAXBALL" />
        <h1>MAXBALL EDTECH</h1>
        {failure ? (
          <>
            <p role="alert">{failure}</p>
            <button className="btn primary" onClick={() => location.reload()}>
              Қайта көру
            </button>
          </>
        ) : (
          <LoaderCircle className="spin" />
        )}
      </div>
    );
  const manager = isManager(data.viewer?.role);
  const unread = data.notifications.filter((n) => !n.read).length;
  const publicPosts = data.posts.filter((p) => !p.hidden);
  const feedPage = ["feed", "mine", "saved", "moderation"].includes(page);
  const nav = [
    { id: "feed" as Page, icon: LayoutGrid, label: "Кері байланыс" },
    { id: "mine" as Page, icon: FileText, label: "Менің жазбаларым" },
    { id: "saved" as Page, icon: Bookmark, label: "Сақталғандар" },
    { id: "teachers" as Page, icon: GraduationCap, label: "Оқытушылар" },
  ];
  return (
    <>
      <div className="app-backdrop" />
      <div className={`app-shell ${sessionBusy || sessionUnknown ? "session-pending" : ""}`} inert={sessionBusy || sessionUnknown}>
        <header className="topbar">
          <button
            className="icon-btn mobile-only"
            title="Мәзір"
            aria-label="Мәзір"
            onClick={() => setMenu(!menu)}
          >
            <Menu size={21} />
          </button>
          <button
            className="brand"
            onClick={() => navigate("feed")}
            aria-label="MAXBALL EDTECH басты беті"
          >
            <img src="/maxball-logo.png" alt="" />
            <span>
              MAXBALL<span>EDTECH</span>
            </span>
          </button>
          <div className="header-divider" />
          <span className="header-title">Кері байланыс алаңы</span>
          <div className="header-actions">
            <button
              className={`icon-btn notification-button ${page === "notifications" ? "active" : ""}`}
              title="Хабарламалар"
              aria-label={
                unread ? `Хабарламалар: ${unread} оқылмаған` : "Хабарламалар"
              }
              onClick={() => navigate("notifications")}
            >
              <Bell size={20} />
              {unread > 0 && <span className="notification-dot" />}
            </button>
            <span className="header-divider" />
            {data.viewer ? (
              <button
                className="profile-button"
                onClick={() =>
                  setAuth(data.viewer?.verified ? "profile" : "verify")
                }
              >
                <span className="avatar">{initials(data.viewer.name)}</span>
                <span>
                  <strong>{data.viewer.name}</strong>
                  <small>{roleLabels[data.viewer.role]}</small>
                </span>
                <ChevronDown size={15} />
              </button>
            ) : (
              <button
                className="btn secondary"
                onClick={() => setAuth("login")}
              >
                <LogIn size={16} />
                Кіру
              </button>
            )}
          </div>
        </header>
        <div className="app-body">
          {menu && (
            <button
              className="nav-overlay"
              aria-label="Мәзірді жабу"
              onClick={() => setMenu(false)}
            />
          )}
          <aside className={`sidebar ${menu ? "open" : ""}`}>
            <div className="sidebar-top">
              <span className="nav-caption">ЖЕКЕ КАБИНЕТ</span>
              <button
                className="icon-btn mobile-only"
                aria-label="Мәзірді жабу"
                onClick={() => setMenu(false)}
              >
                <X size={17} />
              </button>
            </div>
            <nav>
              {nav.map((n) => (
                <button
                  key={n.id}
                  className={`nav-item ${page === n.id ? "selected" : ""}`}
                  onClick={() => navigate(n.id)}
                >
                  <n.icon size={19} />
                  <span>{n.label}</span>
                  {n.id === "feed" && <small>{publicPosts.length}</small>}
                </button>
              ))}
              {manager && (
                <>
                  <span className="nav-caption management-caption">
                    ӘКІМШІЛІК
                  </span>
                  <button
                    className={`nav-item ${page === "stats" ? "selected" : ""}`}
                    onClick={() => navigate("stats")}
                  >
                    <ChartNoAxesCombined size={19} />
                    Статистика
                  </button>
                  <button
                    className={`nav-item ${page === "moderation" ? "selected" : ""}`}
                    onClick={() => navigate("moderation")}
                  >
                    <ShieldCheck size={19} />
                    Модерация
                    {data.posts.filter((p) => p.flagged).length > 0 && (
                      <small>
                        {data.posts.filter((p) => p.flagged).length}
                      </small>
                    )}
                  </button>
                  {data.viewer?.role === "leadership" && (
                    <button
                      className={`nav-item ${page === "manage" ? "selected" : ""}`}
                      onClick={() => navigate("manage")}
                    >
                      <Users size={19} />
                      Басқару
                    </button>
                  )}
                </>
              )}
            </nav>
            <div className="sidebar-bottom">
              <button
                className="track-link"
                onClick={() => {
                  setTrack(true);
                  setMenu(false);
                }}
              >
                <CircleHelp size={18} />
                <span>Өтінішті табу</span>
                <ChevronRight size={16} />
              </button>
              {data.viewer && (
                <button className="logout" disabled={sessionBusy} onClick={() => void logout()}>
                  {sessionBusy ? <LoaderCircle className="spin" size={16} /> : <LogOut size={16} />}
                  {sessionBusy ? "Шығуда…" : "Шығу"}
                </button>
              )}
              <span className="sidebar-copyright">
                © {new Date().getFullYear()} MAXBALL EDTECH
              </span>
            </div>
          </aside>
          <main className="workspace" ref={workspace}>
            <div className="page-content" key={`${page}:${data.viewer?.id || "guest"}`}>
            <div className="page-header">
              <div className="breadcrumb">
                MAXBALL EDTECH <ChevronRight size={13} />
                {titles[page]}
              </div>
              <div className="page-title-row">
                <div>
                  <h1>{titles[page]}</h1>
                  <p>
                    {page === "feed"
                      ? "Ойыңыз маңызды. Бірге жақсартамыз."
                      : page === "teachers"
                        ? "Білімге бағыт берген жандар"
                        : page === "stats"
                          ? "Кері байланыстың жалпы көрінісі"
                          : page === "manage"
                            ? "Адамдар, курстар және оқытушылар"
                            : page === "moderation"
                              ? "Тексеруді қажет ететін жазбалар"
                              : page === "mine"
                                ? "Өзіңіз қалдырған кері байланыс"
                                : page === "saved"
                                  ? "Кейін оралатын жазбалар"
                                  : "Жаңалықтар мен ресми жауаптар"}
                  </p>
                </div>
                {feedPage && (
                  <button
                    className="btn primary"
                    onClick={() => setCompose(true)}
                  >
                    <Plus size={18} />
                    <span>Жазба қалдыру</span>
                  </button>
                )}
                {page === "manage" && (
                  <button
                    className="btn primary"
                    onClick={() =>
                      setManage(
                        manageTab === "people"
                          ? "person"
                          : manageTab === "courses"
                            ? "course"
                            : "teacher",
                      )
                    }
                  >
                    <Plus size={18} />
                    Қосу
                  </button>
                )}
              </div>
            </div>
            {feedPage && (
              <>
                <div className="overview-strip">
                  <div>
                    <span className="metric-icon blue">
                      <MessageCircle size={19} />
                    </span>
                    <span>
                      <strong>{posts.length}</strong>
                      <small>Барлық жазба</small>
                    </span>
                  </div>
                  <div>
                    <span className="metric-icon green">
                      <CheckCircle2 size={19} />
                    </span>
                    <span>
                      <strong>
                        {
                          posts.filter((p) => p.status === "resolved")
                            .length
                        }
                      </strong>
                      <small>Шешілген мәселе</small>
                    </span>
                  </div>
                  <div>
                    <span className="metric-icon amber">
                      <Clock3 size={19} />
                    </span>
                    <span>
                      <strong>
                        {
                          posts.filter(
                            (p) =>
                              p.status === "reviewing" ||
                              p.status === "in_progress",
                          ).length
                        }
                      </strong>
                      <small>Қаралып жатыр</small>
                    </span>
                  </div>
                </div>
                <div className="feed-columns">
                  <section className="feed-main">
                    <div className="feed-controls">
                      <div className="feed-tabs">
                        {["all", "opinion", "suggestion", "issue"].map((t) => (
                          <button
                            key={t}
                            className={type === t ? "selected" : ""}
                            onClick={() => {
                              setType(t);
                              setLimit(8);
                            }}
                          >
                            {t === "all"
                              ? "Барлығы"
                              : typeLabels[t as FeedbackType]}
                            <span>
                              {t === "all"
                                ? posts.length
                                : posts.filter((p) => p.type === t).length}
                            </span>
                          </button>
                        ))}
                      </div>
                      <div className="search-row">
                        <label className="search-input">
                          <Search size={17} />
                          <input
                            placeholder="Жазбалардан іздеу..."
                            aria-label="Жазбалардан іздеу"
                            value={search}
                            onChange={(e) => {
                              setSearch(e.target.value);
                              setLimit(8);
                            }}
                          />
                          {search && (
                            <button
                              className="icon-btn"
                              aria-label="Іздеуді тазарту"
                              onClick={() => setSearch("")}
                            >
                              <X size={15} />
                            </button>
                          )}
                        </label>
                        <button
                          className={`icon-btn filter-button ${filters || status !== "all" || course || teacherFilter ? "active" : ""}`}
                          title="Сүзгілер"
                          aria-label="Сүзгілер"
                          aria-expanded={filters}
                          onClick={() => setFilters(!filters)}
                        >
                          <SlidersHorizontal size={18} />
                        </button>
                      </div>
                      <Presence show={filters}>
                        <Reveal className="filter-row">
                          <select
                            aria-label="Курс бойынша сүзгі"
                            value={course}
                            onChange={(e) => { setCourse(e.target.value); setLimit(8); }}
                          >
                            <option value="">Барлық курс</option>
                            {data.courses.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                          <select
                            aria-label="Оқытушы бойынша сүзгі"
                            value={teacherFilter}
                            onChange={(e) => { setTeacherFilter(e.target.value); setLimit(8); }}
                          >
                            <option value="">Барлық оқытушы</option>
                            {data.teachers.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                          </select>
                          <select
                            aria-label="Мәртебе бойынша сүзгі"
                            value={status}
                            onChange={(e) => { setStatus(e.target.value); setLimit(8); }}
                          >
                            <option value="all">Барлық мәртебе</option>
                            {Object.entries(statusLabels).map(([s, l]) => (
                              <option key={s} value={s}>
                                {l}
                              </option>
                            ))}
                          </select>
                          <button
                            className="text-btn"
                            onClick={() => {
                              setStatus("all");
                              setCourse("");
                              setTeacherFilter("");
                              setSearch(""); setType("all"); setLimit(8);
                            }}
                          >
                            Тазарту
                          </button>
                        </Reveal>
                      </Presence>
                      {!filters && (search || type !== "all" || course || teacherFilter || status !== "all") && <button className="text-btn clear-filters" onClick={resetFilters}><X size={13} /> Сүзгілерді тазарту</button>}
                      <div className="list-meta">
                        <span role="status">{posts.length} жазба</span>
                        <label>
                          <ArrowDownWideNarrow size={14} />
                          <select
                            value={sort}
                            aria-label="Сұрыптау"
                            onChange={(e) => setSort(e.target.value)}
                          >
                            <option value="new">Алдымен жаңалары</option>
                            <option value="popular">Көп қолдау алған</option>
                            <option value="discussed">Көп талқыланған</option>
                          </select>
                        </label>
                      </div>
                    </div>
                    <div className="post-list">
                      {posts.slice(0, limit).map((p) => (
                        <PostCard
                          key={p.id}
                          post={p}
                          busy={pending.has(p.id)}
                          onOpen={() => openPost(p.id)}
                          onSupport={() =>
                            authGate(
                              () => void quick("toggleSupport", { id: p.id }),
                            )
                          }
                          onSave={() =>
                            authGate(
                              () => void quick("toggleBookmark", { id: p.id }),
                            )
                          }
                        />
                      ))}
                    </div>
                    {!posts.length && (
                      <Empty
                        title={
                          page === "moderation"
                            ? "Тексеруді күтетін жазба жоқ"
                            : page === "mine" && data.viewer
                              ? "Сіз әлі жазба қалдырмағансыз"
                              : page === "mine"
                                ? "Кодпен ашылған жазба жоқ"
                                : page === "saved"
                                  ? "Сақталған жазба жоқ"
                                  : "Жазба табылмады"
                        }
                      >
                        {page === "mine" && data.viewer && (
                          <button
                            className="btn primary"
                            onClick={() => setCompose(true)}
                          >
                            Бірінші жазбаны қалдыру
                          </button>
                        )}
                        {page === "mine" && !data.viewer && (
                          <button
                            className="text-btn"
                            onClick={() => setTrack(true)}
                          >
                            Құпия кодпен табу
                          </button>
                        )}
                        {page === "saved" && (
                          <span className="empty-hint">
                            Жазба карточкасындағы сақтау белгішесін басып,
                            кейін оқу үшін сақтаңыз.
                          </span>
                        )}
                        <button
                          className="text-btn"
                          onClick={() => {
                            setSearch("");
                            setType("all");
                            setCourse("");
                            setStatus("all");
                            setTeacherFilter("");
                          }}
                        >
                          Сүзгілерді тазарту
                        </button>
                      </Empty>
                    )}
                    {posts.length > limit && (
                      <button
                        className="btn secondary load-more"
                        onClick={() => setLimit((n) => n + 8)}
                      >
                        Тағы көрсету
                        <ChevronDown size={17} />
                      </button>
                    )}
                  </section>
                  <aside className="feed-aside">
                    <section className="aside-section community">
                      <span className="eyebrow">
                        <Sparkles size={15} />
                        MAXBALL COMMUNITY
                      </span>
                      <h2>
                        Жақсы өзгеріс
                        <br />
                        бір ойдан басталады.
                      </h2>
                      <p>Сұрағыңыз, ұсынысыңыз немесе айтар ойыңыз бар ма?</p>
                      <button
                        className="text-btn"
                        onClick={() => setCompose(true)}
                      >
                        Бөлісу
                        <ArrowRight size={16} />
                      </button>
                    </section>
                    <section className="aside-section">
                      <div className="section-label">
                        <h3>Оқытушылар</h3>
                        <button
                          title="Барлық оқытушы"
                          aria-label="Барлық оқытушы"
                          className="icon-btn"
                          onClick={() => navigate("teachers")}
                        >
                          <ArrowRight size={16} />
                        </button>
                      </div>
                      {data.teachers.slice(0, 4).map((t) => (
                        <button
                          key={t.id}
                          className="teacher-mini"
                          onClick={() => {
                            navigate("teachers");
                            setReview(t);
                          }}
                        >
                          <span
                            className="avatar"
                            style={{ background: teacherColor(t.color) }}
                          >
                            {initials(t.name)}
                          </span>
                          <span>
                            <strong>{t.name}</strong>
                            <small>{t.subject}</small>
                          </span>
                          <span className="mini-rating">
                            <Star size={13} fill="currentColor" />
                            {t.average || "—"}
                          </span>
                        </button>
                      ))}
                      <button
                        className="all-teachers"
                        onClick={() => navigate("teachers")}
                      >
                        Барлық оқытушы
                        <ChevronRight size={15} />
                      </button>
                    </section>
                    <section className="aside-section privacy-note">
                      <ShieldCheck size={22} />
                      <h3>Сенімді орта</h3>
                      <p>Анонимді жазбадағы жеке деректер жарияланбайды.</p>
                      <span>Құрмет. Ашықтық. Даму.</span>
                    </section>
                  </aside>
                </div>
              </>
            )}
            {page === "teachers" && (
              <>
                <label className="search-input standalone-search">
                  <Search size={18} />
                  <input
                    placeholder="Оқытушыны іздеу..."
                    aria-label="Оқытушыны іздеу"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <div className="teacher-grid">
                  {data.teachers
                    .filter((t) =>
                      `${t.name} ${t.subject}`
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                    )
                    .map((t) => (
                      <article className="teacher-card" key={t.id}>
                        <div className="teacher-card-top">
                          <span
                            className="avatar teacher-avatar"
                            style={{ background: teacherColor(t.color) }}
                          >
                            {initials(t.name)}
                          </span>
                          {t.myStars > 0 && (
                            <span className="rated-indicator">
                              <Check size={13} />
                              Бағаланған
                            </span>
                          )}
                        </div>
                        <h2>{t.name}</h2>
                        <p>{t.subject}</p>
                        <div className="teacher-score">
                          <Star size={19} fill="currentColor" />
                          <strong>{t.average || "—"}</strong>
                          <span>/ 5</span>
                          <small>{t.count} баға</small>
                        </div>
                        <div className="teacher-card-bottom">
                          <button
                            className="btn secondary"
                            onClick={() => authGate(() => setRating(t))}
                          >
                            <Star size={16} />
                            {t.myStars ? "Бағаны өзгерту" : "Бағалау"}
                          </button>
                          <button
                            className="text-btn"
                            onClick={() => setReview(t)}
                          >
                            {t.reviews.length} пікір
                            <ChevronRight size={15} />
                          </button>
                        </div>
                      </article>
                    ))}
                </div>
                {!data.teachers.some((t) =>
                  `${t.name} ${t.subject}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                ) && <Empty title="Оқытушы табылмады" />}
              </>
            )}
            {page === "stats" && data.stats && (
              <section className="stats-page">
                <div className="report-toolbar">
                  <label>
                    Бастап
                    <input
                      type="date"
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                    />
                  </label>
                  <label>
                    Дейін
                    <input
                      type="date"
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                    />
                  </label>
                  <button
                    className="btn secondary"
                    disabled={refreshing}
                    onClick={async () => {
                      if (from && to && from > to) {
                        toast(
                          "Басталу күні аяқталу күнінен кейін болмауы керек.",
                        );
                        return;
                      }
                      setRefreshing(true);
                      try {
                        await reload();
                      } catch (e) {
                        toast((e as Error).message);
                      } finally {
                        setRefreshing(false);
                      }
                    }}
                  >
                    {refreshing ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <Check size={16} />
                    )}
                    Қолдану
                  </button>
                  <a
                    className="btn primary"
                    href="#"
                    onClick={(event) => {
                      event.preventDefault();
                      void exportReport({ from, to }).catch((error) => toast(error.message));
                    }}
                  >
                    <Download size={17} />
                    Excel
                  </a>
                </div>
                <div className="report-metrics">
                  {[
                    {
                      label: "Барлық жазба",
                      value: data.stats.total,
                      icon: MessageCircle,
                      color: "blue",
                    },
                    {
                      label: "Шешілген мәселе",
                      value: data.stats.resolved,
                      icon: CheckCircle2,
                      color: "green",
                    },
                    {
                      label: "Қаралып жатыр",
                      value: data.stats.reviewing,
                      icon: Clock3,
                      color: "amber",
                    },
                    {
                      label: "Орташа шешу уақыты",
                      value: `${data.stats.resolutionHours.toFixed(1)} сағ`,
                      icon: ChartNoAxesCombined,
                      color: "rose",
                    },
                  ].map((m) => (
                    <div key={m.label}>
                      <span className={`metric-icon ${m.color}`}>
                        <m.icon size={20} />
                      </span>
                      <strong>{m.value}</strong>
                      <small>{m.label}</small>
                    </div>
                  ))}
                </div>
                <div className="report-grid">
                  <section>
                    <h2>Мәртебелер бойынша</h2>
                    {data.stats.statuses.map((s) => (
                      <div className="report-bar" key={s.status}>
                        <div>
                          <span>{statusLabels[s.status]}</span>
                          <strong>{s.count}</strong>
                        </div>
                        <progress
                          value={s.count}
                          max={Math.max(1, data.stats!.total)}
                        />
                      </div>
                    ))}
                  </section>
                  <section>
                    <h2>Оқытушыға қатысты жазбалар</h2>
                    {data.stats.instructors.map((t) => (
                      <div className="report-bar" key={t.name}>
                        <div>
                          <span>{t.name}</span>
                          <strong>{t.count}</strong>
                        </div>
                        <progress
                          value={t.count}
                          max={Math.max(1, data.stats!.total)}
                        />
                      </div>
                    ))}
                  </section>
                  <section>
                    <h2>Айлар бойынша</h2>
                    <p className="month-comparison">
                      Таңдалған соңғы ай:{" "}
                      <strong>{data.stats.comparison.current}</strong> · Алдыңғы
                      ай: <strong>{data.stats.comparison.previous}</strong> ·
                      Өзгеріс:{" "}
                      <strong>
                        {data.stats.comparison.current -
                          data.stats.comparison.previous >
                        0
                          ? "+"
                          : ""}
                        {data.stats.comparison.current -
                          data.stats.comparison.previous}
                      </strong>
                    </p>
                    <div className="month-chart">
                      {data.stats.monthly.map((m) => (
                        <div key={m.month}>
                          <span>{m.count}</span>
                          <i
                            style={{
                              height: `${Math.max(8, (m.count / Math.max(1, ...data.stats!.monthly.map((i) => i.count))) * 150)}px`,
                            }}
                          />
                          <small>{m.month}</small>
                        </div>
                      ))}
                      {!data.stats.monthly.length && (
                        <p className="muted">Дерек жоқ</p>
                      )}
                    </div>
                  </section>
                  <section>
                    <h2>Жазба түрлері</h2>
                    {(Object.keys(typeLabels) as FeedbackType[]).map((t) => {
                      const count =
                        data.stats!.types.find((i) => i.type === t)?.count || 0;
                      return (
                        <div className="report-bar" key={t}>
                          <div>
                            <span>{typeLabels[t]}</span>
                            <strong>{count}</strong>
                          </div>
                          <progress
                            className={t}
                            max={Math.max(1, data.stats!.total)}
                            value={count}
                          />
                        </div>
                      );
                    })}
                  </section>
                  <section>
                    <h2>Курстар бойынша</h2>
                    {data.stats.courses.map((c) => (
                      <div className="report-bar" key={c.name}>
                        <div>
                          <span>{c.name}</span>
                          <strong>{c.count}</strong>
                        </div>
                        <progress
                          max={Math.max(1, data.stats!.total)}
                          value={c.count}
                        />
                      </div>
                    ))}
                  </section>
                  <section>
                    <h2>Оқытушы рейтингі</h2>
                    {[...data.teachers]
                      .sort((a, b) => b.average - a.average)
                      .map((t) => (
                        <div className="rating-table-row" key={t.id}>
                          <span>
                            {t.name}
                            <small>{t.count} баға</small>
                          </span>
                          <strong>
                            <Star size={14} fill="currentColor" />
                            {t.average}
                          </strong>
                        </div>
                      ))}
                  </section>
                </div>
                <IntegrationStatus data={data} />
              </section>
            )}
            {page === "manage" && data.viewer?.role === "leadership" && (
              <section className="management-page">
                <div className="section-tabs">
                  {[
                    {
                      id: "people",
                      label: "Адамдар",
                      count: data.staff.length,
                    },
                    {
                      id: "courses",
                      label: "Курстар",
                      count: data.courses.length,
                    },
                    {
                      id: "teachers",
                      label: "Оқытушылар",
                      count: data.teachers.length,
                    },
                  ].map((t) => (
                    <button
                      key={t.id}
                      className={manageTab === t.id ? "selected" : ""}
                      onClick={() => {
                        setManageTab(t.id);
                        setSearch("");
                      }}
                    >
                      {t.label}
                      <span>{t.count}</span>
                    </button>
                  ))}
                </div>
                <label className="search-input standalone-search">
                  <Search size={17} />
                  <input
                    aria-label="Басқару тізімінен іздеу"
                    placeholder="Тізімнен іздеу..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                {manageTab === "people" ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Аты-жөні</th>
                          <th>Байланыс</th>
                          <th>Рөл</th>
                          <th>Email</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.staff
                          .filter((p) =>
                            `${p.name} ${p.email}`
                              .toLowerCase()
                              .includes(search.toLowerCase()),
                          )
                          .map((p) => (
                            <tr key={p.id}>
                              <td>
                                <span className="person-cell">
                                  <span className="avatar small-avatar">
                                    {initials(p.name)}
                                  </span>
                                  <strong>{p.name}</strong>
                                </span>
                              </td>
                              <td>
                                {p.email}
                                <small>{p.phone}</small>
                              </td>
                              <td>
                                <select
                                  aria-label={`${p.name}: рөлі`}
                                  disabled={p.id === data.viewer?.id}
                                  value={p.role}
                                  onChange={(e) => {
                                    if (
                                      confirm(
                                        `${p.name}: рөл ${roleLabels[e.target.value as Role]} болып өзгертілсін бе?`,
                                      )
                                    )
                                      void quick("setRole", {
                                        id: p.id,
                                        role: e.target.value,
                                      });
                                  }}
                                >
                                  {Object.entries(roleLabels).map(([r, l]) => (
                                    <option value={r} key={r}>
                                      {l}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td>
                                <span
                                  className={`status ${p.verified ? "resolved" : "new"}`}
                                >
                                  <button
                                    className="icon-btn"
                                    disabled={p.id === data.viewer?.id}
                                    title={
                                      p.active
                                        ? "Аккаунтты бұғаттау"
                                        : "Аккаунтты іске қосу"
                                    }
                                    aria-label={`${p.name}: ${p.active ? "бұғаттау" : "іске қосу"}`}
                                    onClick={() => {
                                      if (
                                        confirm(
                                          `${p.name}: аккаунт ${p.active ? "бұғатталсын" : "іске қосылсын"} ба?`,
                                        )
                                      )
                                        void quick("setAccountActive", {
                                          id: p.id,
                                          active: !p.active,
                                        });
                                    }}
                                  >
                                    <Power size={15} />
                                  </button>
                                  {!p.active && <small>Бұғатталған</small>}
                                  {p.verified ? "Расталған" : "Расталмаған"}
                                </span>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="catalog-list">
                    {(manageTab === "courses"
                      ? data.catalog?.courses || []
                      : data.catalog?.teachers || []
                    )
                      .filter((item) =>
                        item.name.toLowerCase().includes(search.toLowerCase()),
                      )
                      .map((item) => (
                        <div key={item.id}>
                          <span className="metric-icon blue">
                            <GraduationCap size={19} />
                          </span>
                          <strong>{item.name}</strong>
                          {"subject" in item && (
                            <span>{String(item.subject)}</span>
                          )}
                          <span
                            className={`status ${item.active ? "resolved" : "new"}`}
                          >
                            {item.active ? "Белсенді" : "Мұрағатта"}
                          </span>
                          <button
                            className="icon-btn"
                            title="Өзгерту"
                            aria-label={`${item.name}: өзгерту`}
                            onClick={() =>
                              setCatalogEdit({
                                kind:
                                  manageTab === "courses"
                                    ? "course"
                                    : "teacher",
                                item,
                              })
                            }
                          >
                            <Pencil size={17} />
                          </button>
                        </div>
                      ))}
                  </div>
                )}
              </section>
            )}
            {page === "notifications" && (
              <section className="notifications-page">
                <div className="list-meta">
                  <span>{unread} оқылмаған</span>
                  <button
                    className="text-btn"
                    onClick={() => quick("readNotifications")}
                    disabled={!unread}
                  >
                    <CheckCheck size={16} />
                    Барлығын оқылды деп белгілеу
                  </button>
                </div>
                {data.notifications.map((n) => (
                  <button
                    className={`notice-row ${!n.read ? "unread" : ""}`}
                    key={n.id}
                    onClick={() => {
                      void quick("readNotifications", { id: n.id });
                      if (n.feedbackId) openPost(n.feedbackId);
                    }}
                  >
                    <span className="metric-icon blue">
                      <Bell size={18} />
                    </span>
                    <span>
                      <strong>{n.title}</strong>
                      <small>{date(n.createdAt)}</small>
                    </span>
                    <ChevronRight size={17} />
                  </button>
                ))}
                {!data.notifications.length && (
                  <Empty title="Әзірге хабарлама жоқ" />
                )}
              </section>
            )}
            </div>
          </main>
        </div>
      </div>
      {(sessionBusy || sessionUnknown) && <div className="session-loading" role="status">
        <img src="/maxball-logo.png" alt="" />
        {sessionBusy ? <><LoaderCircle size={20} className="spin" /><strong>Аккаунт жаңартылуда…</strong></> : <><strong>Аккаунт деректерін жаңарту қажет</strong><button className="btn primary" onClick={() => { authPending(true); void finishAuth().catch((e) => toast(e.message)).finally(() => authPending(false)); }}>Қайта көру</button></>}
        <div className="session-skeleton" aria-hidden="true"><i /><i /><i /></div>
      </div>}
      <div className="outside-footer">
        <ShieldCheck size={14} />
        MAXBALL EDTECH<span>Бірге дамимыз.</span>
      </div>
      <Presence show={compose}>{compose && (
        <Compose
          data={data}
          onClose={() => setCompose(false)}
          onDone={async (result) => {
            setCompose(false);
            if (result.code) setReceipt(result);
            else toast("Жазбаңыз жарияланды.");
            void reload().catch((e) => toast(e.message));
          }}
        />
      )}</Presence>
      <Presence show={!!catalogEdit}>{catalogEdit && (
        <CatalogEdit
          item={catalogEdit.item}
          kind={catalogEdit.kind}
          onClose={() => setCatalogEdit(null)}
          onDone={reload}
        />
      )}</Presence>
      <Presence show={!!auth}>{auth && (
        <Auth
          key={auth}
          initial={auth}
          proof={authProof}
          viewer={data.viewer}
          onClose={() => {
            setAuth(null);
            setAuthProof(undefined);
          }}
          onDone={finishAuth}
          onPending={authPending}
        />
      )}</Presence>
      <Presence show={track}>{track && (
        <Track
          onClose={() => setTrack(false)}
          onOpen={(id) => {
            void reload();
            openPost(id);
          }}
          onReceipt={setReceipt}
        />
      )}</Presence>
      <Presence show={!!receipt}>{receipt && (
        <Receipt
          result={receipt}
          onClose={() => {
            setReceipt(null);
            if (receipt.id) openPost(receipt.id);
          }}
          onUnlock={() => { setReceipt(null); setTrack(true); }}
        />
      )}</Presence>
      <Presence immediate={sessionBusy || sessionUnknown} show={!!detailId && !auth && !receipt && !sessionBusy && !sessionUnknown}>{detailId && !auth && !receipt && !sessionBusy && !sessionUnknown && (
        <PostDetail
          key={`${detailId}:${data.viewer?.id || "guest"}`}
          id={detailId}
          data={data}
          onClose={closePost}
          onChanged={reload}
          onAuth={() => setAuth("login")}
          toast={toast}
        />
      )}</Presence>
      <Presence show={!!rating}>{rating && (
        <Rating
          teacher={rating}
          onClose={() => setRating(null)}
          onDone={reload}
        />
      )}</Presence>
      <Presence show={!!review}>{review && (
        <Dialog
          title={`${review.name} · пікірлер`}
          onClose={() => setReview(null)}
        >
          <div className="review-summary">
            <Star fill="currentColor" size={24} />
            <strong>{review.average}</strong>
            <span>{review.count} баға</span>
          </div>
          {review.reviews.map((r, i) => (
            <article className="teacher-review" key={i}>
              <div>
                <strong>{r.name}</strong>
                <time>{date(r.date)}</time>
              </div>
              <span className="review-stars">
                {Array.from({ length: r.stars }, (_, i) => (
                  <Star key={i} size={13} fill="currentColor" />
                ))}
              </span>
              <p>{r.comment}</p>
            </article>
          ))}
          {!review.reviews.length && <Empty title="Мәтіндік пікір әлі жоқ" />}
          <button
            className="btn primary"
            onClick={() => {
              const teacher = review;
              setReview(null);
              authGate(() => setRating(teacher));
            }}
          >
            <Star size={16} />
            Бағалау
          </button>
        </Dialog>
      )}</Presence>
      <Presence show={!!manage}>{manage && (
        <ManageForm
          kind={manage}
          onClose={() => setManage(null)}
          onDone={reload}
        />
      )}</Presence>
      <Presence show={!!toastText}>{toastText && <Notice key={toastId} text={toastText} onClose={dismissToast} />}</Presence>
      <Presence show={!!feedback}>{feedback && <SessionFeedback key={feedback.id} feedback={feedback} />}</Presence>
    </>
  );
}
function PostCard({
  post: p,
  onOpen,
  onSupport,
  onSave,
  busy,
}: {
  post: Post;
  onOpen: () => void;
  onSupport: () => void;
  onSave: () => void;
  busy: boolean;
}) {
  return (
    <article className={`post-card ${p.hidden ? "hidden-post" : ""}`} aria-busy={busy}>
      <div className="post-card-meta">
        <div className="post-tags">
          <Tag post={p} />
          <StatusBadge post={p} />
          {p.flagged && (
            <Flag size={14} className="flagged" aria-label="Тексеру қажет" />
          )}
        </div>
        <small>#{p.number}</small>
      </div>
      <button className="post-open" onClick={onOpen}>
        <h2>{p.title}</h2>
        <p>{p.body}</p>
      </button>
      <div className="topic-line">
        {[p.course, p.teacher, p.customTarget]
          .filter(Boolean)
          .slice(0, 2)
          .map((t) => (
            <span key={t}>{t}</span>
          ))}
        {p.answered && (
          <span className="answered">
            <ShieldCheck size={12} />
            Ресми жауап бар
          </span>
        )}
      </div>
      <div className="post-card-footer">
        <div className="author-line">
          <span
            className={`avatar tiny-avatar ${p.anonymous ? "anonymous" : ""}`}
          >
            {p.anonymous ? <EyeOff size={12} /> : initials(p.authorName)}
          </span>
          <span>{p.authorName}</span>
          <span className="author-dot">·</span>
          <time>{date(p.createdAt)}</time>
        </div>
        <div className="post-controls">
          <button
            className={p.supported ? "supported" : ""}
            onClick={onSupport}
            disabled={busy}
            aria-pressed={p.supported}
            aria-label={`Қолдау: ${p.supports}`}
            title="Қолдау"
          >
            {busy ? <LoaderCircle size={15} className="spin" /> : <ArrowUp size={15} />}
            <span>{p.supports}</span>
          </button>
          <button
            onClick={onOpen}
            title="Пікірлер"
            aria-label={`Пікірлер: ${p.comments}`}
          >
            <MessageCircle size={15} />
            <span>{p.comments}</span>
          </button>
          <button
            className={p.saved ? "saved" : ""}
            onClick={onSave}
            disabled={busy}
            aria-pressed={p.saved}
            title="Сақтау"
            aria-label="Сақтау"
          >
            <Bookmark size={16} fill={p.saved ? "currentColor" : "none"} />
          </button>
        </div>
      </div>
    </article>
  );
}
function IntegrationStatus({ data }: { data: Boot }) {
  return (
    <section className="integration-section">
      <h2>Қызметтер</h2>
      <div>
        {[
          { name: "Хаттар", ready: data.integrations?.email },
          { name: "ИИ модерациясы", ready: data.integrations?.ai },
          { name: "Бұлттағы файлдар", ready: data.integrations?.storage },
        ].map((i) => (
          <span key={i.name}>
            <i className={i.ready ? "ready" : ""} />
            {i.name}
            <small>{i.ready ? "Бапталған" : "Қосылмаған"}</small>
          </span>
        ))}
      </div>
    </section>
  );
}
