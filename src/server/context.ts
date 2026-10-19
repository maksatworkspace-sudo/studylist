import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { database, localMode, type Database } from "./db";
import { AppError, decrypt, encrypt, hash, token } from "./security";
import type { Viewer } from "@/lib/types";

export type Context = {
  db: Database;
  viewer: Viewer | null;
  sessionHash: string;
  newToken?: string;
  ip: string;
  demo: boolean;
};
export const supabase = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new AppError("Аккаунт қызметі әлі бапталмаған.", 503);
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
};
export const supabaseAdmin = () => {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  )
    throw new AppError("Қызметтік қолжетімділік бапталмаған.", 503);
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
};
export async function context(request: Request): Promise<Context> {
  const db = await database();
  const jar = await cookies();
  const raw = jar.get("maxball_session")?.value;
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const ctx: Context = {
    db,
    viewer: null,
    sessionHash: raw ? hash(raw) : "",
    ip,
    demo: localMode(),
  };
  let session = raw
    ? (
        await db.query<{
          profile_id: string | null;
          provider_session: string | null;
        }>(
          "SELECT profile_id,provider_session FROM private.sessions WHERE token_hash=$1 AND expires_at>now()",
          [ctx.sessionHash],
        )
      )[0]
    : null;
  if (!session) {
    await rotateSession(ctx, null);
    session = null;
  }
  if (session?.profile_id) {
    let valid = ctx.demo;
    if (!valid && session.provider_session) {
      const stored = JSON.parse(await decrypt(session.provider_session));
      const auth = supabase();
      let result = await auth.auth.getUser(stored.access_token);
      if (result.error) {
        const refreshed = await auth.auth.refreshSession({
          refresh_token: stored.refresh_token,
        });
        if (refreshed.data.session) {
          result = await auth.auth.getUser(refreshed.data.session.access_token);
          await db.query(
            "UPDATE private.sessions SET provider_session=$2 WHERE token_hash=$1",
            [
              ctx.sessionHash,
              await encrypt(JSON.stringify(refreshed.data.session)),
            ],
          );
        }
      }
      valid =
        !result.error &&
        result.data.user?.id === session.profile_id &&
        Boolean(result.data.user?.email_confirmed_at);
    }
    if (valid)
      ctx.viewer =
        (
          await db.query<Viewer>(
            "SELECT id,name,email,phone,role,verified FROM profiles WHERE id=$1 AND active=true",
            [session.profile_id],
          )
        )[0] || null;
  }
  return ctx;
}
export async function rotateSession(
  ctx: Context,
  profileId: string | null,
  providerSession?: unknown,
) {
  const raw = token();
  const nextHash = hash(raw);
  const oldHash = ctx.sessionHash;
  await ctx.db.transaction(async (db) => {
    await db.query(
      "INSERT INTO private.sessions(token_hash,profile_id,expires_at,provider_session) VALUES($1,$2,now()+interval '14 days',$3)",
      [
        nextHash,
        profileId,
        providerSession ? await encrypt(JSON.stringify(providerSession)) : null,
      ],
    );
    if (oldHash) {
      await db.query(
        "INSERT INTO private.guest_grants(token_hash,feedback_id,expires_at) SELECT $1,feedback_id,expires_at FROM private.guest_grants WHERE token_hash=$2 AND expires_at>now() ON CONFLICT DO NOTHING",
        [nextHash, oldHash],
      );
      // Staged files belong to the browser session and survive a login.
      await db.query(
        "UPDATE private.attachments SET token_hash=$1 WHERE token_hash=$2",
        [nextHash, oldHash],
      );
      await db.query("DELETE FROM private.sessions WHERE token_hash=$1", [
        oldHash,
      ]);
    }
  });
  ctx.sessionHash = nextHash;
  ctx.newToken = raw;
  ctx.viewer = profileId
    ? (
        await ctx.db.query<Viewer>(
          "SELECT id,name,email,phone,role,verified FROM profiles WHERE id=$1 AND active=true",
          [profileId],
        )
      )[0] || null
    : null;
}
export function requireUser(ctx: Context) {
  if (!ctx.viewer || !ctx.viewer.verified)
    throw new AppError("Бұл әрекет үшін расталған аккаунтқа кіріңіз.", 401);
  return ctx.viewer;
}
export function requireManager(ctx: Context) {
  const viewer = requireUser(ctx);
  if (!["admin", "leadership"].includes(viewer.role))
    throw new AppError("Бұл әрекетке құқығыңыз жоқ.", 403);
  return viewer;
}
export function requireLeadership(ctx: Context) {
  const viewer = requireManager(ctx);
  if (viewer.role !== "leadership")
    throw new AppError("Бұл әрекет тек басшылыққа қолжетімді.", 403);
  return viewer;
}
export async function owns(ctx: Context, id: string, db = ctx.db) {
  const rows = await db.query(
    "SELECT 1 FROM private.feedback_access a WHERE a.feedback_id=$1 AND ((a.profile_id=$2 AND $2 IS NOT NULL) OR EXISTS(SELECT 1 FROM private.guest_grants g WHERE g.feedback_id=a.feedback_id AND g.token_hash=$3 AND g.expires_at>now()))",
    [id, ctx.viewer?.id || null, ctx.sessionHash],
  );
  return rows.length > 0;
}
