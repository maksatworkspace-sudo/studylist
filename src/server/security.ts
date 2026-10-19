import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { localMode } from "./mode";
import type { Store } from "./store/types";

export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const token = () => randomBytes(24).toString("base64url");
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function passwordHash(value: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(value, salt, 64).toString("hex")}`;
}
export function passwordMatches(value: string, stored: string) {
  const [salt, key] = stored.split(":");
  if (!salt || !key || key.length !== 128) return false;
  return timingSafeEqual(Buffer.from(key, "hex"), scryptSync(value, salt, 64));
}
let secret: Promise<Buffer> | undefined;
async function key() {
  if (
    !localMode() &&
    (!process.env.APP_SECRET || process.env.APP_SECRET.length < 32)
  )
    throw new AppError("APP_SECRET қауіпсіз мәнмен бапталуы қажет.", 503);
  if (process.env.APP_SECRET)
    return createHash("sha256").update(process.env.APP_SECRET).digest();
  if (!localMode()) throw new AppError("APP_SECRET бапталмаған.", 503);
  return (secret ??= (async () => {
    const file = path.join(process.cwd(), ".local", "secret");
    await mkdir(path.dirname(file), { recursive: true });
    try {
      return Buffer.from(await readFile(file, "utf8"), "hex");
    } catch {
      const bytes = randomBytes(32);
      await writeFile(file, bytes.toString("hex"), { mode: 0o600, flag: "wx" });
      return bytes;
    }
  })());
}
export async function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", await key(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, encrypted, cipher.getAuthTag()]).toString(
    "base64url",
  );
}
export async function decrypt(value: string) {
  const data = Buffer.from(value, "base64url");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    await key(),
    data.subarray(0, 12),
  );
  decipher.setAuthTag(data.subarray(data.length - 16));
  return Buffer.concat([
    decipher.update(data.subarray(12, -16)),
    decipher.final(),
  ]).toString("utf8");
}
/**
 * Fixed-window limiter in the rate_limits table with the same reset
 * semantics as the original SQL upsert. Production limits are unchanged.
 */
export async function rateLimit(
  repo: Store,
  id: string,
  max: number,
  seconds: number,
) {
  const now = Date.now();
  let count: number;
  const existing = await repo.get("rate_limits", id);
  if (!existing) {
    await repo.insert("rate_limits", {
      key: id,
      count: 1,
      resets_at: new Date(now + seconds * 1000).toISOString(),
    });
    count = 1;
  } else if (Date.parse(String(existing.resets_at)) < now) {
    await repo.update("rate_limits", id, {
      count: 1,
      resets_at: new Date(now + seconds * 1000).toISOString(),
    });
    count = 1;
  } else {
    count = Number(existing.count) + 1;
    await repo.update("rate_limits", id, { count });
  }
  if (count > max)
    throw new AppError(
      "Әрекет тым жиі қайталанды. Біраздан кейін қайталап көріңіз.",
      429,
    );
}
export function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  const host = request.headers.get("host");
  // Next normalizes the internal development URL to localhost, even when opened at 127.0.0.1.
  const localHost =
    process.env.NODE_ENV !== "production" &&
    host &&
    /^(localhost|127\.0\.0\.1):\d+$/.test(host);
  if (process.env.NODE_ENV === "production" && !process.env.APP_URL)
    throw new AppError("Сайт мекенжайы әлі бапталмаған.", 503);
  const allowed = process.env.APP_URL
    ? new URL(process.env.APP_URL).origin
    : localHost
      ? `${url.protocol}//${host}`
      : url.origin;
  if (!origin || origin !== allowed)
    throw new AppError("Сұранысқа рұқсат жоқ.", 403);
}
