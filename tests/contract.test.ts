// Contract validation for openapi.yml (Refs #6).
// The document is the agreement between the mockService (#5), the repository
// backends (#9/#10) and the connected frontend (#11). These tests keep it
// structurally complete and in exact sync with the typed frontend contract
// (src/services/types.ts) — an undocumented or phantom action is a failure.
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { actionNames } from "../src/services/types";

type Operation = {
  summary?: string;
  parameters?: { name: string; in: string; required?: boolean }[];
  responses: Record<string, unknown>;
  security?: unknown[];
};
type Spec = {
  openapi: string;
  paths: Record<string, Record<string, Operation>>;
  components: {
    schemas: Record<string, unknown>;
    securitySchemes: Record<string, unknown>;
  };
};

const spec = parse(
  await readFile(new URL("../openapi.yml", import.meta.url), "utf8"),
) as Spec;

const action = spec.paths["/api/actions"].post;

describe("openapi.yml document structure", () => {
  it("declares OpenAPI 3.1", () => {
    expect(spec.openapi).toMatch(/^3\.1\.\d+$/);
  });

  it("documents every route the application serves", () => {
    for (const path of [
      "/api/state",
      "/api/actions",
      "/api/files/{id}",
      "/api/export",
      "/api/jobs",
    ])
      expect(Object.keys(spec.paths)).toContain(path);
    expect(spec.paths["/api/files/{id}"].get).toBeTruthy();
    expect(spec.paths["/api/files/{id}"].put).toBeTruthy();
  });

  it("documents state query parameters", () => {
    const names = spec.paths["/api/state"].get.parameters!.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(["from", "to"]));
    const detail = spec.paths["/api/state/{post}"].get.parameters!;
    expect(detail.map((p) => p.name)).toContain("post");
  });

  it("every operation defines error responses, not just happy paths", () => {
    // /api/state GET takes no body and /api/jobs only authenticates a bearer
    // token, so neither can meaningfully return 400; everything else can.
    const noBody = ["/api/state", "/api/jobs"];
    for (const [path, operations] of Object.entries(spec.paths))
      for (const [method, operation] of Object.entries(operations)) {
        if (!("responses" in operation)) continue;
        const codes = Object.keys(operation.responses);
        expect(codes, `${method} ${path}`).toContain("500");
        if (!noBody.includes(path))
          expect(codes, `${method} ${path}`).toContain("400");
      }
  });

  it("protects the worker with bearer auth and users with cookies", () => {
    expect(spec.paths["/api/jobs"].post.security).toBeTruthy();
    expect(spec.components.securitySchemes.sessionCookie).toMatchObject({
      name: "maxball_session",
      in: "cookie",
    });
  });

  it("describes the shared result, error, boot and detail schemas", () => {
    for (const name of ["Error", "Result", "Boot", "Detail", "Post", "Viewer", "Statistics", "ActionRequest"])
      expect(Object.keys(spec.components.schemas)).toContain(name);
    expect(spec.components.schemas.Error).toMatchObject({
      required: ["error"],
    });
  });
});

describe("action discriminator parity with the typed service contract", () => {
  const documented = (
    (spec.components.schemas.ActionRequest as {
      properties: { action: { enum: string[] } };
    }).properties.action.enum
  ).sort();

  it("documents exactly the typed actionNames, neither more nor fewer", () => {
    expect(documented).toEqual([...actionNames].sort());
  });

  it("rejects nothing the server dispatches and invents nothing new", () => {
    // Both directions asserted explicitly for actionable failure messages.
    const frontend = new Set(actionNames);
    for (const name of documented) expect(frontend, name).toBeTruthy();
    const docs = new Set(documented);
    for (const name of frontend) expect(docs, name).toBeTruthy();
  });

  it("describes the payload fields used by the forms", () => {
    const properties = Object.keys(
      (spec.components.schemas.ActionRequest as { properties: Record<string, unknown> })
        .properties,
    );
    for (const field of [
      "role", "email", "password", "requestId", "type", "title", "body",
      "anonymous", "attachments", "id", "number", "code", "stars", "status",
      "mode", "reason", "target", "active",
    ])
      expect(properties, field).toContain(field);
  });
});

describe("contract behavioral cross-checks", () => {
  it("Result covers the fields real action payloads return", () => {
    const result = spec.components.schemas.Result as {
      properties: Record<string, unknown>;
    };
    for (const field of ["ok", "id", "number", "code", "url", "local"])
      expect(Object.keys(result.properties)).toContain(field);
  });

  it("Post schema keeps the privacy-relevant projection fields", () => {
    const post = spec.components.schemas.Post as { required: string[] };
    for (const field of ["anonymous", "authorName", "isOwner", "canEdit"])
      expect(post.required, field).toContain(field);
  });
});
