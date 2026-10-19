"use client";
import {
  useEffect,
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
} from "lucide-react";
import { statusLabels, typeLabels, type Post } from "@/lib/types";

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
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? "wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
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
}: {
  children: ReactNode;
  onSubmit: (values: FormData) => Promise<unknown>;
  submit?: string;
  footer?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function handle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      await onSubmit(new FormData(e.currentTarget));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Қате орын алды.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={handle} className="form">
      {children}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="form-footer">
        {footer}
        <button disabled={busy} className="btn primary" type="submit">
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
export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="icon-btn"
      type="button"
      title="Көшіру"
      aria-label="Көшіру"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check size={17} /> : <Copy size={17} />}
    </button>
  );
}
