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
