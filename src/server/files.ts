import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Context } from "./context";
import { supabaseAdmin } from "./context";
import { AppError, rateLimit } from "./security";
import { accessibleAttachment } from "./queries";

const bucket = () =>
  process.env.SUPABASE_STORAGE_BUCKET || "feedback-attachments";
const localPath = (object: string) =>
  path.join(process.cwd(), ".local", "uploads", path.basename(object));
export async function fileAction(ctx: Context, name: string, input: unknown) {
  if (name === "prepareUpload") {
    await rateLimit(ctx.db, `upload:${ctx.ip}`, 20, 3600);
    const data = z
      .object({
        name: z.string().min(1).max(240),
        size: z.number().int().min(0).max(20971520),
        mime: z.string().max(200).default("application/octet-stream"),
      })
      .parse(input);
    const id = randomUUID();
    const object = `staged/${id}`;
    await ctx.db.transaction(async (db) => {
      await db.query(
        "SELECT token_hash FROM private.sessions WHERE token_hash=$1 FOR UPDATE",
        [ctx.sessionHash],
      );
      const current = (
        await db.query<{ count: number; size: number }>(
          "SELECT count(*)::int AS count,coalesce(sum(size),0)::int AS size FROM private.attachments WHERE token_hash=$1 AND feedback_id IS NULL",
          [ctx.sessionHash],
        )
      )[0];
      if (current.count >= 5 || current.size + data.size > 20971520)
        throw new AppError(
          "Бір жазбаға ең көбі 5 файл, жалпы 20 МБ рұқсат етіледі.",
        );
      await db.query(
        "INSERT INTO private.attachments(id,token_hash,name,size,mime,object_path) VALUES($1,$2,$3,$4,$5,$6)",
        [id, ctx.sessionHash, data.name, data.size, data.mime, object],
      );
    });
    if (ctx.demo) return { ok: true, id, url: `/api/files/${id}`, local: true };
    const result = await supabaseAdmin()
      .storage.from(bucket())
      .createSignedUploadUrl(object, { upsert: false });
    if (result.error) {
      await ctx.db.query("DELETE FROM private.attachments WHERE id=$1", [id]);
      throw new AppError("Жүктеу қызметі қолжетімсіз. Қайталап көріңіз.", 503);
    }
    return { ok: true, id, url: result.data.signedUrl, local: false };
  }
  if (name === "completeUpload") {
    const data = z.object({ id: z.uuid() }).parse(input);
    const row = (
      await ctx.db.query<{ object_path: string; size: number }>(
        "SELECT object_path,size FROM private.attachments WHERE id=$1 AND token_hash=$2 AND feedback_id IS NULL",
        [data.id, ctx.sessionHash],
      )
    )[0];
    if (!row) throw new AppError("Жүктеу сессиясы табылмады.", 404);
    if (!ctx.demo) {
      const result = await supabaseAdmin()
        .storage.from(bucket())
        .info(row.object_path);
      if (
        result.error ||
        !result.data ||
        Number(result.data.size) !== Number(row.size)
      )
        throw new AppError("Файл толық жүктелмеді. Қайта жүктеңіз.");
      await ctx.db.query(
        "UPDATE private.attachments SET ready=true WHERE id=$1",
        [data.id],
      );
    } else if (
      !(
        await ctx.db.query(
          "SELECT id FROM private.attachments WHERE id=$1 AND ready",
          [data.id],
        )
      ).length
    )
      throw new AppError("Файл толық жүктелмеді.");
    return { ok: true, id: data.id };
  }
  if (name === "discardUpload") {
    const data = z.object({ id: z.uuid() }).parse(input);
    const row = (
      await ctx.db.query<{ object_path: string }>(
        "DELETE FROM private.attachments WHERE id=$1 AND token_hash=$2 AND feedback_id IS NULL RETURNING object_path",
        [data.id, ctx.sessionHash],
      )
    )[0];
    if (row) await removeObject(row.object_path, ctx.demo);
    return { ok: true };
  }
  return null;
}
export async function uploadLocal(ctx: Context, id: string, request: Request) {
  if (!ctx.demo)
    throw new AppError("Тікелей жүктеу сілтемесін пайдаланыңыз.", 404);
  const row = (
    await ctx.db.query<{ object_path: string; size: number }>(
      "SELECT object_path,size FROM private.attachments WHERE id=$1 AND token_hash=$2 AND feedback_id IS NULL AND NOT ready",
      [id, ctx.sessionHash],
    )
  )[0];
  if (!row) throw new AppError("Жүктеу рұқсаты жарамсыз.", 403);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("Файл деректері жоқ.");
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    size += result.value.byteLength;
    if (size > Number(row.size) || size > 20971520) {
      await reader.cancel();
      throw new AppError("Файл көлемі шектен асты.", 413);
    }
    parts.push(result.value);
  }
  if (size !== Number(row.size)) throw new AppError("Файл толық жүктелмеді.");
  await mkdir(path.dirname(localPath(row.object_path)), { recursive: true });
  await writeFile(localPath(row.object_path), Buffer.concat(parts), {
    flag: "wx",
    mode: 0o600,
  });
  await ctx.db.query(
    "UPDATE private.attachments SET ready=true WHERE id=$1 AND token_hash=$2",
    [id, ctx.sessionHash],
  );
}
export async function download(ctx: Context, id: string) {
  const file = await accessibleAttachment(ctx, id);
  if (!ctx.demo) {
    const result = await supabaseAdmin()
      .storage.from(bucket())
      .createSignedUrl(file.object_path, 60, { download: file.name });
    if (result.error) throw new AppError("Файл уақытша қолжетімсіз.", 503);
    return Response.redirect(result.data.signedUrl, 302);
  }
  const bytes = await readFile(localPath(file.object_path));
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}
export async function removeObject(object: string, demo: boolean) {
  if (demo) {
    try {
      await unlink(localPath(object));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  } else {
    const result = await supabaseAdmin()
      .storage.from(bucket())
      .remove([object]);
    if (result.error) throw new Error("Storage delete failed");
  }
}
