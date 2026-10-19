import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { store } from "./storage";
import { localMode } from "./mode";
import type { Store } from "./store/types";
import { AppError, decrypt, encrypt, hash, token } from "./security";
import type { Viewer } from "@/lib/types";

export type Context = {
  store: Store;
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
    { auth: { persistSession: false, autoRefreshToken: true } },
  );
};
function toViewer(row: Record<string, unknown> | undefined): Viewer | null {
  if (!row || !row.active) return null;
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    phone: String(row.phone),
    role: row.role as Viewer["role"],
    verified: Boolean(row.verified),
  };
}
export async function context(request: Request): Promise<Context> {
  const repo = await store();
  const jar = await cookies();
  const raw = jar.get("maxball_session")?.value;
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const ctx: Context = {
    store: repo,
    viewer: null,
    sessionHash: raw ? hash(raw) : "",
    ip,
    demo: localMode(),
  };
  if (raw) {
    const session = await repo.get("sessions", ctx.sessionHash);
    const valid =
      session && Date.parse(String(session.expires_at)) > Date.now();
    if (!valid) {
      await rotateSession(ctx, null);
    } else if (session.profile_id) {
      let accepted = ctx.demo;
      if (!accepted && session.provider_session) {
        const stored = JSON.parse(await decrypt(String(session.provider_session)));
        const auth = supabase();
        let result = await auth.auth.getUser(stored.access_token);
        if (result.error) {
          const refreshed = await auth.auth.refreshSession({
            refresh_token: stored.refresh_token,
          });
          if (refreshed.data.session) {
            result = await auth.auth.getUser(refreshed.data.session.access_token);
            await repo.update("sessions", ctx.sessionHash, {
              provider_session: await encrypt(JSON.stringify(refreshed.data.session)),
            });
          }
        }
        accepted =
          !result.error &&
          result.data.user?.id === session.profile_id &&
          Boolean(result.data.user?.email_confirmed_at);
      }
      if (accepted)
        ctx.viewer = toViewer(
          await repo.get("profiles", String(session.profile_id)),
        );
    }
  } else {
    // First visit: issue a session so uploads/grants have an owner token.
    await rotateSession(ctx, null);
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
  const repo = ctx.store;
  await repo.transaction(async (tx) => {
    await tx.insert("sessions", {
      token_hash: nextHash,
      profile_id: profileId,
      expires_at: new Date(Date.now() + 14 * 86400_000).toISOString(),
      provider_session: providerSession
        ? await encrypt(JSON.stringify(providerSession))
        : null,
    });
    if (oldHash) {
      // Guest grants survive a login; staged uploads follow the session.
      for (const grant of await tx.find("guest_grants", {
        token_hash: oldHash,
      }))
        if (Date.parse(String(grant.expires_at)) > Date.now())
          await tx.insert("guest_grants", {
            token_hash: nextHash,
            feedback_id: grant.feedback_id,
            expires_at: grant.expires_at,
          }).catch(() => {});
      for (const file of await tx.find("attachments", { token_hash: oldHash }))
        await tx.update("attachments", String(file.id), { token_hash: nextHash });
      await tx.delete("sessions", oldHash);
    }
  });
  ctx.sessionHash = nextHash;
  ctx.newToken = raw;
  ctx.viewer = profileId
    ? toViewer(await repo.get("profiles", profileId))
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
export async function owns(ctx: Context, id: string, repo: Store = ctx.store) {
  const access = await repo.get("feedback_access", id);
  if (!access) return false;
  if (ctx.viewer && access.profile_id === ctx.viewer.id) return true;
  const grants = await repo.find("guest_grants", {
    feedback_id: id,
    token_hash: ctx.sessionHash,
  });
  return grants.some(
    (grant) => Date.parse(String(grant.expires_at)) > Date.now(),
  );
}
