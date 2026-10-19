import { runJobs } from "@/server/jobs";
import { timingSafeEqual } from "node:crypto";
import { AppError, hash } from "@/server/security";
import { failure } from "@/server/http";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const expected = process.env.JOBS_SECRET;
    if (
      !expected ||
      expected.length < 32 ||
      !timingSafeEqual(
        Buffer.from(hash(request.headers.get("authorization") || ""), "hex"),
        Buffer.from(hash(`Bearer ${expected}`), "hex"),
      )
    )
      throw new AppError("Рұқсат жоқ.", 401);
    return Response.json({ results: await runJobs() });
  } catch (error) {
    return failure(error);
  }
}
