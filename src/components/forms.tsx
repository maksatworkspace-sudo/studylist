"use client";
import { useRef, useState } from "react";
import {
  Paperclip,
  X,
  RotateCcw,
  ShieldCheck,
  EyeOff,
  Star,
  CheckCircle2,
  KeyRound,
  Send,
} from "lucide-react";
import type { Boot, FeedbackType, Teacher } from "@/lib/types";
import { roleLabels, typeLabels } from "@/lib/types";
import { send, size, type Result } from "@/lib/client";
import { CopyButton, Dialog, Field, Form } from "./ui";

type Upload = {
  file: File;
  id?: string;
  progress: number;
  state: "loading" | "ready" | "failed";
  error?: string;
};
export function Compose({
  data,
  onClose,
  onDone,
}: {
  data: Boot;
  onClose: () => void;
  onDone: (result: Result) => Promise<void>;
}) {
  const [type, setType] = useState<FeedbackType>("opinion");
  const [submitting, setSubmitting] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [fileError, setFileError] = useState("");
  const requestId = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const update = (item: Upload, change: Partial<Upload>) =>
    setUploads((current) =>
      current.map((u) => (u === item ? Object.assign(item, change) : u)),
    );
  async function upload(item: Upload) {
    update(item, { state: "loading", error: "", progress: 0 });
    try {
      if (item.id) await send("discardUpload", { id: item.id });
      const prepared = await send("prepareUpload", {
        name: item.file.name,
        mime: item.file.type || "application/octet-stream",
        size: item.file.size,
      });
      update(item, { id: prepared.id });
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", prepared.url!);
        xhr.setRequestHeader(
          "Content-Type",
          item.file.type || "application/octet-stream",
        );
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable)
            update(item, { progress: Math.round((e.loaded / e.total) * 100) });
        };
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error("Файл жүктелмеді."));
        xhr.onerror = () => reject(new Error("Байланыс үзілді."));
        xhr.send(item.file);
      });
      await send("completeUpload", { id: prepared.id });
      update(item, { state: "ready", progress: 100 });
    } catch (e) {
      update(item, {
        state: "failed",
        error: e instanceof Error ? e.message : "Жүктеу орындалмады.",
      });
    }
  }
  async function pick(files: FileList | null) {
    if (!files) return;
    setFileError("");
    const next = Array.from(files);
    if (
      next.length + uploads.length > 5 ||
      [...uploads.map((u) => u.file), ...next].reduce((n, f) => n + f.size, 0) >
        20971520
    ) {
      setFileError("Ең көбі 5 файл, жалпы 20 МБ.");
      return;
    }
    const items = next.map((file) => ({
      file,
      progress: 0,
      state: "loading" as const,
    }));
    setUploads((current) => [...current, ...items]);
    for (const item of items) await upload(item);
  }
  async function remove(item: Upload) {
    try {
      if (item.id) await send("discardUpload", { id: item.id });
      setUploads((current) => current.filter((u) => u !== item));
    } catch (e) {
      setFileError((e as Error).message);
    }
  }
  async function close() {
    if (submitting || uploads.some((u) => u.state === "loading")) return;
    for (const item of uploads) {
      if (item.id) await send("discardUpload", { id: item.id }).catch(() => {});
    }
    onClose();
  }
  return (
    <Dialog title="Кері байланыс қалдыру" onClose={close} wide>
      <Form
        submit="Жариялау"
        onSubmit={async (f) => {
          if (uploads.some((u) => u.state !== "ready"))
            throw new Error(
              "Файлдарды толық жүктеңіз немесе тізімнен алып тастаңыз.",
            );
          requestId.current ??= crypto.randomUUID();
          setSubmitting(true);
          try {
            await onDone(
              await send("createPost", {
                requestId: requestId.current,
                type,
                anonymous,
                title: f.get("title"),
                body: f.get("body"),
                authorName: f.get("authorName") || "",
                email: f.get("email") || "",
                courseId: f.get("courseId") || null,
                teacherId: f.get("teacherId") || null,
                customTarget: f.get("customTarget") || "",
                attachments: uploads.map((u) => u.id),
              }),
            );
          } finally {
            setSubmitting(false);
          }
        }}
        footer={
          <span className="muted small">
            <ShieldCheck size={15} /> Деректеріңіз қорғалған
          </span>
        }
      >
        <div className="segmented">
          {(Object.keys(typeLabels) as FeedbackType[]).map((t) => (
            <button
              type="button"
              key={t}
              className={type === t ? "selected" : ""}
              onClick={() => setType(t)}
            >
              {typeLabels[t]}
            </button>
          ))}
        </div>
        <Field label="Тақырып">
          <input
            name="title"
            required
            minLength={3}
            maxLength={160}
            placeholder="Не туралы айтқыңыз келеді?"
            autoFocus
          />
        </Field>
        <Field label="Мәтін">
          <textarea
            name="body"
            required
            minLength={10}
            maxLength={10000}
            rows={5}
            placeholder="Ойыңызды, ұсынысыңызды немесе мәселеңізді жазыңыз"
          />
        </Field>
        <div className="two-col">
          <Field label="Курс">
            <select name="courseId">
              <option value="">Орталық туралы</option>
              {data.courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Оқытушы">
            <select name="teacherId">
              <option value="">Таңдалмаған</option>
              {data.teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Басқа тақырып (міндетті емес)">
          <input
            name="customTarget"
            maxLength={160}
            placeholder="Тізімде жоқ курс немесе оқытушы"
          />
        </Field>
        <label className="switch-line">
          <span>
            <EyeOff size={18} />
            <span>Анонимді жариялау</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={anonymous}
            onChange={(e) => setAnonymous(e.target.checked)}
          />
        </label>
        {!data.viewer && (
          <div className="two-col">
            {!anonymous && (
              <Field label="Атыңыз">
                <input
                  name="authorName"
                  required
                  minLength={2}
                  maxLength={100}
                  autoComplete="name"
                />
              </Field>
            )}
            <Field label="Email (міндетті емес)">
              <input
                name="email"
                type="email"
                autoComplete="email"
                placeholder="Жауап пен қалпына келтіру үшін"
              />
            </Field>
          </div>
        )}
        <div className="attachment-area">
          <input
            hidden
            ref={fileRef}
            type="file"
            multiple
            onChange={(e) => {
              void pick(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="btn secondary"
            onClick={() => fileRef.current?.click()}
            disabled={uploads.length >= 5}
          >
            <Paperclip size={17} />
            Файл тіркеу
          </button>
          <small>5 файлға дейін · жалпы 20 МБ</small>
        </div>
        {uploads.map((u, i) => (
          <div className="upload-row" key={i}>
            <Paperclip size={17} />
            <div>
              <strong>{u.file.name}</strong>
              <small>
                {size(u.file.size)} ·{" "}
                {u.state === "ready"
                  ? "Жүктелді"
                  : u.state === "failed"
                    ? u.error
                    : `${u.progress}%`}
              </small>
              {u.state === "loading" && (
                <progress max={100} value={u.progress} />
              )}
            </div>
            {u.state === "failed" && (
              <button
                className="icon-btn"
                type="button"
                title="Қайта жүктеу"
                aria-label="Қайта жүктеу"
                onClick={() => upload(u)}
              >
                <RotateCcw size={16} />
              </button>
            )}
            <button
              className="icon-btn"
              type="button"
              title="Файлды алып тастау"
              aria-label="Файлды алып тастау"
              disabled={u.state === "loading"}
              onClick={() => remove(u)}
            >
              <X size={16} />
            </button>
          </div>
        ))}
        {fileError && (
          <p role="alert" className="error">
            {fileError}
          </p>
        )}
      </Form>
    </Dialog>
  );
}

export function Receipt({
  result,
  onClose,
}: {
  result: Result;
  onClose: () => void;
}) {
  return (
    <Dialog title="Жазбаңыз жарияланды" onClose={onClose}>
      <div className="receipt">
        <CheckCircle2 size={42} />
        <h3>Өтініш №{result.number}</h3>
        <p>Құпия код тек осы жерде көрсетіледі. Оны сенімді жерде сақтаңыз.</p>
        <div className="secret-code">
          <code>{result.code}</code>
          <CopyButton value={`№${result.number}\n${result.code}`} />
        </div>
        <p className="muted small">
          Жазбаны басқару үшін өтініш нөмірі мен осы код қажет. Код пен қалпына
          келтіру email-ы болмаса, қолжетімділік қайтарылмайды.
        </p>
        <button className="btn primary" onClick={onClose}>
          Түсінікті
        </button>
      </div>
    </Dialog>
  );
}

export function Auth({
  initial = "login",
  proof,
  viewer,
  onClose,
  onDone,
}: {
  initial?: string;
  proof?: string;
  viewer: Boot["viewer"];
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [mode, setMode] = useState(initial);
  const [message, setMessage] = useState("");
  const [local, setLocal] = useState<Result | null>(null);
  const titles: Record<string, string> = {
    login: "Қайта қош келдіңіз!",
    register: "Аккаунт ашу",
    forgot: "Құпиясөзді қалпына келтіру",
    reset: "Жаңа құпиясөз",
    profile: "Менің профилім",
    verify: "Email растауын қайта жіберу",
  };
  return (
    <Dialog title={titles[mode] || "Аккаунт"} onClose={onClose}>
      <Form
        key={mode}
        submit={
          mode === "login"
            ? "Кіру"
            : mode === "register"
              ? "Тіркелу"
              : mode === "forgot"
                ? "Сілтемені жіберу"
                : mode === "verify"
                  ? "Растау хатын жіберу"
                  : "Сақтау"
        }
        onSubmit={async (f) => {
          const action = {
            login: "login",
            register: "register",
            forgot: "forgotPassword",
            reset: "resetPassword",
            profile: "updateProfile",
            verify: "resendConfirmation",
          }[mode]!;
          const result = await send(action, {
            ...Object.fromEntries(f),
            token: proof || local?.localToken,
          });
          if (result.localToken) {
            setLocal(result);
            setMessage(result.message || "");
            if (result.tokenPurpose === "password") setMode("reset");
            return;
          }
          if (mode === "forgot" || mode === "register" || mode === "verify") {
            setMessage(result.message || "Хат жіберілді.");
            return;
          }
          await onDone();
          onClose();
        }}
      >
        {(mode === "register" || mode === "profile") && (
          <Field label="Аты-жөніңіз">
            <input
              name="name"
              required
              minLength={2}
              maxLength={100}
              autoComplete="name"
              defaultValue={mode === "profile" ? viewer?.name : ""}
            />
          </Field>
        )}
        {mode !== "reset" && mode !== "profile" && (
          <Field label="Email">
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="name@example.com"
              defaultValue={mode === "verify" ? viewer?.email : ""}
            />
          </Field>
        )}
        {(mode === "register" || mode === "profile") && (
          <Field label="Телефон">
            <input
              name="phone"
              type="tel"
              required
              minLength={8}
              maxLength={30}
              autoComplete="tel"
              defaultValue={mode === "profile" ? viewer?.phone : ""}
              placeholder="+7 ..."
            />
          </Field>
        )}
        {(mode === "register" || mode === "login" || mode === "reset") && (
          <Field
            label="Құпиясөз"
            hint={mode !== "login" ? "Кемінде 10 таңба" : undefined}
          >
            <input
              name="password"
              type="password"
              required
              minLength={mode === "login" ? 1 : 10}
              maxLength={128}
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
            />
          </Field>
        )}
        {message && (
          <p className="success" role="status">
            {message}
          </p>
        )}
        {local?.tokenPurpose === "verify" && (
          <button
            type="button"
            className="btn secondary"
            onClick={async () => {
              try {
                await send("confirmEmail", { token: local.localToken });
                await onDone();
                onClose();
              } catch (e) {
                setMessage((e as Error).message);
              }
            }}
          >
            <CheckCircle2 size={17} />
            Сынақ email-ын растау
          </button>
        )}
      </Form>
      {mode === "login" && (
        <div className="auth-links">
          <button
            onClick={() => {
              setMode("verify");
              setMessage("");
            }}
          >
            Растау хаты келмеді
          </button>
          <button
            onClick={() => {
              setMode("forgot");
              setMessage("");
            }}
          >
            Құпиясөзді ұмыттыңыз ба?
          </button>
          <span>
            Аккаунтыңыз жоқ па?{" "}
            <button onClick={() => setMode("register")}>Тіркелу</button>
          </span>
        </div>
      )}
      {(mode === "register" || mode === "forgot" || mode === "verify") && (
        <button
          className="text-btn auth-back"
          onClick={() => {
            setMode("login");
            setMessage("");
            setLocal(null);
          }}
        >
          Кіруге оралу
        </button>
      )}
    </Dialog>
  );
}

export function Track({
  onClose,
  onOpen,
  onReceipt,
}: {
  onClose: () => void;
  onOpen: (id: string) => void;
  onReceipt: (result: Result) => void;
}) {
  const [recover, setRecover] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  return (
    <Dialog
      title={recover ? "Қолжетімділікті қалпына келтіру" : "Өтінішті табу"}
      onClose={onClose}
    >
      <Form
        key={String(recover)}
        submit={recover ? "Сілтемені жіберу" : "Өтінішті ашу"}
        onSubmit={async (f) => {
          const result = await send(
            recover ? "recoverPost" : "unlockPost",
            Object.fromEntries(f),
          );
          if (recover) setResult(result);
          else {
            onClose();
            onOpen(result.id!);
          }
        }}
      >
        {recover ? (
          <Field label="Бұрын қалдырған email">
            <input type="email" name="email" required />
          </Field>
        ) : (
          <>
            <Field label="Өтініш нөмірі">
              <input
                type="number"
                name="number"
                min={1}
                required
                placeholder="1001"
              />
            </Field>
            <Field label="Құпия код">
              <input name="code" required autoComplete="off" />
            </Field>
          </>
        )}
        {result?.message && <p className="success">{result.message}</p>}
        {result?.localToken && (
          <button
            type="button"
            className="btn secondary"
            onClick={async () => {
              const receipt = await send("resetGuestCode", {
                token: result.localToken,
              });
              onClose();
              onReceipt(receipt);
            }}
          >
            <KeyRound size={17} />
            Сынақ сілтемесін ашу
          </button>
        )}
      </Form>
      <button
        className="text-btn auth-back"
        onClick={() => {
          setRecover(!recover);
          setResult(null);
        }}
      >
        {recover ? "Құпия кодпен ашу" : "Құпия кодты жоғалттым"}
      </button>
    </Dialog>
  );
}

export function Rating({
  teacher,
  onClose,
  onDone,
}: {
  teacher: Teacher;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [stars, setStars] = useState(teacher.myStars || 0);
  const [hover, setHover] = useState(0);
  return (
    <Dialog title={teacher.name} onClose={onClose}>
      <p className="muted">{teacher.subject}</p>
      <Form
        submit="Бағаны сақтау"
        onSubmit={async (f) => {
          if (!stars) throw new Error("1–5 жұлдыздың бірін таңдаңыз.");
          await send("rateTeacher", {
            id: teacher.id,
            stars,
            comment: f.get("comment"),
          });
          await onDone();
          onClose();
        }}
      >
        <div
          className="rating-picker"
          onMouseLeave={() => setHover(0)}
          role="group"
          aria-label="Оқытушы бағасы"
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              aria-label={`${n} жұлдыз`}
              aria-pressed={stars === n}
              onClick={() => setStars(n)}
              onMouseEnter={() => setHover(n)}
            >
              <Star
                size={34}
                fill={(hover || stars) >= n ? "currentColor" : "none"}
              />
            </button>
          ))}
          <strong>{stars ? `${stars} / 5` : "Баға таңдаңыз"}</strong>
        </div>
        <Field
          label="Пікір (міндетті емес)"
          hint="Пікір атыңызбен жарияланады."
        >
          <textarea
            name="comment"
            rows={4}
            maxLength={3000}
            defaultValue={teacher.myComment}
            placeholder="Оқытушы туралы ойыңыз"
          />
        </Field>
      </Form>
    </Dialog>
  );
}

export function ManageForm({
  kind,
  onClose,
  onDone,
}: {
  kind: "person" | "course" | "teacher";
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  return (
    <Dialog
      title={
        { person: "Адам қосу", course: "Курс қосу", teacher: "Оқытушы қосу" }[
          kind
        ]
      }
      onClose={onClose}
    >
      <Form
        submit={kind === "person" ? "Шақыру жіберу" : "Қосу"}
        onSubmit={async (f) => {
          await send(
            {
              person: "createStaff",
              course: "addCourse",
              teacher: "addTeacher",
            }[kind],
            Object.fromEntries(f),
          );
          await onDone();
          onClose();
        }}
      >
        <Field label={kind === "course" ? "Курс атауы" : "Аты-жөні"}>
          <input name="name" required minLength={2} maxLength={100} />
        </Field>
        {kind === "person" && (
          <>
            <Field label="Email">
              <input type="email" name="email" required />
            </Field>
            <Field label="Телефон">
              <input
                type="tel"
                name="phone"
                required
                minLength={8}
                maxLength={30}
              />
            </Field>
            <Field label="Рөл">
              <select name="role">
                {Object.entries(roleLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
        {kind !== "course" && (
          <Field label="Пәні (оқытушы үшін)">
            <input name="subject" maxLength={100} defaultValue="Жалпы курс" />
          </Field>
        )}
      </Form>
    </Dialog>
  );
}
export function CatalogEdit({
  item,
  kind,
  onClose,
  onDone,
}: {
  item: { id: string; name: string; subject?: string; active: boolean };
  kind: "course" | "teacher";
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  return (
    <Dialog title="Тізімді өзгерту" onClose={onClose}>
      <Form
        onSubmit={async (f) => {
          await send("updateCatalog", {
            id: item.id,
            kind,
            name: f.get("name"),
            subject: f.get("subject") || "Жалпы курс",
            active: f.has("active"),
          });
          await onDone();
          onClose();
        }}
      >
        <Field label="Атауы">
          <input
            name="name"
            required
            minLength={2}
            maxLength={100}
            defaultValue={item.name}
          />
        </Field>
        {kind === "teacher" && (
          <Field label="Пәні">
            <input
              name="subject"
              required
              maxLength={100}
              defaultValue={item.subject}
            />
          </Field>
        )}
        <label className="switch-line">
          <span>Белсенді</span>
          <input
            type="checkbox"
            role="switch"
            name="active"
            defaultChecked={item.active}
          />
        </label>
      </Form>
    </Dialog>
  );
}
