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
    await rateLimit(ctx.store, `upload:${ctx.ip}`, 20, 3600);
    const data = z
      .object({
        name: z.string().min(1).max(240),
        size: z.number().int().min(0).max(20971520),
        mime: z.string().max(200).default("application/octet-stream"),
      })
      .parse(input);
    const id = randomUUID();
    const object = `staged/${id}`;
    await ctx.store.transaction(async (repo) => {
      const staged = (
        await repo.all("attachments")
      ).filter(
        (file) =>
          file.token_hash === ctx.sessionHash && file.feedback_id === null,
      );
      if (
        staged.length >= 5 ||
        staged.reduce((sum, f) => sum + Number(f.size), 0) + data.size > 20971520
      )
        throw new AppError(
          "Бір жазбаға ең көбі 5 файл, жалпы 20 МБ рұқсат етіледі.",
        );
      await repo.insert("attachments", {
        id,
        token_hash: ctx.sessionHash,
        feedback_id: null,
        name: data.name,
        size: data.size,
        mime: data.mime,
        object_path: object,
        ready: false,
        created_at: new Date().toISOString(),
      });
    });
    if (ctx.demo) return { ok: true, id, url: `/api/files/${id}`, local: true };
    const result = await supabaseAdmin()
      .storage.from(bucket())
      .createSignedUploadUrl(object, { upsert: false });
    if (result.error) {
      await ctx.store.delete("attachments", id);
      throw new AppError("Жүктеу қызметі қолжетімсіз. Қайталап көріңіз.", 503);
    }
    return { ok: true, id, url: result.data.signedUrl, local: false };
  }
  if (name === "completeUpload") {
    const data = z.object({ id: z.uuid() }).parse(input);
    const row = await ctx.store.get("attachments", data.id);
    if (!row || row.token_hash !== ctx.sessionHash || row.feedback_id !== null)
      throw new AppError("Жүктеу сессиясы табылмады.", 404);
    if (!ctx.demo) {
      const result = await supabaseAdmin()
        .storage.from(bucket())
        .info(String(row.object_path));
      if (
        result.error ||
        !result.data ||
        Number(result.data.size) !== Number(row.size)
      )
        throw new AppError("Файл толық жүктелмеді. Қайта жүктеңіз.");
      await ctx.store.update("attachments", data.id, { ready: true });
    } else if (!row.ready)
      throw new AppError("Файл толық жүктелмеді.");
    return { ok: true, id: data.id };
  }
  if (name === "discardUpload") {
    const data = z.object({ id: z.uuid() }).parse(input);
    const row = await ctx.store.get("attachments", data.id);
    if (row && row.token_hash === ctx.sessionHash && row.feedback_id === null) {
      await ctx.store.delete("attachments", data.id);
      await removeObject(String(row.object_path), ctx.demo);
    }
    return { ok: true };
  }
  return null;
}
export async function uploadLocal(ctx: Context, id: string, request: Request) {
  if (!ctx.demo)
    throw new AppError("Тікелей жүктеу сілтемесін пайдаланыңыз.", 404);
  const row = await ctx.store.get("attachments", id);
  if (
    !row ||
    row.token_hash !== ctx.sessionHash ||
    row.feedback_id !== null ||
    row.ready
  )
    throw new AppError("Жүктеу рұқсаты жарамсыз.", 403);
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
  await mkdir(path.dirname(localPath(String(row.object_path))), {
    recursive: true,
  });
  await writeFile(localPath(String(row.object_path)), Buffer.concat(parts), {
    flag: "wx",
    mode: 0o600,
  });
  await ctx.store.update("attachments", id, { ready: true });
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
