import { context, requireManager } from "@/server/context";
import { requireSameOrigin, AppError, rateLimit } from "@/server/security";
import { action } from "@/server/actions";
import { authAction } from "@/server/auth";
import { fileAction } from "@/server/files";
import { runJobs } from "@/server/jobs";
import { failure, readJson, respond } from "@/server/http";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    if (Number(request.headers.get("content-length") || 0) > 100000)
      throw new AppError("Сұраныс тым үлкен.", 413);
    const input = await readJson(request);
    const name = input.action;
    if (typeof name !== "string") throw new AppError("Әрекет атауы қажет.");
    const ctx = await context(request);
    await rateLimit(ctx.store, `request:${ctx.ip}`, 180, 60);
    if (name === "runJobs") {
      requireManager(ctx);
      return respond(ctx, { ok: true, results: await runJobs() });
    }
    const result =
      (await authAction(ctx, name, input)) ||
      (await fileAction(ctx, name, input)) ||
      (await action(ctx, name, input));
    return respond(ctx, result);
  } catch (error) {
    return failure(error);
  }
}
