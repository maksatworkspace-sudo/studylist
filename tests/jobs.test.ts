import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Database } from "../src/server/db";
const state = vi.hoisted(() => ({
  db: null as Database | null,
  mail: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("../src/server/db", () => ({
  database: async () => state.db,
  localMode: () => false,
}));
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: state.mail }) },
}));
vi.mock("../src/server/files", () => ({ removeObject: state.remove }));
import { runJobs } from "../src/server/jobs";
import { encrypt } from "../src/server/security";
const engine = new PGlite();
let post: string;
beforeAll(async () => {
  await engine.waitReady;
  await engine.exec(
    await readFile(
      new URL(
        "../supabase/migrations/202610190001_initial.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const wrap = (client: Pick<PGlite, "query">): Database => ({
    query: async <T>(sql: string, args: unknown[] = []) =>
      (await client.query(sql, args)).rows as T[],
    transaction: (fn) => engine.transaction((tx) => fn(wrap(tx))),
  });
  state.db = wrap(engine);
});
beforeEach(async () => {
  await state.db!.query("DELETE FROM private.jobs");
  await state.db!.query("DELETE FROM feedback");
  post = randomUUID();
  await state.db!.query(
    "INSERT INTO feedback(id,type,title,body,anonymous,author_name) VALUES($1,'opinion','Сынақ мәтіні','Орынды сын пікірдің мәтіні.',true,NULL)",
    [post],
  );
  vi.stubEnv(
    "APP_SECRET",
    "unit-test-only-random-secret-not-used-outside-tests",
  );
  vi.stubEnv("AI_API_URL", "https://provider.example/test");
  vi.stubEnv("AI_API_KEY", "test-key");
  vi.stubEnv("AI_MODEL", "test-model");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
afterAll(async () => engine.close());
async function job(kind = "moderation", payload = "{}") {
  const id = randomUUID();
  await state.db!.query(
    "INSERT INTO private.jobs(id,kind,subject_id,payload) VALUES($1,$2,$3,$4)",
    [id, kind, post, payload],
  );
  return id;
}
it("flags suspicious content without hiding it or sending author metadata", async () => {
  const request = vi.fn(async (_url: unknown, init: RequestInit) => {
    expect(String(init.body)).not.toContain("profile_id");
    expect(String(init.body)).not.toContain("recovery_email");
    return Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              flagged: true,
              reason: "Спамға ұқсас мәтін",
            }),
          },
        },
      ],
    });
  });
  vi.stubGlobal("fetch", request);
  await job();
  expect((await runJobs())[0].status).toBe("done");
  expect(
    (
      await state.db!.query<{ hidden: boolean }>(
        "SELECT hidden FROM feedback WHERE id=$1",
        [post],
      )
    )[0].hidden,
  ).toBe(false);
  expect(
    await state.db!.query(
      "SELECT 1 FROM private.moderation_flags WHERE feedback_id=$1",
      [post],
    ),
  ).toHaveLength(1);
});
it("retains posts and retries when the AI provider fails or returns invalid data", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ untrusted: "invalid" })),
  );
  const id = await job();
  expect((await runJobs())[0].status).toBe("retry");
  expect(
    (
      await state.db!.query<{ status: string }>(
        "SELECT status FROM private.jobs WHERE id=$1",
        [id],
      )
    )[0].status,
  ).toBe("pending");
  expect(
    await state.db!.query("SELECT 1 FROM private.moderation_flags"),
  ).toHaveLength(0);
});
it("preserves encrypted email tasks after a delivery failure", async () => {
  vi.stubEnv("SMTP_PASS", "test-only");
  state.mail.mockRejectedValue(new Error("test transport down"));
  const payload = await encrypt(
    JSON.stringify({
      to: "author@example.com",
      subject: "Ресми жауап",
      text: "Өтінішіңізге жауап берілді.",
    }),
  );
  await job("email", payload);
  expect((await runJobs())[0].status).toBe("retry");
  expect(state.mail).toHaveBeenCalledOnce();
  expect(payload).not.toContain("author@example.com");
});
it("leaves moderation queued when no provider credentials are configured", async () => {
  vi.stubEnv("AI_API_KEY", "");
  await job();
  const request = vi.fn();
  vi.stubGlobal("fetch", request);
  expect(await runJobs()).toEqual([]);
  expect(request).not.toHaveBeenCalled();
});
it("moderates each comment separately and clears its flag after deletion", async () => {
  const person = randomUUID(),
    commentId = randomUUID();
  await state.db!.query(
    "INSERT INTO profiles(id,name,email,phone) VALUES($1,'Тест авторы',$2,'+77000000000')",
    [person, `${person}@example.com`],
  );
  await state.db!.query(
    "INSERT INTO comments(id,feedback_id,profile_id,body) VALUES($1,$2,$3,'Талқылаудағы жеке мәтін')",
    [commentId, post, person],
  );
  const request = vi.fn(async (_url: unknown, init: RequestInit) => {
    expect(String(init.body)).toContain("Талқылаудағы жеке мәтін");
    expect(String(init.body)).not.toContain("Тест авторы");
    return Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({ flagged: true, reason: "Күдікті пікір" }),
          },
        },
      ],
    });
  });
  vi.stubGlobal("fetch", request);
  await job("moderation", JSON.stringify({ commentId }));
  await runJobs();
  expect(
    await state.db!.query(
      "SELECT 1 FROM private.moderation_flags WHERE source=$1",
      [`ai:${commentId}`],
    ),
  ).toHaveLength(1);
  await state.db!.query(
    "UPDATE comments SET deleted=true,body='' WHERE id=$1",
    [commentId],
  );
  request.mockClear();
  await job("moderation", JSON.stringify({ commentId }));
  await runJobs();
  expect(request).not.toHaveBeenCalled();
  expect(
    await state.db!.query(
      "SELECT 1 FROM private.moderation_flags WHERE source=$1",
      [`ai:${commentId}`],
    ),
  ).toHaveLength(0);
});
