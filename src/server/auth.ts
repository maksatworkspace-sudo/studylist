import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Context } from "./context";
import {
  requireLeadership,
  requireUser,
  rotateSession,
  supabase,
  supabaseAdmin,
} from "./context";
import {
  AppError,
  decrypt,
  hash,
  passwordHash,
  passwordMatches,
  rateLimit,
  token,
} from "./security";
import { demoId } from "./seed";
import type { Store } from "./store/types";
import type { User } from "@supabase/supabase-js";

const email = z.email().trim().toLowerCase();
const password = z
  .string()
  .min(10, "Құпиясөз кемінде 10 таңбадан тұруы керек.")
  .max(128);
const name = z.string().trim().min(2).max(100);
const phone = z.string().trim().min(8).max(30);
const now = () => new Date().toISOString();
const inMinutes = (minutes: number) =>
  new Date(Date.now() + minutes * 60_000).toISOString();

export async function authAction(ctx: Context, action: string, input: unknown) {
  if (action === "demoLogin") {
    if (!ctx.demo) throw new AppError("Бұл әрекет қолжетімсіз.", 404);
    const data = z
      .object({ role: z.enum(["user", "teacher", "admin", "leadership"]) })
      .parse(input);
    await rotateSession(
      ctx,
      demoId({ user: 1, teacher: 4, admin: 5, leadership: 6 }[data.role]),
    );
    return { ok: true };
  }
  if (action === "logout") {
    await rotateSession(ctx, null);
    return { ok: true };
  }
  if (action === "login") {
    const data = z
      .object({ email, password: z.string().min(1).max(128) })
      .parse(input);
    await rateLimit(ctx.store, `login:${hash(data.email)}`, 8, 600);
    if (ctx.demo) {
      const person = (
        await ctx.store.find("profiles", { email: data.email })
      ).find((p) => p.active);
      const credential = person
        ? await ctx.store.get("local_credentials", String(person.id))
        : undefined;
      if (
        !person ||
        !credential ||
        !passwordMatches(data.password, String(credential.password_hash))
      )
        throw new AppError("Email немесе құпиясөз қате.", 401);
      await rotateSession(ctx, String(person.id));
      return { ok: true };
    }
    const result = await supabase().auth.signInWithPassword(data);
    if (
      result.error ||
      !result.data.session ||
      !result.data.user?.email_confirmed_at
    )
      throw new AppError("Email, құпиясөз немесе email растауын тексеріңіз.", 401);
    await confirmProfile(ctx, result.data.user);
    await rotateSession(ctx, result.data.user.id, result.data.session);
    return { ok: true };
  }
  if (action === "register") {
    const data = z.object({ email, password, name, phone }).parse(input);
    await rateLimit(ctx.store, `register:${ctx.ip}`, 5, 3600);
    if (await ctx.store.first("profiles", { email: data.email }))
      throw new AppError(
        "Бұл email тіркелген. Кіруді немесе қалпына келтіруді қолданыңыз.",
      );
    if (!ctx.demo) {
      const result = await supabase().auth.signUp({
        email: data.email,
        password: data.password,
        options: {
          data: { name: data.name, phone: data.phone },
          emailRedirectTo: process.env.APP_URL,
        },
      });
      if (result.error || !result.data.user)
        throw new AppError("Тіркелу орындалмады. Email-ды тексеріп қайталаңыз.");
      await ctx.store.insert("profiles", {
        id: result.data.user.id,
        name: data.name,
        email: data.email,
        phone: data.phone,
        role: "user",
        verified: false,
        active: true,
        created_at: now(),
      });
      return {
        ok: true,
        message: "Email-ға растау хаты жіберілді. Хаттағы сілтемені ашыңыз.",
      };
    }
    const id = randomUUID();
    const proof = token();
    await ctx.store.transaction(async (repo) => {
      await repo.insert("profiles", {
        id,
        name: data.name,
        email: data.email,
        phone: data.phone,
        role: "user",
        verified: false,
        active: true,
        created_at: now(),
      });
      await repo.insert("local_credentials", {
        profile_id: id,
        password_hash: passwordHash(data.password),
      });
      await repo.insert("tokens", {
        token_hash: hash(proof),
        purpose: "verify",
        subject_id: id,
        expires_at: inMinutes(30),
      });
    });
    await rotateSession(ctx, id);
    return {
      ok: true,
      message: "Сынақ поштасына растау дайындалды.",
      localToken: proof,
      tokenPurpose: "verify",
    };
  }
  if (action === "resendConfirmation") {
    const data = z.object({ email }).parse(input);
    await rateLimit(ctx.store, `verify:${hash(data.email)}`, 3, 600);
    const message = "Растауды күткен аккаунт болса, email-ға хат жіберілді.";
    if (!ctx.demo) {
      await supabase().auth.resend({
        type: "signup",
        email: data.email,
        options: { emailRedirectTo: process.env.APP_URL },
      });
      return { ok: true, message };
    }
    const row = (await ctx.store.find("profiles", { email: data.email })).find(
      (p) => !p.verified && p.active,
    );
    if (!row) return { ok: true, message };
    const proof = token();
    await ctx.store.insert("tokens", {
      token_hash: hash(proof),
      purpose: "verify",
      subject_id: row.id,
      expires_at: inMinutes(30),
    });
    return { ok: true, message, localToken: proof, tokenPurpose: "verify" };
  }
  if (action === "confirmEmail") {
    if (!ctx.demo) throw new AppError("Email хатының сілтемесін қолданыңыз.");
    const data = z.object({ token: z.string().min(10).max(200) }).parse(input);
    const id = await ctx.store.transaction(async (repo) => {
      const row = await repo.get("tokens", hash(data.token));
      if (
        !row ||
        row.purpose !== "verify" ||
        Date.parse(String(row.expires_at)) <= Date.now()
      )
        throw new AppError("Сілтеме жарамсыз немесе мерзімі аяқталған.");
      await repo.delete("tokens", hash(data.token));
      await repo.update("profiles", String(row.subject_id), { verified: true });
      return String(row.subject_id);
    });
    await rotateSession(ctx, id);
    return { ok: true };
  }
  if (action === "exchangeSession") {
    if (ctx.demo) throw new AppError("Бұл әрекет қолжетімсіз.", 404);
    const data = z
      .object({
        accessToken: z.string().min(20),
        refreshToken: z.string().min(10),
      })
      .parse(input);
    const result = await supabase().auth.getUser(data.accessToken);
    const user = result.data.user;
    if (result.error || !user || !user.email_confirmed_at)
      throw new AppError("Кіру сілтемесі жарамсыз.", 401);
    await confirmProfile(ctx, user);
    await rotateSession(ctx, user.id, {
      access_token: data.accessToken,
      refresh_token: data.refreshToken,
    });
    return { ok: true };
  }
  if (action === "forgotPassword") {
    const data = z.object({ email }).parse(input);
    await rateLimit(ctx.store, `reset:${hash(data.email)}`, 3, 600);
    if (!ctx.demo) {
      await supabase().auth.resetPasswordForEmail(data.email, {
        redirectTo: `${process.env.APP_URL}/?recovery=1`,
      });
      return {
        ok: true,
        message: "Аккаунт бар болса, қалпына келтіру хаты жіберілді.",
      };
    }
    const row = (await ctx.store.find("profiles", { email: data.email })).find(
      (p) => p.active,
    );
    if (!row)
      return {
        ok: true,
        message: "Аккаунт бар болса, қалпына келтіру хаты жіберілді.",
      };
    const proof = token();
    await ctx.store.insert("tokens", {
      token_hash: hash(proof),
      purpose: "password",
      subject_id: row.id,
      expires_at: inMinutes(30),
    });
    return {
      ok: true,
      localToken: proof,
      tokenPurpose: "password",
      message: "Сынақ қалпына келтіру сілтемесі дайын.",
    };
  }
  if (action === "resetPassword") {
    const data = z
      .object({ token: z.string().optional(), password })
      .parse(input);
    if (!ctx.demo) {
      requireUser(ctx);
      const row = await ctx.store.get("sessions", ctx.sessionHash);
      const session = JSON.parse(await decrypt(String(row?.provider_session)));
      const client = supabase();
      await client.auth.setSession(session);
      const result = await client.auth.updateUser({ password: data.password });
      if (result.error) throw new AppError("Құпиясөз жаңартылмады.");
      return { ok: true };
    }
    if (!data.token) throw new AppError("Қалпына келтіру сілтемесі қажет.");
    const id = await ctx.store.transaction(async (repo) => {
      const row = await repo.get("tokens", hash(data.token!));
      if (
        !row ||
        row.purpose !== "password" ||
        Date.parse(String(row.expires_at)) <= Date.now()
      )
        throw new AppError("Сілтеме жарамсыз немесе мерзімі аяқталған.");
      await repo.delete("tokens", hash(data.token!));
      await repo.update("local_credentials", String(row.subject_id), {
        password_hash: passwordHash(data.password),
      });
      await repo.deleteWhere("sessions", { profile_id: String(row.subject_id) });
      return String(row.subject_id);
    });
    ctx.sessionHash = "";
    await rotateSession(ctx, id);
    return { ok: true };
  }
  if (action === "createStaff") {
    requireLeadership(ctx);
    const data = z
      .object({
        name,
        email,
        phone,
        role: z.enum(["user", "teacher", "admin", "leadership"]),
        subject: z.string().trim().max(100).default("Жалпы курс"),
      })
      .parse(input);
    if (await ctx.store.first("profiles", { email: data.email }))
      throw new AppError("Бұл email тіркелген.");
    let id: string = randomUUID();
    if (!ctx.demo) {
      const result = await supabaseAdmin().auth.admin.inviteUserByEmail(
        data.email,
        {
          data: { name: data.name, phone: data.phone },
          redirectTo: process.env.APP_URL,
        },
      );
      if (result.error || !result.data.user)
        throw new AppError("Шақыру жіберілмеді. Email баптауын тексеріңіз.");
      id = result.data.user.id;
    }
    await ctx.store.transaction(async (repo) => {
      await insertProfile(repo, {
        id,
        name: data.name,
        email: data.email,
        phone: data.phone,
        role: data.role,
        verified: ctx.demo,
      });
      if (ctx.demo)
        await repo.insert("local_credentials", {
          profile_id: id,
          password_hash: passwordHash(token()),
        });
      if (data.role === "teacher")
        await repo.insert("teachers", {
          id: randomUUID(),
          profile_id: id,
          name: data.name,
          subject: data.subject,
          color: "blue",
          active: true,
        });
    });
    return {
      ok: true,
      message: ctx.demo ? "Сынақ аккаунты қосылды." : "Шақыру жіберілді.",
    };
  }
  if (action === "updateProfile") {
    const viewer = requireUser(ctx);
    const data = z.object({ name, phone }).parse(input);
    await ctx.store.update("profiles", viewer.id, {
      name: data.name,
      phone: data.phone,
    });
    for (const teacher of await ctx.store.find("teachers", {
      profile_id: viewer.id,
    }))
      await ctx.store.update("teachers", String(teacher.id), {
        name: data.name,
      });
    return { ok: true };
  }
  return null;
}

async function insertProfile(
  repo: Store,
  profile: {
    id: string;
    name: string;
    email: string;
    phone: string;
    role: string;
    verified: boolean;
  },
) {
  await repo.insert("profiles", {
    ...profile,
    active: true,
    created_at: now(),
  });
}

async function confirmProfile(ctx: Context, user: User) {
  const existing = await ctx.store.get("profiles", user.id);
  if (existing && !existing.active)
    throw new AppError("Аккаунт бұғатталған.", 403);
  if (!existing) {
    const metadata = z.object({ name, phone }).safeParse(user.user_metadata);
    if (!metadata.success)
      throw new AppError(
        "Профильдің аты мен телефоны толық емес. Әкімшілікке хабарласыңыз.",
      );
    await ctx.store.insert("profiles", {
      id: user.id,
      name: metadata.data.name,
      email: user.email!.toLowerCase(),
      phone: metadata.data.phone,
      role: "user",
      verified: true,
      active: true,
      created_at: now(),
    });
    return;
  }
  await ctx.store.update("profiles", user.id, { verified: true });
}
