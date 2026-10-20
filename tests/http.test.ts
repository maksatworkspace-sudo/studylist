import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
const base = process.env.TEST_URL || "http://127.0.0.1:3000";
class Client {
  cookie = "";
  async request(path: string, init: RequestInit = {}) {
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: { origin: base, cookie: this.cookie, ...init.headers },
    });
    const cookie = response.headers.getSetCookie()[0];
    if (cookie) this.cookie = cookie.split(";")[0];
    return response;
  }
  async get(path = "/api/state") {
    const response = await this.request(path);
    return { response, data: await response.json() };
  }
  async send(action: string, values: Record<string, unknown> = {}) {
    const response = await this.request("/api/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...values }),
    });
    return { response, data: await response.json() };
  }
}
describe.skipIf(!process.env.TEST_URL)("live HTTP workflows", () => {
  it("keeps code access separate from account ownership across login, recovery and logout", async () => {
    const browser = new Client();
    const stranger = new Client();
    await browser.get();
    await stranger.get();
    const email = `guest-${randomUUID()}@example.invalid`;
    const values = {
      requestId: randomUUID(), type: "issue", title: "HTTP guest ownership",
      body: "Synthetic code-only guest ownership verification.", anonymous: true, email,
    };
    const created = await browser.send("createPost", values);
    expect(created.response.status).toBe(200);
    const { id, number, code } = created.data;
    const edit = { id, title: "Edited guest", body: "Synthetic edited guest feedback text." };
    expect((await browser.send("createPost", values)).data).toMatchObject({ id, duplicate: true });
    expect((await browser.send("createPost", values)).data.code).toBeUndefined();
    expect((await browser.send("editPost", edit)).response.status).toBe(403);
    expect((await stranger.send("editPost", edit)).response.status).toBe(403);
    expect((await browser.send("unlockPost", { number, code: "wrong-code" })).response.status).toBe(401);
    expect((await browser.send("unlockPost", { number, code })).response.status).toBe(200);
    expect((await browser.send("editPost", edit)).response.status).toBe(200);
    await browser.send("demoLogin", { role: "user" });
    expect((await browser.send("editPost", edit)).response.status).toBe(403);
    await browser.send("unlockPost", { number, code });
    expect((await browser.get(`/api/state?post=${id}`)).data.post).toMatchObject({
      isOwner: true, isAccountOwner: false, canEdit: true,
    });
    expect((await browser.get()).data.posts.filter((post: { isAccountOwner: boolean; id: string }) =>
      post.isAccountOwner).some((post: { id: string }) => post.id === id)).toBe(false);
    const proof = await browser.send("recoverPost", { email });
    const recovery = await browser.send("resetGuestCode", { token: proof.data.localToken });
    expect(recovery.response.status).toBe(200);
    expect((await browser.send("editPost", edit)).response.status).toBe(403);
    expect((await browser.send("resetGuestCode", { token: proof.data.localToken })).response.status).toBe(400);
    await browser.send("unlockPost", { number, code: recovery.data.code });
    expect((await browser.send("editPost", edit)).response.status).toBe(200);
    await browser.send("demoLogin", { role: "teacher" });
    expect((await browser.send("editPost", edit)).response.status).toBe(403);
    await browser.send("unlockPost", { number, code: recovery.data.code });
    await browser.send("logout");
    expect((await browser.send("editPost", edit)).response.status).toBe(403);
  });
  it("enforces CSRF, anonymous visibility, real uploads, official replies and status changes", async () => {
    const guest = new Client(),
      admin = new Client(),
      other = new Client();
    expect((await guest.get()).response.status).toBe(200);
    await admin.get();
    await other.get();
    const forbidden = await fetch(`${base}/api/actions`, {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "demoLogin", role: "admin" }),
    });
    expect(forbidden.status).toBe(403);
    expect(
      (await admin.send("demoLogin", { role: "admin" })).response.status,
    ).toBe(200);
    const contents = "Файл жүктеуді тексеру";
    const bytes = new TextEncoder().encode(contents);
    const prepared = await guest.send("prepareUpload", {
      name: "тексеру.txt",
      size: bytes.length,
      mime: "text/plain",
    });
    expect(prepared.response.status).toBe(200);
    const uploaded = await guest.request(prepared.data.url, {
      method: "PUT",
      body: bytes,
      headers: { "Content-Type": "text/plain" },
    });
    expect(uploaded.status).toBe(200);
    expect(
      (await guest.send("completeUpload", { id: prepared.data.id })).response
        .status,
    ).toBe(200);
    expect((await other.request(`/api/files/${prepared.data.id}`)).status).toBe(
      403,
    );
    const posted = await guest.send("createPost", {
      requestId: randomUUID(),
      type: "issue",
      title: "HTTP сынақ өтініші",
      body: "Тіркемесі бар анонимді өтініштің толық тексеруі.",
      anonymous: true,
      attachments: [prepared.data.id],
    });
    expect(posted.response.status).toBe(200);
    expect(posted.data.code).toBeTruthy();
    const id = posted.data.id;
    expect((await guest.get(`/api/state?post=${id}`)).data.post).toMatchObject({
      isOwner: false, isAccountOwner: false, canEdit: false,
    });
    expect((await guest.send("editPost", {
      id, title: "Denied before unlock", body: "Synthetic unapproved guest edit.",
    })).response.status).toBe(403);
    expect((await guest.send("unlockPost", {
      number: posted.data.number, code: posted.data.code,
    })).response.status).toBe(200);
    const file = await other.request(`/api/files/${prepared.data.id}`);
    expect(file.status).toBe(200);
    expect(await file.text()).toBe(contents);
    expect(file.headers.get("content-disposition")).toContain("attachment");
    const seen = await admin.get(`/api/state?post=${id}`);
    expect(seen.data.contact).toBeNull();
    expect(seen.data.post.authorName).toBe("Анонимді автор");
    expect(
      (
        await admin.send("officialReply", {
          id,
          body: "Ресми сынақ жауабы: сұрақ қаралды.",
        })
      ).response.status,
    ).toBe(200);
    expect(
      (
        await guest.send("editPost", {
          id,
          title: "Жаңа атау",
          body: "Өңдеуге болмайтын сынақ мәтіні.",
        })
      ).response.status,
    ).toBe(409);
    await admin.send("setStatus", { id, status: "resolved" });
    expect(
      (await guest.send("resolution", { id, resolved: false })).response.status,
    ).toBe(200);
    expect((await guest.get(`/api/state?post=${id}`)).data.post.status).toBe(
      "reviewing",
    );
    await admin.send("moderate", {
      id,
      mode: "hide",
      reason: "Сынақ жасыру себебі",
    });
    expect((await other.get(`/api/state?post=${id}`)).response.status).toBe(
      404,
    );
    expect((await other.request(`/api/files/${prepared.data.id}`)).status).toBe(
      404,
    );
    await admin.send("moderate", { id, mode: "delete" });
    expect((await guest.get(`/api/state?post=${id}`)).response.status).toBe(
      404,
    );
    await admin.send("runJobs");
  });
  it("registers, verifies and recovers a local test account without external email", async () => {
    const user = new Client();
    await user.get();
    const email = `test-${randomUUID()}@example.com`;
    const password = `local-test-${randomUUID()}`;
    const registered = await user.send("register", {
      name: "Сынақ қолданушы",
      phone: "+77000000000",
      email,
      password,
    });
    expect(registered.response.status).toBe(200);
    expect(registered.data.localToken).toBeTruthy();
    expect(
      (
        await user.send("toggleSupport", {
          id: "00000000-0000-4000-8000-000000001000",
        })
      ).response.status,
    ).toBe(401);
    const confirmation = await user.send("resendConfirmation", { email });
    expect(confirmation.response.status).toBe(200);
    expect(confirmation.data.localToken).toBeTruthy();
    await user.send("confirmEmail", { token: confirmation.data.localToken });
    expect((await user.get()).data.viewer.verified).toBe(true);
    await user.send("logout");
    expect(
      (await user.send("login", { email, password })).response.status,
    ).toBe(200);
    const savedId = "00000000-0000-4000-8000-000000001000";
    await user.send("toggleBookmark", { id: savedId });
    const secondDevice = new Client();
    await secondDevice.get();
    await secondDevice.send("login", { email, password });
    expect(
      (await secondDevice.get()).data.posts.some(
        (p: { id: string; saved: boolean }) => p.id === savedId && p.saved,
      ),
    ).toBe(true);
    const reset = await user.send("forgotPassword", { email });
    expect(reset.data.localToken).toBeTruthy();
    expect(
      (
        await user.send("resetPassword", {
          token: reset.data.localToken,
          password: `new-${password}`,
        })
      ).response.status,
    ).toBe(200);
    expect((await secondDevice.get()).data.viewer).toBeNull();
    await user.send("logout");
    expect(
      (await user.send("login", { email, password })).response.status,
    ).toBe(401);
    expect(
      (await user.send("login", { email, password: `new-${password}` }))
        .response.status,
    ).toBe(200);
  });
  it("exports a valid workbook only for management", async () => {
    const admin = new Client();
    await admin.get();
    expect((await admin.request("/api/export")).status).toBe(401);
    await admin.send("demoLogin", { role: "admin" });
    const response = await admin.request("/api/export");
    expect(response.status).toBe(200);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await response.arrayBuffer());
    expect(book.worksheets.length).toBeGreaterThanOrEqual(7);
    expect(book.getWorksheet("Жалпы есеп")!.getCell("A2").value).toBe(
      "Кері байланыс саны",
    );
    expect(
      (await admin.get("/api/state?from=2026-12-31&to=2026-01-01")).response
        .status,
    ).toBe(400);
  });
});
