import { context } from "@/server/context";
import { download, uploadLocal } from "@/server/files";
import { requireSameOrigin } from "@/server/security";
import { failure, respond } from "@/server/http";
import { z } from "zod";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };
export async function PUT(request: Request, props: Params) {
  try {
    requireSameOrigin(request);
    const ctx = await context(request);
    const id = z.uuid().parse((await props.params).id);
    await uploadLocal(ctx, id, request);
    return respond(ctx, { ok: true });
  } catch (error) {
    return failure(error);
  }
}
export async function GET(request: Request, props: Params) {
  try {
    return await download(
      await context(request),
      z.uuid().parse((await props.params).id),
    );
  } catch (error) {
    return failure(error);
  }
}
