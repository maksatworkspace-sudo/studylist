import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
// These suites drive a real dev server whose first requests pay the
// staging copy's cold route compilation; the unit default (15s) cannot
// cover that under parallel load.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const base = process.env.TEST_URL || "http://127.0.0.1:3000";

class QAClient {
  cookie = "";

  async request(path: string, init: RequestInit = {}) {
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: { origin: base, cookie: this.cookie, ...init.headers },
    });
    const cookie = response.headers.getSetCookie()[0];
    if (cookie) this.cookie = cookie.split(";")[0];
    const data = await response.json();
    return { status: response.status, data };
  }

  send(action: string, values: Record<string, unknown> = {}) {
    return this.request("/api/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...values }),
    });
  }
}

type Kind = "course" | "teacher";
const kinds: Kind[] = ["course", "teacher"];

describe.skipIf(!process.env.TEST_URL)(
  "independent QA catalog regressions (#7 and #8)",
  () => {
    const guest = new QAClient();
    const leadership = new QAClient();
    const run = randomUUID();
    const ownedPosts = new Set<string>();
    const stagedFiles = new Set<string>();
    const active = {} as Record<Kind, string>;
    const inactive = {} as Record<Kind, string>;
    const names = {} as Record<Kind, string>;
    let accountId = "";

    async function post(values: Record<string, unknown> = {}) {
      const result = await guest.send("createPost", {
        requestId: randomUUID(),
        type: "issue",
        title: `QA catalog ${randomUUID()}`,
        body: "Independent QA synthetic regression; no personal information.",
        anonymous: true,
        ...values,
      });
      if (result.status === 200 && typeof result.data.id === "string")
        ownedPosts.add(result.data.id);
      return result;
    }

    async function addCatalog(kind: Kind, disabled: boolean) {
      const name = `QA ${kind} ${disabled ? "inactive" : "active"} ${run}`;
      const added = await leadership.send(
        kind === "course" ? "addCourse" : "addTeacher",
        { name, subject: "QA synthetic subject" },
      );
      expect(added.status).toBe(200);
      const state = await leadership.request("/api/state");
      const records = state.data.catalog[
        kind === "course" ? "courses" : "teachers"
      ] as { id: string; name: string }[];
      const record = records.find((item) => item.name === name);
      expect(record).toBeDefined();
      const id = record!.id;
      if (disabled)
        expect(
          (
            await leadership.send("updateCatalog", {
              kind,
              id,
              name,
              subject: "QA synthetic subject",
              active: false,
            })
          ).status,
        ).toBe(200);
      else names[kind] = name;
      return id;
    }

    beforeAll(async () => {
      const state = await leadership.request("/api/state");
      expect(state.status).toBe(200);
      // Never create synthetic staff or toggle demo roles on a real deployment.
      expect(state.data.demo).toBe(true);
      expect((await guest.request("/api/state")).status).toBe(200);
      expect(
        (await leadership.send("demoLogin", { role: "leadership" })).status,
      ).toBe(200);
      for (const kind of kinds) {
        active[kind] = await addCatalog(kind, false);
        inactive[kind] = await addCatalog(kind, true);
      }
      const name = `QA staff ${run}`;
      expect(
        (
          await leadership.send("createStaff", {
            name,
            email: `qa-${run}@example.invalid`,
            phone: "+70000000000",
            role: "user",
          })
        ).status,
      ).toBe(200);
      const staff = (await leadership.request("/api/state")).data.staff as {
        id: string;
        name: string;
      }[];
      accountId = staff.find((person) => person.name === name)!.id;
    });

    afterAll(async () => {
      for (const id of ownedPosts) await guest.send("deletePost", { id });
      for (const id of stagedFiles) await guest.send("discardUpload", { id });
      if (accountId)
        await leadership.send("setAccountActive", {
          id: accountId,
          active: false,
        });
      for (const kind of kinds)
        if (active[kind])
          await leadership.send("updateCatalog", {
            kind,
            id: active[kind],
            name: names[kind],
            active: false,
          });
    });

    for (const kind of kinds) {
      const field = kind === "course" ? "courseId" : "teacherId";

      it(`#7 AC1 rejects a missing ${kind} with 400/404, never 500`, async () => {
        const title = `QA missing ${kind} ${run}`;
        const result = await post({ title, [field]: randomUUID() });
        expect.soft([400, 404]).toContain(result.status);
        expect.soft(result.data.error).toEqual(expect.any(String));
        const feed = (await guest.request("/api/state")).data.posts as {
          title: string;
        }[];
        expect(feed.some((item) => item.title === title)).toBe(false);
      });

      it(`#7 AC2 rejects an inactive ${kind} for new feedback`, async () => {
        const title = `QA inactive ${kind} ${run}`;
        const result = await post({ title, [field]: inactive[kind] });
        expect.soft([400, 404]).toContain(result.status);
        expect.soft(result.data.error).toEqual(expect.any(String));
        const feed = (await guest.request("/api/state")).data.posts as {
          title: string;
        }[];
        expect(feed.some((item) => item.title === title)).toBe(false);
      });

      it(`#7 AC4 rejects a malformed ${kind} identifier`, async () => {
        expect((await post({ [field]: "not-a-uuid" })).status).toBe(400);
      });

      it(`#8 AC1 returns 404 when updating a missing ${kind}`, async () => {
        const result = await leadership.send("updateCatalog", {
          id: randomUUID(),
          kind,
          name: `QA absent ${kind}`,
          active: true,
        });
        expect(result.status).toBe(404);
        expect(result.data.error).toEqual(expect.any(String));
      });
    }

    it("#8 AC2 returns 404 when disabling a missing account", async () => {
      const result = await leadership.send("setAccountActive", {
        id: randomUUID(),
        active: false,
      });
      expect(result.status).toBe(404);
      expect(result.data.error).toEqual(expect.any(String));
    });

    it("#7 AC3 leaves an owned upload reusable after invalid submission", async () => {
      const prepared = await guest.send("prepareUpload", {
        name: "qa-retry.txt",
        size: 3,
        mime: "text/plain",
      });
      expect(prepared.status).toBe(200);
      const id = prepared.data.id as string;
      stagedFiles.add(id);
      expect(
        (await guest.request(prepared.data.url, { method: "PUT", body: "abc" }))
          .status,
      ).toBe(200);
      expect((await guest.send("completeUpload", { id })).status).toBe(200);
      const rejected = await post({
        courseId: randomUUID(),
        attachments: [id],
      });
      expect.soft([400, 404]).toContain(rejected.status);
      expect((await guest.send("completeUpload", { id })).status).toBe(200);
      const retried = await post({
        courseId: active.course,
        teacherId: active.teacher,
        attachments: [id],
      });
      expect(retried.status).toBe(200);
      const detail = await guest.request(`/api/state?post=${retried.data.id}`);
      expect(detail.data.attachments.map((file: { id: string }) => file.id)).toEqual(
        [id],
      );
      stagedFiles.delete(id);
    });

    it("#8 AC4 preserves malformed-id validation for leadership mutations", async () => {
      for (const kind of kinds)
        expect(
          (
            await leadership.send("updateCatalog", {
              id: "not-a-uuid",
              kind,
              name: "QA invalid identifier",
              active: true,
            })
          ).status,
        ).toBe(400);
      expect(
        (
          await leadership.send("setAccountActive", {
            id: "not-a-uuid",
            active: false,
          })
        ).status,
      ).toBe(400);
    });

    it("#8 AC4 updates existing QA-owned catalog and account records", async () => {
      for (const kind of kinds) {
        names[kind] = `QA updated ${kind} ${run}`;
        expect(
          (
            await leadership.send("updateCatalog", {
              id: active[kind],
              kind,
              name: names[kind],
              subject: "QA updated subject",
              active: true,
            })
          ).status,
        ).toBe(200);
        const state = await leadership.request("/api/state");
        const records = state.data.catalog[
          kind === "course" ? "courses" : "teachers"
        ] as { id: string; name: string }[];
        expect(records.find((record) => record.id === active[kind])?.name).toBe(
          names[kind],
        );
      }
      for (const enabled of [false, true]) {
        expect(
          (
            await leadership.send("setAccountActive", {
              id: accountId,
              active: enabled,
            })
          ).status,
        ).toBe(200);
        const staff = (await leadership.request("/api/state")).data.staff as {
          id: string;
          active: boolean;
        }[];
        expect(staff.find((person) => person.id === accountId)?.active).toBe(
          enabled,
        );
      }
    });

    it.each(["guest", "user", "teacher", "admin"])(
      "#8 AC5 rejects %s before missing-target lookup",
      async (role) => {
        const client = new QAClient();
        expect((await client.request("/api/state")).status).toBe(200);
        if (role !== "guest")
          expect((await client.send("demoLogin", { role })).status).toBe(200);
        const status = role === "guest" ? 401 : 403;
        for (const kind of kinds)
          expect(
            (
              await client.send("updateCatalog", {
                id: randomUUID(),
                kind,
                name: "QA no permission",
                active: true,
              })
            ).status,
          ).toBe(status);
        expect(
          (
            await client.send("setAccountActive", {
              id: randomUUID(),
              active: false,
            })
          ).status,
        ).toBe(status);
      },
    );

    it("#8 AC4 preserves leadership self-protection", async () => {
      const viewer = (await leadership.request("/api/state")).data.viewer;
      expect(
        (
          await leadership.send("setAccountActive", {
            id: viewer.id,
            active: false,
          })
        ).status,
      ).toBe(400);
      expect(
        (await leadership.send("setRole", { id: viewer.id, role: "user" })).status,
      ).toBe(400);
    });
  },
);
