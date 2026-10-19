import type { AppService, ActionInputs, ActionName, DateRange, Result } from "./types";
import { ServiceError } from "./types";

const query = (range: DateRange = {}) => new URLSearchParams(
  Object.entries(range).filter(([, value]) => Boolean(value)),
).toString();
async function json<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { cache: "no-store", ...init }); }
  catch { throw new ServiceError("Байланыс үзілді. Қайта көріңіз.", 503); }
  let data;
  try { data = await response.json(); }
  catch { throw new ServiceError("Сервер жауабының пішімі қате.", 502); }
  if (!response.ok) throw new ServiceError(data.error || "Сұраныс орындалмады.", response.status);
  return data as T;
}
async function binary(url: string, fallback: string) {
  let response: Response;
  try { response = await fetch(url, { cache: "no-store" }); }
  catch { throw new ServiceError("Файл уақытша қолжетімсіз.", 503); }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ServiceError(data.error || "Файл жүктелмеді.", response.status);
  }
  const header = response.headers.get("content-disposition") || "";
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  const plain = /filename="?([^";]+)"?/i.exec(header)?.[1];
  let name = plain || fallback;
  if (encoded) { try { name = decodeURIComponent(encoded); } catch { /* Use fallback for malformed headers. */ } }
  return { blob: await response.blob(), name };
}
export function createHttpService(): AppService {
  const send = <A extends ActionName>(action: A, input: ActionInputs[A]) =>
    json<Result>("/api/actions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, action }),
    });
  return {
    mode: "http",
    boot: (range) => json(`/api/state?${query(range)}`),
    detail: (id) => json(`/api/state?post=${encodeURIComponent(id)}`),
    send,
    async upload(file, progress) {
      const prepared = await send("prepareUpload", {
        name: file.name, mime: file.type || "application/octet-stream", size: file.size,
      });
      if (!prepared.id || !prepared.url) throw new ServiceError("Жүктеу сілтемесі жоқ.", 502);
      try {
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", prepared.url!);
          xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
          xhr.timeout = 120000;
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) progress?.(Math.round(e.loaded / e.total * 100));
          };
          xhr.onload = () => xhr.status >= 200 && xhr.status < 300
            ? resolve() : reject(new ServiceError("Файл жүктелмеді.", xhr.status || 503));
          xhr.onerror = () => reject(new ServiceError("Байланыс үзілді.", 503));
          xhr.ontimeout = () => reject(new ServiceError("Жүктеу уақыты аяқталды.", 504));
          xhr.onabort = () => reject(new ServiceError("Жүктеу тоқтатылды.", 499));
          xhr.send(file);
        });
        await send("completeUpload", { id: prepared.id });
        progress?.(100);
        return prepared;
      } catch (error) {
        await send("discardUpload", { id: prepared.id }).catch(() => {});
        throw error;
      }
    },
    download: (id) => binary(`/api/files/${encodeURIComponent(id)}`, "attachment"),
    exportReport: (range) => binary(`/api/export?${query(range)}`, "maxball-report.xlsx"),
  };
}
