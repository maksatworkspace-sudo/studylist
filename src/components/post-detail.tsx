"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Bookmark,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  Flag,
  LoaderCircle,
  Pencil,
  Reply,
  Share2,
  ShieldCheck,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  type Boot,
  type Comment,
  type Detail,
  type Status,
  isManager,
  statusLabels,
} from "@/lib/types";
import { date, downloadFile, initials, read, send, size } from "@/lib/client";
import { Confirm, CopyButton, Dialog, Field, Form, StatusBadge, Tag } from "./ui";
import { ReportDialog } from "./forms";

export default function PostDetail({
  id,
  data,
  onClose,
  onChanged,
  onAuth,
  toast,
}: {
  id: string;
  data: Boot;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onAuth: () => void;
  toast: (message: string) => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [edit, setEdit] = useState(false);
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [moderate, setModerate] = useState(false);
  const [reportTarget, setReportTarget] = useState<{
    type: "post" | "comment";
    id: string;
  } | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    run: () => Promise<void>;
  } | null>(null);
  const [commentMod, setCommentMod] = useState<{
    id: string;
    mode: "hide" | "delete";
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const request = useRef(0);
  const load = useCallback(async () => {
    const version = ++request.current;
    const next = await read<Detail>(`/api/state?post=${id}`);
    if (version === request.current) { setDetail(next); setError(""); }
  }, [id]);
  useEffect(() => {
    let active = true;
    setDetail(null);
    void load().catch((e) => { if (active) setError(e.message); });
    return () => { active = false; ++request.current; };
  }, [load, data.viewer?.id]);
  async function mutate(name: string, values: Record<string, unknown> = {}) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      await send(name, { id, ...values });
      await load();
      await onChanged();
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function command(name: string, values: Record<string, unknown> = {}) {
    try {
      await mutate(name, values);
    } catch (e) {
      toast((e as Error).message);
    }
  }
  if (!detail)
    return (
      <Dialog title="Кері байланыс" onClose={onClose} wide>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : (
          <div className="loading">
            <LoaderCircle className="spin" /> Жүктелуде
          </div>
        )}
      </Dialog>
    );
  const p = detail.post;
  const manager = isManager(data.viewer?.role);
  const requireAuth = (action: () => void) =>
    data.viewer?.verified ? action() : onAuth();
  return (
    <Dialog title={`Өтініш №${p.number}`} onClose={onClose} wide>
      <article className="post-detail">
        <div className="post-tags">
          <Tag post={p} />
          <StatusBadge post={p} />
          {p.flagged && (
            <span className="tag issue">
              <Flag size={13} />
              Тексеру қажет
            </span>
          )}
        </div>
        {edit ? (
          <Form
            submit="Өзгерісті сақтау"
            onSubmit={async (f) => {
              await mutate("editPost", Object.fromEntries(f));
              setEdit(false);
            }}
            footer={
              <button
                type="button"
                className="text-btn"
                onClick={() => setEdit(false)}
              >
                Бас тарту
              </button>
            }
          >
            <Field label="Тақырып">
              <input
                name="title"
                required
                minLength={3}
                maxLength={160}
                defaultValue={p.title}
              />
            </Field>
            <Field label="Мәтін">
              <textarea
                name="body"
                required
                minLength={10}
                maxLength={10000}
                rows={6}
                defaultValue={p.body}
              />
            </Field>
          </Form>
        ) : (
          <>
            <h1>{p.title}</h1>
            <div className="author-line">
              <span
                className={`avatar small-avatar ${p.anonymous ? "anonymous" : ""}`}
              >
                {p.anonymous ? <EyeOff size={15} /> : initials(p.authorName)}
              </span>
              <strong>{p.authorName}</strong>
              <span>·</span>
              <time>{date(p.createdAt)}</time>
              {p.updatedAt !== p.createdAt && <span>· өзгертілген</span>}
            </div>
            <p className="post-body">{p.body}</p>
          </>
        )}
        {p.hidden && (
          <p className="error">
            <EyeOff size={16} /> Жасыру себебі: {p.hiddenReason}
          </p>
        )}
        {(p.course || p.teacher || p.customTarget) && (
          <div className="topic-line">
            {[p.course, p.teacher, p.customTarget].filter(Boolean).map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
        )}
        {detail.attachments.length > 0 && (
          <div className="file-list">
            {detail.attachments.map((f) => (
              <a href="#" key={f.id} className="file-link" onClick={(event) => {
                event.preventDefault();
                void downloadFile(f.id).catch((error) => toast(error.message));
              }}>
                <Download size={17} />
                <span>
                  {f.name}
                  <small>{size(f.size)}</small>
                </span>
              </a>
            ))}
          </div>
        )}
        <div className="detail-actions">
          <button
            className={`btn secondary ${p.supported ? "active" : ""}`}
            disabled={busy}
            aria-pressed={p.supported}
            onClick={() => requireAuth(() => void command("toggleSupport"))}
          >
            {busy ? <LoaderCircle size={17} className="spin" /> : <ArrowUp size={17} />}
            {p.supports} Қолдау
          </button>
          <button
            className={`icon-btn ${p.saved ? "active" : ""}`}
            title="Сақтау"
            aria-label="Сақтау"
            aria-pressed={p.saved}
            disabled={busy}
            onClick={() => requireAuth(() => void command("toggleBookmark"))}
          >
            <Bookmark size={18} fill={p.saved ? "currentColor" : "none"} />
          </button>
          <CopyButton
            value={`${typeof location !== "undefined" ? location.origin : ""}/?post=${id}`}
          />
          <button
            className="icon-btn"
            aria-label="Бөлісу"
            title="Бөлісу"
            onClick={async () => {
              const url = `${location.origin}/?post=${id}`;
              try {
                if (navigator.share)
                  await navigator.share({ title: p.title, url });
                else {
                  await navigator.clipboard.writeText(url);
                  toast("Сілтеме көшірілді.");
                }
              } catch (e) {
                if ((e as Error).name !== "AbortError")
                  toast("Бөлісу орындалмады.");
              }
            }}
          >
            <Share2 size={17} />
          </button>
          <button
            className="icon-btn"
            aria-label="Шағым беру"
            title="Шағым беру"
            onClick={() => setReportTarget({ type: "post", id })}
          >
            <Flag size={17} />
          </button>
          {p.canEdit && (
            <>
              <button
                className="icon-btn"
                title="Өзгерту"
                aria-label="Өзгерту"
                onClick={() => setEdit(!edit)}
              >
                <Pencil size={17} />
              </button>
              <button
                className="icon-btn danger"
                title="Жазбаны өшіру"
                aria-label="Жазбаны өшіру"
                onClick={() =>
                  setConfirmAction({
                    title: "Жазбаны өшіру",
                    message:
                      "Жазба мен оған тіркелген пікірлер және файлдар өшірілсін бе?",
                    confirmLabel: "Өшіру",
                    run: async () => {
                      await send("deletePost", { id });
                      await onChanged();
                      onClose();
                    },
                  })
                }
              >
                <Trash2 size={17} />
              </button>
            </>
          )}
          {manager && (
            <button
              className="icon-btn"
              title="Модерация"
              aria-label="Модерация"
              onClick={() => setModerate(!moderate)}
            >
              <Flag size={17} />
            </button>
          )}
        </div>
        {p.isOwner && p.status === "resolved" && (
          <div className="resolution">
            <CheckCircle2 size={20} />
            <div>
              <strong>
                {p.confirmed
                  ? "Шешілгенін растадыңыз"
                  : "Мәселеңіз шешілді ме?"}
              </strong>
              <div className="button-row">
                {!p.confirmed && (
                  <button
                    className="btn secondary"
                    onClick={() => command("resolution", { resolved: true })}
                  >
                    <CheckCircle2 size={15} />
                    Иә, шешілді
                  </button>
                )}
                <button
                  className="text-btn"
                  onClick={() => command("resolution", { resolved: false })}
                >
                  <Undo2 size={15} />
                  Әлі шешілген жоқ
                </button>
              </div>
            </div>
          </div>
        )}
        {manager && (
          <section className="manager-tools">
            <h3>
              <ShieldCheck size={18} />
              Басқару
            </h3>
            {detail.contact && (
              <p className="muted small">
                {detail.contact.email} · {detail.contact.phone}
              </p>
            )}
            {detail.moderationReasons.map((reason, i) => (
              <p className="error" key={i}>
                ИИ белгісі: {reason}
              </p>
            ))}
            {p.type !== "opinion" && (
              <Form
                submit="Мәртебені сақтау"
                onSubmit={async (f) => {
                  await mutate("setStatus", {
                    status: f.get("status"),
                    outcome: f.get("outcome") || null,
                  });
                  toast("Мәртебе жаңартылды.");
                }}
              >
                <div className="two-col">
                  <Field label="Мәртебе">
                    <select name="status" defaultValue={p.status!}>
                      {(p.type === "issue"
                        ? ["new", "reviewing", "resolved"]
                        : ["in_progress", "reviewed"]
                      ).map((s) => (
                        <option key={s} value={s}>
                          {statusLabels[s as Status]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {p.type === "suggestion" && (
                    <Field label="Қарау нәтижесі">
                      <select name="outcome" defaultValue={p.outcome || ""}>
                        <option value="">Әлі анықталмаған</option>
                        <option value="implemented">Орындалды</option>
                        <option value="declined">Қабылданбады</option>
                      </select>
                    </Field>
                  )}
                </div>
              </Form>
            )}
            {moderate && (
              <Form
                submit={p.hidden ? "Қайта көрсету" : "Жасыру"}
                onSubmit={async (f) => {
                  await mutate("moderate", {
                    mode: p.hidden ? "restore" : "hide",
                    reason: f.get("reason") || "",
                  });
                  setModerate(false);
                }}
                footer={
                  <button
                    className="text-btn danger"
                    type="button"
                    onClick={() =>
                      setConfirmAction({
                        title: "Жазбаны толық өшіру",
                        message:
                          "Жазба, пікірлер және файлдар толық өшіріледі. Әрекетті қайтару мүмкін емес.",
                        confirmLabel: "Толық өшіру",
                        run: async () => {
                          await send("moderate", { id, mode: "delete" });
                          await onChanged();
                          onClose();
                        },
                      })
                    }
                  >
                    <Trash2 size={15} />
                    Толық өшіру
                  </button>
                }
              >
                {!p.hidden && (
                  <Field label="Жасыру себебі">
                    <textarea
                      name="reason"
                      required
                      minLength={3}
                      maxLength={1000}
                      rows={2}
                    />
                  </Field>
                )}
              </Form>
            )}
          </section>
        )}
        {detail.replies.map((r) => (
          <div className="official-reply" key={r.id}>
            <div>
              <ShieldCheck size={18} />
              <strong>MAXBALL EDTECH ресми жауабы</strong>
              <time>{date(r.createdAt)}</time>
            </div>
            <p>{r.body}</p>
            <small>{r.name}</small>
          </div>
        ))}
        {manager && (
          <section className="reply-section">
            <h3>Ресми жауап</h3>
            <Form
              submit="Жауапты жариялау"
              onSubmit={async (f) => {
                await mutate("officialReply", { body: f.get("body") });
                toast("Ресми жауап жарияланды.");
              }}
            >
              <Field label="Жауап мәтіні">
                <textarea
                  name="body"
                  required
                  minLength={3}
                  maxLength={10000}
                  rows={3}
                />
              </Field>
            </Form>
          </section>
        )}
        {detail.history.length > 0 && (
          <details className="history">
            <summary>Мәртебе тарихы · {detail.history.length}</summary>
            {detail.history.map((h, i) => (
              <div key={i}>
                <span className="history-dot" />
                <span>
                  {statusLabels[h.status]}
                  {h.outcome
                    ? ` · ${h.outcome === "implemented" ? "Орындалды" : "Қабылданбады"}`
                    : ""}
                </span>
                <time>{date(h.createdAt)}</time>
              </div>
            ))}
          </details>
        )}
        <section className="comments-section">
          <h3>
            Талқылау <span>{p.comments}</span>
          </h3>
          {detail.comments
            .filter((c) => !c.parentId)
            .map((c) => (
              <div className="comment-thread" key={c.id}>
                <CommentRow
                  comment={c}
                  manager={manager}
                  onReport={(id) => setReportTarget({ type: "comment", id })}
                  onModerate={(id, mode) => {
                    if (mode === "restore")
                      void (async () => {
                        try {
                          await send("moderateComment", { id, mode });
                          await load();
                          await onChanged();
                        } catch (e) {
                          toast((e as Error).message);
                        }
                      })();
                    else setCommentMod({ id, mode });
                  }}
                  onReply={() => setReplyTo(c)}
                  onSave={async (name, body) => {
                    await send(name, { id: c.id, body });
                    await load();
                    await onChanged();
                  }}
                />
                {detail.comments
                  .filter((r) => r.parentId === c.id)
                  .map((r) => (
                    <div className="nested-comment" key={r.id}>
                      <CommentRow
                        comment={r}
                        manager={manager}
                        onReport={(id) =>
                          setReportTarget({ type: "comment", id })
                        }
                        onModerate={(id, mode) => {
                          if (mode === "restore")
                            void (async () => {
                              try {
                                await send("moderateComment", { id, mode });
                                await load();
                                await onChanged();
                              } catch (e) {
                                toast((e as Error).message);
                              }
                            })();
                          else setCommentMod({ id, mode });
                        }}
                        onSave={async (name, body) => {
                          await send(name, { id: r.id, body });
                          await load();
                          await onChanged();
                        }}
                      />
                    </div>
                  ))}
              </div>
            ))}
          {!detail.comments.length && (
            <p className="muted small">Әзірге пікір жоқ.</p>
          )}
          {p.hidden ? (
            <p className="muted small">
              Жасырылған жазбада талқылау тоқтатылған.
            </p>
          ) : data.viewer?.verified ? (
            <div className="comment-compose">
              {replyTo && (
                <div className="reply-target">
                  <Reply size={14} />
                  {replyTo.name}
                  <button className="text-btn" onClick={() => setReplyTo(null)}>
                    Бас тарту
                  </button>
                </div>
              )}
              <Form
                key={replyTo?.id || `comment-${detail.comments.length}`}
                submit="Жіберу"
                onSubmit={async (f) => {
                  await mutate("comment", {
                    body: f.get("body"),
                    parentId: replyTo?.id || null,
                  });
                  setReplyTo(null);
                }}
              >
                <Field label="Пікіріңіз">
                  <textarea
                    name="body"
                    required
                    maxLength={5000}
                    rows={3}
                    placeholder="Талқылауға қосылыңыз"
                  />
                </Field>
              </Form>
            </div>
          ) : (
            <button className="btn secondary" onClick={onAuth}>
              Талқылауға қосылу үшін кіру
            </button>
          )}
        </section>
      </article>
      {reportTarget && (
        <ReportDialog
          targetType={reportTarget.type}
          targetId={reportTarget.id}
          onClose={() => setReportTarget(null)}
          onDone={toast}
        />
      )}
      {confirmAction && (
        <Confirm
          title={confirmAction.title}
          message={confirmAction.message}
          confirmLabel={confirmAction.confirmLabel}
          danger
          onConfirm={confirmAction.run}
          onClose={() => setConfirmAction(null)}
        />
      )}
      {commentMod?.mode === "hide" && (
        <Dialog
          title="Пікірді жасыру"
          onClose={() => setCommentMod(null)}
        >
          <Form
            submit="Жасыру"
            onSubmit={async (f) => {
              const target = commentMod.id;
              setCommentMod(null);
              try {
                await send("moderateComment", {
                  id: target,
                  mode: "hide",
                  reason: String(f.get("reason")),
                });
                await load();
                await onChanged();
              } catch (e) {
                toast((e as Error).message);
              }
            }}
          >
            <Field label="Жасыру себебі">
              <textarea
                name="reason"
                required
                minLength={3}
                maxLength={1000}
                rows={2}
              />
            </Field>
          </Form>
        </Dialog>
      )}
      {commentMod?.mode === "delete" && (
        <Confirm
          title="Пікірді өшіру (модерация)"
          message="Пікір толық өшіріледі. Әрекетті қайтару мүмкін емес."
          confirmLabel="Өшіру"
          danger
          onConfirm={async () => {
            const target = commentMod.id;
            try {
              await send("moderateComment", { id: target, mode: "delete" });
              await load();
              await onChanged();
            } catch (e) {
              toast((e as Error).message);
            }
          }}
          onClose={() => setCommentMod(null)}
        />
      )}
    </Dialog>
  );
}
function CommentRow({
  comment: c,
  onReply,
  onSave,
  manager,
  onReport,
  onModerate,
}: {
  comment: Comment;
  onReply?: () => void;
  onSave: (action: string, body?: string) => Promise<void>;
  manager: boolean;
  onReport: (id: string) => void;
  onModerate: (id: string, mode: "hide" | "restore" | "delete") => void;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  return (
    <div className={`comment ${c.hidden ? "hidden-comment" : ""}`}>
      <span className="avatar small-avatar">{initials(c.name)}</span>
      <div className="comment-content">
        <div className="comment-meta">
          <strong>{c.name}</strong>
          <time>{date(c.createdAt)}</time>
        </div>
        {editing ? (
          <Form
            onSubmit={async (f) => {
              await onSave("editComment", String(f.get("body")));
              setEditing(false);
            }}
          >
            <textarea
              name="body"
              required
              maxLength={5000}
              defaultValue={c.body}
              rows={2}
            />
          </Form>
        ) : (
          <p>{c.body || "Пікір өшірілген"}</p>
        )}
        {c.hidden && c.hiddenReason && manager && (
          <p className="comment-hidden-reason">
            <EyeOff size={13} /> Жасыру себебі: {c.hiddenReason}
          </p>
        )}
        <div className="comment-tools">
          {!c.deleted && onReply && (
            <button onClick={onReply}>
              <Reply size={13} />
              Жауап беру
            </button>
          )}
          <button onClick={() => onReport(c.id)} disabled={c.deleted}>
            <Flag size={13} />
            Шағым беру
          </button>
          {!c.deleted && c.mine && (
            <>
              <button
                aria-label="Пікірді өзгерту"
                title="Пікірді өзгерту"
                onClick={() => setEditing(!editing)}
              >
                <Pencil size={13} />
              </button>
              <button
                aria-label="Пікірді өшіру"
                title="Пікірді өшіру"
                onClick={() => setConfirming(true)}
              >
                <Trash2 size={13} />
              </button>
            </>
          )}
          {manager && !c.deleted && (
            <>
              {c.hidden ? (
                <button onClick={() => onModerate(c.id, "restore")}>
                  <Undo2 size={13} />
                  Қайта көрсету
                </button>
              ) : (
                <button onClick={() => onModerate(c.id, "hide")}>
                  <EyeOff size={13} />
                  Жасыру
                </button>
              )}
              <button
                className="danger"
                aria-label="Пікірді өшіру (модерация)"
                title="Пікірді өшіру (модерация)"
                onClick={() => onModerate(c.id, "delete")}
              >
                <Trash2 size={13} />
              </button>
            </>
          )}
        </div>
        {error && <p className="error">{error}</p>}
        {confirming && (
          <Confirm
            title="Пікірді өшіру"
            message="Пікіріңіз өшірілсін бе?"
            confirmLabel="Өшіру"
            danger
            onConfirm={async () => {
              try {
                await onSave("deleteComment");
              } catch (e) {
                setError((e as Error).message);
              }
            }}
            onClose={() => setConfirming(false)}
          />
        )}
      </div>
    </div>
  );
}
