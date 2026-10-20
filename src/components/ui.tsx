"use client";
import {
  useEffect,
  useLayoutEffect,
  useContext,
  createContext,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import {
  X,
  LoaderCircle,
  MessageCircle,
  Lightbulb,
  CircleAlert,
  Check,
  Copy,
  Info,
  LogOut,
} from "lucide-react";
import { statusLabels, typeLabels, type Post } from "@/lib/types";

const ExitContext = createContext(false);
let dialogCount = 0;
let bodyOverflow = "";

// Retain the existing subtree for its exit, including form values on rapid reopen.
export function Presence({ show, children, immediate = false }: { show: boolean; children: ReactNode; immediate?: boolean }) {
  const [retained, setRetained] = useState(show);
  const previous = useRef(children);
  useLayoutEffect(() => {
    if (show) previous.current = children;
  }, [show, children]);
  useEffect(() => {
    if (show) { setRetained(true); return; }
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 280;
    const timer = setTimeout(() => setRetained(false), duration);
    return () => clearTimeout(timer);
  }, [show]);
  if (!show && (!retained || immediate)) return null;
  return <ExitContext.Provider value={!show}>{show ? children : previous.current}</ExitContext.Provider>;
}

export function Reveal({ className, children }: { className: string; children: ReactNode }) {
  const exiting = useContext(ExitContext);
  return <div className={`${className} ${exiting ? "exiting" : ""}`} inert={exiting}>{children}</div>;
}

export function Notice({ text, onClose }: { text: string; onClose: () => void }) {
  const exiting = useContext(ExitContext);
  return <div className={`toast ${exiting ? "exiting" : ""}`} inert={exiting}>
    <Info size={19} aria-hidden="true" />
    <span role="status" aria-hidden={exiting || undefined}>{text}</span>
    <button aria-label="Хабарды жабу" onClick={onClose}><X size={16} /></button>
    <span className="toast-progress" aria-hidden="true" />
  </div>;
}

export type AuthFeedback = { id: number; kind: "welcome" | "farewell" | "register"; name: string };
export function SessionFeedback({ feedback }: { feedback: AuthFeedback }) {
  const exiting = useContext(ExitContext);
  return <div className={`session-feedback ${exiting ? "exiting" : ""}`} inert={exiting}>
    <img src="/maxball-logo.png" alt="" />
    <div className="session-feedback-copy" role="status" aria-hidden={exiting || undefined}>
      <strong>{feedback.kind === "farewell" ? "Кездескенше!" : feedback.kind === "register" ? "Аккаунтыңыз дайын!" : "Қош келдіңіз!"}</strong>
      <span>{feedback.kind === "farewell" ? "Аккаунттан қауіпсіз шықтыңыз" : feedback.name}</span>
    </div>
    <span className={`session-feedback-check ${feedback.kind === "farewell" ? "farewell" : ""}`}>
      {feedback.kind === "farewell" ? <LogOut size={24} /> : <Check size={25} />}
    </span>
  </div>;
}

export function Dialog({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const exiting = useContext(ExitContext);
  useEffect(() => {
    const dialog = ref.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    if (dialogCount === 0) bodyOverflow = document.body.style.overflow;
    ++dialogCount;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      --dialogCount;
      if (dialogCount === 0) document.body.style.overflow = bodyOverflow;
      // A replacement dialog owns focus; do not pull it back into the page.
      if (!document.querySelector("dialog[open]") && previousFocus?.isConnected && !previousFocus.closest("[inert]"))
        previousFocus.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? "wide" : ""} ${exiting ? "exiting" : ""}`}
      inert={exiting}
      aria-hidden={exiting || undefined}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key !== "Tab" || exiting) return;
        const dialog = e.currentTarget;
        const controls = Array.from(dialog.querySelectorAll<HTMLElement>(
          "button, a[href], input, select, textarea, [tabindex]",
        )).filter((node) => node.tabIndex >= 0 && !node.matches(":disabled") &&
          !node.closest("[inert]") && node.getClientRects().length > 0 &&
          getComputedStyle(node).visibility !== "hidden");
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!first || (e.shiftKey ? document.activeElement === first : document.activeElement === last) ||
          document.activeElement === dialog) {
          e.preventDefault();
          (e.shiftKey ? last : first)?.focus();
          if (!first) dialog.focus();
        }
      }}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        const bounds = ref.current?.getBoundingClientRect();
        if (e.target === ref.current && bounds &&
          (e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom)) onClose();
      }}
      aria-label={title}
    >
      <div className="dialog-header">
        <h2>{title}</h2>
        <button
          className="icon-btn"
          aria-label="Жабу"
          title="Жабу"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}
export function Form({
  children,
  onSubmit,
  submit = "Сақтау",
  footer,
  disabled = false,
}: {
  children: ReactNode;
  onSubmit: (values: FormData) => Promise<unknown>;
  submit?: string;
  footer?: ReactNode;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  async function handle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (locked.current || disabled) return;
    locked.current = true;
    setError("");
    setBusy(true);
    try {
      await onSubmit(new FormData(e.currentTarget));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Қате орын алды.");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <form onSubmit={handle} className="form" aria-busy={busy}>
      <fieldset className="form-fields" disabled={busy || disabled}>{children}</fieldset>
      {error && (
        <p className="error" role="alert" tabIndex={-1} ref={errorRef}>
          {error}
        </p>
      )}
      <div className="form-footer">
        {footer}
        <button disabled={busy || disabled} className="btn primary" type="submit">
          {busy && <LoaderCircle className="spin" size={16} />} {submit}
        </button>
      </div>
    </form>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Tag({ post }: { post: Post }) {
  const Icon = {
    opinion: MessageCircle,
    suggestion: Lightbulb,
    issue: CircleAlert,
  }[post.type];
  return (
    <span className={`tag ${post.type}`}>
      <Icon size={13} />
      {typeLabels[post.type]}
    </span>
  );
}
export function StatusBadge({ post }: { post: Post }) {
  return post.hidden ? (
    <span className="tag hidden-tag">Жасырылған</span>
  ) : post.status ? (
    <span className={`status ${post.status}`}>
      {statusLabels[post.status]}
      {post.outcome
        ? ` · ${post.outcome === "implemented" ? "Орындалды" : "Қабылданбады"}`
        : ""}
    </span>
  ) : null;
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <MessageCircle size={30} />
      <h3>{title}</h3>
      {children}
    </div>
  );
}
/**
 * Confirmation for destructive or irreversible actions — replaces the old
 * native confirm() so the flow is styled, focus-trapped and testable.
 */
export function Confirm({
  title,
  message,
  confirmLabel = "Растау",
  danger = false,
  onConfirm,
  onClose,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={title} onClose={onClose}>
      <p className="confirm-message">{message}</p>
      <div className="dialog-actions">
        <button className="btn secondary" onClick={onClose} disabled={busy}>
          Бас тарту
        </button>
        <button
          className={`btn ${danger ? "danger" : "primary"}`}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
              onClose();
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <LoaderCircle className="spin" size={16} /> : null}
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      className="icon-btn"
      type="button"
      title="Көшіру"
      aria-label="Көшіру"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check size={17} /> : <Copy size={17} />}
    </button>
  );
}
