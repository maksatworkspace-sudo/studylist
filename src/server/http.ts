import { NextResponse } from "next/server";
import type { Context } from "./context";
import { AppError } from "./security";
import { z } from "zod";

export function respond(ctx: Context, value: unknown, status = 200) {
  const response = NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
  if (ctx.newToken)
    response.cookies.set("maxball_session", ctx.newToken, {
      httpOnly: true,
      secure:
        process.env.APP_URL?.startsWith("https:") ||
        Boolean(process.env.VERCEL),
      sameSite: "lax",
      path: "/",
      maxAge: 14 * 86400,
    });
  return response;
}
export function failure(error: unknown) {
  if (error instanceof z.ZodError)
    return NextResponse.json(
      { error: "Толтырылған өрістерді және мәтін ұзындығын тексеріңіз." },
      { status: 400 },
    );
  if (error instanceof AppError)
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "23505"
  )
    return NextResponse.json(
      { error: "Осындай атау немесе email бұрыннан тіркелген." },
      { status: 409 },
    );
  console.error(
    "MAXBALL request failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  return NextResponse.json(
    { error: "Сұраныс орындалмады. Мәтінді жоғалтпай, қайта көріңіз." },
    { status: 500 },
  );
}
export async function readJson(
  request: Request,
): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("Сұраныс бос.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    length += next.value.byteLength;
    if (length > 100000) {
      await reader.cancel();
      throw new AppError("Сұраныс тым үлкен.", 413);
    }
    chunks.push(next.value);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value;
  } catch {
    throw new AppError("Сұраныс пішімі қате.");
  }
}
