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
import type { User } from "@supabase/supabase-js";

const email = z.email().trim().toLowerCase();
const password = z
  .string()
  .min(10, "Құпиясөз кемінде 10 таңбадан тұруы керек.")
  .max(128);
const name = z.string().trim().min(2).max(100);
const phone = z.string().trim().min(8).max(30);

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
    await rateLimit(ctx.db, `login:${hash(data.email)}`, 8, 600);
    if (ctx.demo) {
      const row = (
        await ctx.db.query<{ id: string; password_hash: string }>(
          "SELECT p.id,c.password_hash FROM profiles p JOIN private.local_credentials c ON c.profile_id=p.id WHERE p.email=$1 AND p.active",
          [data.email],
        )
      )[0];
      if (!row || !passwordMatches(data.password, row.password_hash))
        throw new AppError("Email немесе құпиясөз қате.", 401);
      await rotateSession(ctx, row.id);
      return { ok: true };
    }
    const result = await supabase().auth.signInWithPassword(data);
    if (
      result.error ||
      !result.data.session ||
      !result.data.user?.email_confirmed_at
    )
      throw new AppError(
        "Email, құпиясөз немесе email растауын тексеріңіз.",
        401,
      );
    await confirmProfile(ctx, result.data.user);
    await rotateSession(ctx, result.data.user.id, result.data.session);
    return { ok: true };
  }
  if (action === "register") {
    const data = z.object({ email, password, name, phone }).parse(input);
    await rateLimit(ctx.db, `register:${ctx.ip}`, 5, 3600);
    if (
      (
        await ctx.db.query("SELECT id FROM profiles WHERE email=$1", [
          data.email,
        ])
      ).length
    )
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
        throw new AppError(
          "Тіркелу орындалмады. Email-ды тексеріп қайталаңыз.",
        );
      await ctx.db.query(
        "INSERT INTO profiles(id,name,email,phone) VALUES($1,$2,$3,$4)",
        [result.data.user.id, data.name, data.email, data.phone],
      );
      return {
        ok: true,
        message: "Email-ға растау хаты жіберілді. Хаттағы сілтемені ашыңыз.",
      };
    }
    const id = randomUUID();
    const proof = token();
    await ctx.db.transaction(async (db) => {
      await db.query(
        "INSERT INTO profiles(id,name,email,phone) VALUES($1,$2,$3,$4)",
        [id, data.name, data.email, data.phone],
      );
      await db.query(
        "INSERT INTO private.local_credentials(profile_id,password_hash) VALUES($1,$2)",
        [id, passwordHash(data.password)],
      );
      await db.query(
        "INSERT INTO private.tokens(token_hash,purpose,subject_id,expires_at) VALUES($1,'verify',$2,now()+interval '30 minutes')",
        [hash(proof), id],
      );
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
    await rateLimit(ctx.db, `verify:${hash(data.email)}`, 3, 600);
    const message = "Растауды күткен аккаунт болса, email-ға хат жіберілді.";
    if (!ctx.demo) {
      await supabase().auth.resend({
        type: "signup",
        email: data.email,
        options: { emailRedirectTo: process.env.APP_URL },
      });
      return { ok: true, message };
    }
    const row = (
      await ctx.db.query<{ id: string }>(
        "SELECT id FROM profiles WHERE email=$1 AND NOT verified AND active",
        [data.email],
      )
    )[0];
    if (!row) return { ok: true, message };
    const proof = token();
    await ctx.db.query(
      "INSERT INTO private.tokens(token_hash,purpose,subject_id,expires_at) VALUES($1,'verify',$2,now()+interval '30 minutes')",
      [hash(proof), row.id],
    );
    return { ok: true, message, localToken: proof, tokenPurpose: "verify" };
  }
  if (action === "confirmEmail") {
    if (!ctx.demo) throw new AppError("Email хатының сілтемесін қолданыңыз.");
    const data = z.object({ token: z.string().min(10).max(200) }).parse(input);
    const id = await ctx.db.transaction(async (db) => {
      const row = (
        await db.query<{ subject_id: string }>(
          "DELETE FROM private.tokens WHERE token_hash=$1 AND purpose='verify' AND expires_at>now() RETURNING subject_id",
          [hash(data.token)],
        )
      )[0];
      if (!row)
        throw new AppError("Сілтеме жарамсыз немесе мерзімі аяқталған.");
      await db.query("UPDATE profiles SET verified=true WHERE id=$1", [
        row.subject_id,
      ]);
      return row.subject_id;
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
    await rateLimit(ctx.db, `reset:${hash(data.email)}`, 3, 600);
    if (!ctx.demo) {
      await supabase().auth.resetPasswordForEmail(data.email, {
        redirectTo: `${process.env.APP_URL}/?recovery=1`,
      });
      return {
        ok: true,
        message: "Аккаунт бар болса, қалпына келтіру хаты жіберілді.",
      };
    }
    const row = (
      await ctx.db.query<{ id: string }>(
        "SELECT id FROM profiles WHERE email=$1 AND active",
        [data.email],
      )
    )[0];
    if (!row)
      return {
        ok: true,
        message: "Аккаунт бар болса, қалпына келтіру хаты жіберілді.",
      };
    const proof = token();
    await ctx.db.query(
      "INSERT INTO private.tokens(token_hash,purpose,subject_id,expires_at) VALUES($1,'password',$2,now()+interval '30 minutes')",
      [hash(proof), row.id],
    );
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
      const row = (
        await ctx.db.query<{ provider_session: string }>(
          "SELECT provider_session FROM private.sessions WHERE token_hash=$1",
          [ctx.sessionHash],
        )
      )[0];
      const session = JSON.parse(await decrypt(row.provider_session));
      const client = supabase();
      await client.auth.setSession(session);
      const result = await client.auth.updateUser({ password: data.password });
      if (result.error) throw new AppError("Құпиясөз жаңартылмады.");
      return { ok: true };
    }
    if (!data.token) throw new AppError("Қалпына келтіру сілтемесі қажет.");
    const id = await ctx.db.transaction(async (db) => {
      const row = (
        await db.query<{ subject_id: string }>(
          "DELETE FROM private.tokens WHERE token_hash=$1 AND purpose='password' AND expires_at>now() RETURNING subject_id",
          [hash(data.token!)],
        )
      )[0];
      if (!row)
        throw new AppError("Сілтеме жарамсыз немесе мерзімі аяқталған.");
      await db.query(
        "UPDATE private.local_credentials SET password_hash=$2 WHERE profile_id=$1",
        [row.subject_id, passwordHash(data.password)],
      );
      await db.query("DELETE FROM private.sessions WHERE profile_id=$1", [
        row.subject_id,
      ]);
      return row.subject_id;
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
    if (
      (
        await ctx.db.query("SELECT id FROM profiles WHERE email=$1", [
          data.email,
        ])
      ).length
    )
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
    await ctx.db.transaction(async (db) => {
      await db.query(
        "INSERT INTO profiles(id,name,email,phone,role,verified) VALUES($1,$2,$3,$4,$5,$6)",
        [id, data.name, data.email, data.phone, data.role, ctx.demo],
      );
      if (ctx.demo)
        await db.query(
          "INSERT INTO private.local_credentials(profile_id,password_hash) VALUES($1,$2)",
          [id, passwordHash(token())],
        );
      if (data.role === "teacher")
        await db.query(
          "INSERT INTO teachers(id,profile_id,name,subject) VALUES($1,$2,$3,$4)",
          [randomUUID(), id, data.name, data.subject],
        );
    });
    return {
      ok: true,
      message: ctx.demo ? "Сынақ аккаунты қосылды." : "Шақыру жіберілді.",
    };
  }
  if (action === "updateProfile") {
    const viewer = requireUser(ctx);
    const data = z.object({ name, phone }).parse(input);
    await ctx.db.query("UPDATE profiles SET name=$2,phone=$3 WHERE id=$1", [
      viewer.id,
      data.name,
      data.phone,
    ]);
    await ctx.db.query("UPDATE teachers SET name=$2 WHERE profile_id=$1", [
      viewer.id,
      data.name,
    ]);
    return { ok: true };
  }
  return null;
}
async function confirmProfile(ctx: Context, user: User) {
  const existing = (
    await ctx.db.query<{ active: boolean }>(
      "SELECT active FROM profiles WHERE id=$1",
      [user.id],
    )
  )[0];
  if (existing && !existing.active)
    throw new AppError("Аккаунт бұғатталған.", 403);
  if (!existing) {
    const metadata = z.object({ name, phone }).safeParse(user.user_metadata);
    if (!metadata.success)
      throw new AppError(
        "Профильдің аты мен телефоны толық емес. Әкімшілікке хабарласыңыз.",
      );
    await ctx.db.query(
      "INSERT INTO profiles(id,name,email,phone,verified) VALUES($1,$2,$3,$4,true) ON CONFLICT(id) DO NOTHING",
      [
        user.id,
        metadata.data.name,
        user.email!.toLowerCase(),
        metadata.data.phone,
      ],
    );
  }
  await ctx.db.query("UPDATE profiles SET verified=true WHERE id=$1", [
    user.id,
  ]);
}
