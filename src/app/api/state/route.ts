import { context } from "@/server/context";
import { boot, detail } from "@/server/queries";
import { failure, respond } from "@/server/http";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const ctx = await context(request);
    const url = new URL(request.url);
    const post = url.searchParams.get("post");
    if (post) return respond(ctx, await detail(ctx, z.uuid().parse(post)));
    const date = z.iso.date().optional();
    const from = date.parse(url.searchParams.get("from") || undefined);
    const to = date.parse(url.searchParams.get("to") || undefined);
    return respond(ctx, await boot(ctx, from, to));
  } catch (error) {
    return failure(error);
  }
}
