/**
 * End-to-end HTTP route tests.
 *
 * `SELF` is the Worker's own fetch function running inside Miniflare,
 * so D1, R2, and Durable Objects are fully emulated.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchMock, SELF } from "cloudflare:test";
import {
  applySchema,
  generateTestKeyPair,
  signJwt,
  testClaims,
  type TestKeyPair,
} from "./helpers";

const TEAM_DOMAIN = "test.cloudflareaccess.com";

let pair: TestKeyPair;
let validJwt: string;

beforeAll(async () => {
  await applySchema();

  pair = await generateTestKeyPair();
  validJwt = await signJwt(testClaims(), pair);

  fetchMock.activate();
  fetchMock.disableNetConnect();

  // Register enough intercepts for the JWKS endpoint (key is cached after first fetch)
  for (let i = 0; i < 20; i++) {
    fetchMock
      .get(`https://${TEAM_DOMAIN}`)
      .intercept({ path: "/cdn-cgi/access/certs" })
      .reply(200, JSON.stringify({ keys: [pair.jwk] }));
  }
});

afterAll(() => fetchMock.deactivate());

// ── Helpers ───────────────────────────────────────────────────────────────────

function req(method: string, path: string, body?: unknown): Request {
  return new Request(`https://worker.test${path}`, {
    method,
    headers: {
      "Cf-Access-Jwt-Assertion": validJwt,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function json<T>(res: Response): Promise<T> {
  return res.json() as Promise<T>;
}

// ── Auth guard ────────────────────────────────────────────────────────────────

describe("auth guard", () => {
  it("returns 401 with no auth header", async () => {
    const res = await SELF.fetch("https://worker.test/api/me");
    expect(res.status).toBe(401);
  });

  it("returns 401 for an invalid JWT", async () => {
    const res = await SELF.fetch("https://worker.test/api/me", {
      headers: { "Cf-Access-Jwt-Assertion": "bad.token.here" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 404 for an unknown route (not 401)", async () => {
    const res = await SELF.fetch(req("GET", "/api/does-not-exist"));
    expect(res.status).toBe(404);
  });
});

// ── GET /api/me ───────────────────────────────────────────────────────────────

describe("GET /api/me", () => {
  it("creates and returns the user on first call", async () => {
    const res = await SELF.fetch(req("GET", "/api/me"));
    expect(res.status).toBe(200);
    const user = await json<{ sso_id: string; email: string; name: string }>(res);
    expect(user.sso_id).toBe("sso-test-001");
    expect(user.email).toBe("alice@example.com");
    expect(user.name).toBe("Alice Test");
  });

  it("returns the same user on subsequent calls (idempotent)", async () => {
    const r1 = await SELF.fetch(req("GET", "/api/me"));
    const r2 = await SELF.fetch(req("GET", "/api/me"));
    const u1 = await json<{ id: string }>(r1);
    const u2 = await json<{ id: string }>(r2);
    expect(u1.id).toBe(u2.id);
  });
});

// ── POST /api/projects ────────────────────────────────────────────────────────

describe("POST /api/projects", () => {
  it("returns 400 when name is missing", async () => {
    const res = await SELF.fetch(req("POST", "/api/projects", {}));
    expect(res.status).toBe(400);
  });

  it("returns 400 when name is blank", async () => {
    const res = await SELF.fetch(req("POST", "/api/projects", { name: "   " }));
    expect(res.status).toBe(400);
  });

  it("creates a project and returns 201 with the new project", async () => {
    const res = await SELF.fetch(req("POST", "/api/projects", { name: "My LaTeX Doc" }));
    expect(res.status).toBe(201);
    const proj = await json<{ id: string; name: string }>(res);
    expect(proj.name).toBe("My LaTeX Doc");
    expect(proj.id).toBeTruthy();
  });
});

// ── GET /api/projects ─────────────────────────────────────────────────────────

describe("GET /api/projects", () => {
  it("returns an array (may be empty)", async () => {
    const res = await SELF.fetch(req("GET", "/api/projects"));
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  it("includes newly created projects", async () => {
    await SELF.fetch(req("POST", "/api/projects", { name: "Listed Project" }));
    const res = await SELF.fetch(req("GET", "/api/projects"));
    const list = await json<{ name: string }[]>(res);
    expect(list.some((p) => p.name === "Listed Project")).toBe(true);
  });
});

// ── GET /api/projects/:id ─────────────────────────────────────────────────────

describe("GET /api/projects/:id", () => {
  it("returns 404 for an unknown project", async () => {
    const res = await SELF.fetch(req("GET", "/api/projects/does-not-exist"));
    expect(res.status).toBe(404);
  });

  it("returns the project with role and files array", async () => {
    const createRes = await SELF.fetch(req("POST", "/api/projects", { name: "Detail Test" }));
    const { id } = await json<{ id: string }>(createRes);

    const res = await SELF.fetch(req("GET", `/api/projects/${id}`));
    expect(res.status).toBe(200);
    const detail = await json<{ name: string; role: string; files: unknown[] }>(res);
    expect(detail.name).toBe("Detail Test");
    expect(detail.role).toBe("owner");
    expect(Array.isArray(detail.files)).toBe(true);
  });
});

// ── DELETE /api/projects/:id ──────────────────────────────────────────────────

describe("DELETE /api/projects/:id", () => {
  it("deletes the project and returns 204", async () => {
    const createRes = await SELF.fetch(req("POST", "/api/projects", { name: "To Delete" }));
    const { id } = await json<{ id: string }>(createRes);

    const delRes = await SELF.fetch(req("DELETE", `/api/projects/${id}`));
    expect(delRes.status).toBe(204);

    const getRes = await SELF.fetch(req("GET", `/api/projects/${id}`));
    expect(getRes.status).toBe(404);
  });
});

// ── File upload / download / delete ───────────────────────────────────────────

describe("file CRUD", () => {
  it("PUT creates a file, GET retrieves it, DELETE removes it", async () => {
    const createRes = await SELF.fetch(req("POST", "/api/projects", { name: "File CRUD" }));
    const { id } = await json<{ id: string }>(createRes);

    const content = "\\documentclass{article}\\begin{document}Hello\\end{document}";

    const putRes = await SELF.fetch(
      new Request(`https://worker.test/api/projects/${id}/files/main.tex`, {
        method: "PUT",
        headers: {
          "Cf-Access-Jwt-Assertion": validJwt,
          "Content-Type": "text/plain",
        },
        body: content,
      }),
    );
    expect(putRes.status).toBe(200);
    const file = await json<{ name: string; type: string }>(putRes);
    expect(file.name).toBe("main.tex");
    expect(file.type).toBe("tex");

    const getRes = await SELF.fetch(req("GET", `/api/projects/${id}/files/main.tex`));
    expect(getRes.status).toBe(200);
    expect(await getRes.text()).toBe(content);

    const delRes = await SELF.fetch(req("DELETE", `/api/projects/${id}/files/main.tex`));
    expect(delRes.status).toBe(204);

    const afterDel = await SELF.fetch(req("GET", `/api/projects/${id}/files/main.tex`));
    expect(afterDel.status).toBe(404);
  });

  it("GET returns 404 for a file that was never uploaded", async () => {
    const createRes = await SELF.fetch(req("POST", "/api/projects", { name: "No File" }));
    const { id } = await json<{ id: string }>(createRes);
    const res = await SELF.fetch(req("GET", `/api/projects/${id}/files/missing.tex`));
    expect(res.status).toBe(404);
  });
});

// ── Members ───────────────────────────────────────────────────────────────────

describe("members", () => {
  // Register a second user (bob) so invite-by-email tests have a target.
  let bobJwt: string;
  let projectId: string;

  beforeAll(async () => {
    bobJwt = await signJwt(
      testClaims({ sub: "sso-bob-001", email: "bob@example.com", name: "Bob Test" }),
      pair,
    );
    // Create the bob user record in D1 by calling /api/me as him.
    await SELF.fetch(
      new Request("https://worker.test/api/me", {
        headers: { "Cf-Access-Jwt-Assertion": bobJwt },
      }),
    );

    // Alice creates a project for member tests.
    const res = await SELF.fetch(req("POST", "/api/projects", { name: "Member Test Project" }));
    projectId = (await json<{ id: string }>(res)).id;
  });

  it("GET /members returns the owner", async () => {
    const res = await SELF.fetch(req("GET", `/api/projects/${projectId}/members`));
    expect(res.status).toBe(200);
    const members = await json<{ role: string; email: string }[]>(res);
    expect(members).toHaveLength(1);
    expect(members[0].role).toBe("owner");
    expect(members[0].email).toBe("alice@example.com");
  });

  it("POST /members returns 400 when email is missing", async () => {
    const res = await SELF.fetch(req("POST", `/api/projects/${projectId}/members`, { role: "editor" }));
    expect(res.status).toBe(400);
  });

  it("POST /members returns 400 for invalid role", async () => {
    const res = await SELF.fetch(
      req("POST", `/api/projects/${projectId}/members`, { email: "bob@example.com", role: "admin" }),
    );
    expect(res.status).toBe(400);
  });

  it("POST /members returns 404 for unknown email", async () => {
    const res = await SELF.fetch(
      req("POST", `/api/projects/${projectId}/members`, { email: "nobody@example.com", role: "editor" }),
    );
    expect(res.status).toBe(404);
  });

  it("invites bob, verifies presence, then returns 409 on duplicate invite", async () => {
    // First invite: success
    const first = await SELF.fetch(
      req("POST", `/api/projects/${projectId}/members`, { email: "bob@example.com", role: "editor" }),
    );
    expect(first.status).toBe(204);

    // Verify bob appears in the list
    const listRes = await SELF.fetch(req("GET", `/api/projects/${projectId}/members`));
    const members = await json<{ role: string; email: string }[]>(listRes);
    expect(members).toHaveLength(2);
    expect(members.find((m) => m.email === "bob@example.com")?.role).toBe("editor");

    // Second invite: conflict
    const dup = await SELF.fetch(
      req("POST", `/api/projects/${projectId}/members`, { email: "bob@example.com", role: "viewer" }),
    );
    expect(dup.status).toBe(409);
  });

  it("POST /members returns 403 for non-owner (bob as editor cannot invite)", async () => {
    // Alice invites bob first so bob has access to the project
    await SELF.fetch(
      req("POST", `/api/projects/${projectId}/members`, { email: "bob@example.com", role: "editor" }),
    );

    // Register carol
    const carolJwt = await signJwt(
      testClaims({ sub: "sso-carol-001", email: "carol@example.com", name: "Carol Test" }),
      pair,
    );
    await SELF.fetch(new Request("https://worker.test/api/me", {
      headers: { "Cf-Access-Jwt-Assertion": carolJwt },
    }));

    // Bob (editor) tries to invite carol — should be forbidden
    const res = await SELF.fetch(
      new Request(`https://worker.test/api/projects/${projectId}/members`, {
        method: "POST",
        headers: { "Cf-Access-Jwt-Assertion": bobJwt, "Content-Type": "application/json" },
        body: JSON.stringify({ email: "carol@example.com", role: "viewer" }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("PATCH changes bob's role to viewer; non-owner gets 403", async () => {
    // Set up: invite bob
    await SELF.fetch(
      req("POST", `/api/projects/${projectId}/members`, { email: "bob@example.com", role: "editor" }),
    );
    const listRes = await SELF.fetch(req("GET", `/api/projects/${projectId}/members`));
    const members = await json<{ user_id: string; email: string }[]>(listRes);
    const bob = members.find((m) => m.email === "bob@example.com")!;

    // Alice (owner) changes bob's role to viewer
    const patchRes = await SELF.fetch(
      req("PATCH", `/api/projects/${projectId}/members/${bob.user_id}`, { role: "viewer" }),
    );
    expect(patchRes.status).toBe(204);

    const updated = await SELF.fetch(req("GET", `/api/projects/${projectId}/members`));
    const after = await json<{ email: string; role: string }[]>(updated);
    expect(after.find((m) => m.email === "bob@example.com")?.role).toBe("viewer");

    // Bob (viewer) tries to change his own role — should be forbidden
    const forbidRes = await SELF.fetch(
      new Request(`https://worker.test/api/projects/${projectId}/members/${bob.user_id}`, {
        method: "PATCH",
        headers: { "Cf-Access-Jwt-Assertion": bobJwt, "Content-Type": "application/json" },
        body: JSON.stringify({ role: "editor" }),
      }),
    );
    expect(forbidRes.status).toBe(403);
  });

  it("DELETE removes bob from the project", async () => {
    // Set up: invite bob
    await SELF.fetch(
      req("POST", `/api/projects/${projectId}/members`, { email: "bob@example.com", role: "editor" }),
    );
    const listRes = await SELF.fetch(req("GET", `/api/projects/${projectId}/members`));
    const members = await json<{ user_id: string; email: string }[]>(listRes);
    const bob = members.find((m) => m.email === "bob@example.com")!;

    const delRes = await SELF.fetch(req("DELETE", `/api/projects/${projectId}/members/${bob.user_id}`));
    expect(delRes.status).toBe(204);

    const afterDel = await SELF.fetch(req("GET", `/api/projects/${projectId}/members`));
    const remaining = await json<{ email: string }[]>(afterDel);
    expect(remaining.find((m) => m.email === "bob@example.com")).toBeUndefined();
  });

  it("cannot modify the project owner via PATCH", async () => {
    const listRes = await SELF.fetch(req("GET", `/api/projects/${projectId}/members`));
    const members = await json<{ user_id: string; role: string }[]>(listRes);
    const owner = members.find((m) => m.role === "owner")!;

    const res = await SELF.fetch(
      req("PATCH", `/api/projects/${projectId}/members/${owner.user_id}`, { role: "editor" }),
    );
    expect(res.status).toBe(400);
  });
});

// ── Yjs snapshot ──────────────────────────────────────────────────────────────

describe("GET /yjs/:name", () => {
  it("returns 404 when no snapshot exists", async () => {
    const createRes = await SELF.fetch(req("POST", "/api/projects", { name: "Yjs Test" }));
    const { id } = await json<{ id: string }>(createRes);

    const res = await SELF.fetch(req("GET", `/api/projects/${id}/yjs/main.tex`));
    expect(res.status).toBe(404);
  });

  it("returns the snapshot bytes when it exists", async () => {
    const createRes = await SELF.fetch(req("POST", "/api/projects", { name: "Yjs Snapshot" }));
    const { id } = await json<{ id: string }>(createRes);

    // Manually put a fake snapshot into R2 via the storage key convention
    const { env } = await import("cloudflare:test");
    await env.STORAGE.put(`projects/${id}/yjs/main.tex.bin`, new Uint8Array([1, 2, 3, 4]));

    const res = await SELF.fetch(req("GET", `/api/projects/${id}/yjs/main.tex`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body).toEqual(new Uint8Array([1, 2, 3, 4]));
  });
});

// ── Output PDF ────────────────────────────────────────────────────────────────

describe("output.pdf", () => {
  it("returns 404 before any PDF is stored", async () => {
    const createRes = await SELF.fetch(req("POST", "/api/projects", { name: "No PDF Yet" }));
    const { id } = await json<{ id: string }>(createRes);
    const res = await SELF.fetch(req("GET", `/api/projects/${id}/output.pdf`));
    expect(res.status).toBe(404);
  });

  it("stores a PDF and retrieves it with the correct content-type", async () => {
    const createRes = await SELF.fetch(req("POST", "/api/projects", { name: "PDF Store" }));
    const { id } = await json<{ id: string }>(createRes);

    // Minimal valid PDF header bytes
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

    const putRes = await SELF.fetch(
      new Request(`https://worker.test/api/projects/${id}/output.pdf`, {
        method: "PUT",
        headers: {
          "Cf-Access-Jwt-Assertion": validJwt,
          "Content-Type": "application/pdf",
        },
        body: pdfBytes,
      }),
    );
    expect(putRes.status).toBe(204);

    const getRes = await SELF.fetch(req("GET", `/api/projects/${id}/output.pdf`));
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get("content-type")).toBe("application/pdf");
    const body = new Uint8Array(await getRes.arrayBuffer());
    expect(body).toEqual(pdfBytes);
  });
});
