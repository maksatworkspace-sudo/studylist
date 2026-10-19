import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";
import type { Store } from "../src/server/store/types";
const state = vi.hoisted(() => ({
  db: null as Store | null,
  mail: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("../src/server/storage", () => ({
  store: async () => state.db,
}));
vi.mock("../src/server/mode", () => ({
  localMode: () => false,
}));
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: state.mail }) },
}));
vi.mock("../src/server/files", () => ({ removeObject: state.remove }));
import { runJobs } from "../src/server/jobs";
import { encrypt } from "../src/server/security";
let post: string;
beforeAll(async () => {
  const { MemoryStore } = await import("../src/server/store/memory");
  state.db = new MemoryStore();
});
beforeEach(async () => {
  await state.db!.deleteWhere("jobs", {});
  await state.db!.deleteWhere("feedback", {});
  post = randomUUID();
  await state.db!.insert("feedback", {
    id: post,
    number: 9000,
    type: "opinion",
    title: "Сынақ мәтіні",
    body: "Орынды сын пікірдің мәтіні.",
    course_id: null,
    teacher_id: null,
    custom_target: null,
    anonymous: true,
    author_name: null,
    status: null,
    outcome: null,
    confirmed: false,
    hidden: false,
    hidden_reason: null,
    deleted: false,
    resolved_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
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
async function job(kind = "moderation", payload = "{}") {
  const id = randomUUID();
  await state.db!.insert("jobs", {
    id,
    kind,
    subject_id: post,
    payload,
    status: "pending",
    attempts: 0,
    available_at: new Date().toISOString(),
    last_error: null,
    created_at: new Date().toISOString(),
  });
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
  expect((await state.db!.get("feedback", post))!.hidden).toBe(false);
  expect(
    await state.db!.find("moderation_flags", { feedback_id: post }),
  ).toHaveLength(1);
});
it("retains posts and retries when the AI provider fails or returns invalid data", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ untrusted: "invalid" })),
  );
  const id = await job();
  expect((await runJobs())[0].status).toBe("retry");
  expect((await state.db!.get("jobs", id))!.status).toBe("pending");
  expect(await state.db!.all("moderation_flags")).toHaveLength(0);
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
  await state.db!.insert("profiles", {
    id: person,
    name: "Тест авторы",
    email: `${person}@example.com`,
    phone: "+77000000000",
    role: "user",
    verified: true,
    active: true,
    created_at: new Date().toISOString(),
  });
  await state.db!.insert("comments", {
    id: commentId,
    feedback_id: post,
    profile_id: person,
    parent_id: null,
    body: "Талқылаудағы жеке мәтін",
    deleted: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
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
    await state.db!.find("moderation_flags", { source: `ai:${commentId}` }),
  ).toHaveLength(1);
  await state.db!.update("comments", commentId, { deleted: true, body: "" });
  request.mockClear();
  await job("moderation", JSON.stringify({ commentId }));
  await runJobs();
  expect(request).not.toHaveBeenCalled();
  expect(
    await state.db!.find("moderation_flags", { source: `ai:${commentId}` }),
  ).toHaveLength(0);
});
