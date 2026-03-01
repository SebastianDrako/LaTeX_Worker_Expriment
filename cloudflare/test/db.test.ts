import { beforeAll, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import {
  createProject,
  deleteFile,
  getMemberRole,
  getProject,
  getProjectFiles,
  getUserProjects,
  updateProjectTimestamp,
  upsertFile,
  upsertUser,
} from "../src/db";
import type { AccessClaims } from "../src/auth";
import { applySchema } from "./helpers";

/** Build a minimal AccessClaims object for testing. */
function claims(sub: string, overrides?: Partial<AccessClaims>): AccessClaims {
  return {
    sub,
    email: `${sub}@example.com`,
    name: sub,
    aud: "test-aud",
    iss: "https://test.cloudflareaccess.com",
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

beforeAll(async () => {
  await applySchema();
});

// ── Users ──────────────────────────────────────────────────────────────────────

describe("upsertUser", () => {
  it("creates a new user on first call", async () => {
    const user = await upsertUser(env.DB, claims("sso-new-001"));
    expect(user.sso_id).toBe("sso-new-001");
    expect(user.email).toBe("sso-new-001@example.com");
    expect(user.id).toBeTruthy();
  });

  it("returns the same user (same id) on subsequent calls", async () => {
    const first = await upsertUser(env.DB, claims("sso-idempotent"));
    const second = await upsertUser(env.DB, claims("sso-idempotent"));
    expect(first.id).toBe(second.id);
  });
});

// ── Projects ───────────────────────────────────────────────────────────────────

describe("createProject", () => {
  it("creates a project and assigns 'owner' role to the creator", async () => {
    const owner = await upsertUser(env.DB, claims("sso-owner-a"));
    const project = await createProject(env.DB, "My Thesis", owner.id);

    expect(project.name).toBe("My Thesis");
    expect(project.owner_id).toBe(owner.id);
    expect(project.id).toBeTruthy();

    const role = await getMemberRole(env.DB, project.id, owner.id);
    expect(role).toBe("owner");
  });

  it("returns null role for users not in the project", async () => {
    const owner = await upsertUser(env.DB, claims("sso-owner-b"));
    const stranger = await upsertUser(env.DB, claims("sso-stranger-b"));
    const project = await createProject(env.DB, "Private", owner.id);

    expect(await getMemberRole(env.DB, project.id, stranger.id)).toBeNull();
  });
});

describe("getProject", () => {
  it("returns null for an unknown project id", async () => {
    expect(await getProject(env.DB, "nonexistent-id")).toBeNull();
  });

  it("returns the project by id", async () => {
    const owner = await upsertUser(env.DB, claims("sso-get-proj"));
    const created = await createProject(env.DB, "Retrievable", owner.id);
    const fetched = await getProject(env.DB, created.id);
    expect(fetched?.name).toBe("Retrievable");
  });
});

describe("getUserProjects", () => {
  it("lists only the projects the user belongs to", async () => {
    const user = await upsertUser(env.DB, claims("sso-list-user"));
    const other = await upsertUser(env.DB, claims("sso-list-other"));

    await createProject(env.DB, "Project A", user.id);
    await createProject(env.DB, "Project B", user.id);
    await createProject(env.DB, "Other's project", other.id);

    const projects = await getUserProjects(env.DB, user.id);
    expect(projects.length).toBeGreaterThanOrEqual(2);
    expect(projects.every((p) => p.owner_id === user.id)).toBe(true);
  });
});

describe("updateProjectTimestamp", () => {
  it("updates updated_at without touching other fields", async () => {
    const owner = await upsertUser(env.DB, claims("sso-ts-owner"));
    const project = await createProject(env.DB, "Timestamp Test", owner.id);
    const before = project.updated_at;

    await new Promise((r) => setTimeout(r, 10)); // ensure time advances
    await updateProjectTimestamp(env.DB, project.id);

    const updated = await getProject(env.DB, project.id);
    expect(updated?.updated_at).not.toBe(before);
    expect(updated?.name).toBe("Timestamp Test");
  });
});

// ── Files ──────────────────────────────────────────────────────────────────────

describe("upsertFile", () => {
  it("creates a new file record", async () => {
    const owner = await upsertUser(env.DB, claims("sso-file-owner"));
    const project = await createProject(env.DB, "File Project", owner.id);
    const now = new Date().toISOString();

    const file = await upsertFile(env.DB, {
      project_id: project.id,
      name: "main.tex",
      r2_key: `projects/${project.id}/tex/main.tex`,
      type: "tex",
      size: 512,
      updated_at: now,
      updated_by: owner.id,
    });

    expect(file.id).toBeTruthy();
    expect(file.name).toBe("main.tex");
    expect(file.size).toBe(512);
  });

  it("updates (not duplicates) a file with the same name", async () => {
    const owner = await upsertUser(env.DB, claims("sso-upsert-owner"));
    const project = await createProject(env.DB, "Upsert Project", owner.id);
    const base = {
      project_id: project.id,
      name: "main.tex",
      r2_key: `projects/${project.id}/tex/main.tex`,
      type: "tex" as const,
      size: 100,
      updated_at: new Date().toISOString(),
      updated_by: owner.id,
    };

    const first = await upsertFile(env.DB, base);
    const second = await upsertFile(env.DB, { ...base, size: 200 });

    expect(second.id).toBe(first.id); // same record, not a duplicate
    expect(second.size).toBe(200);

    const files = await getProjectFiles(env.DB, project.id);
    expect(files).toHaveLength(1);
  });
});

describe("deleteFile", () => {
  it("returns the r2_key of the deleted file", async () => {
    const owner = await upsertUser(env.DB, claims("sso-del-owner"));
    const project = await createProject(env.DB, "Delete Project", owner.id);
    const r2Key = `projects/${project.id}/tex/main.tex`;
    await upsertFile(env.DB, {
      project_id: project.id,
      name: "main.tex",
      r2_key: r2Key,
      type: "tex",
      size: null,
      updated_at: new Date().toISOString(),
      updated_by: owner.id,
    });

    const returned = await deleteFile(env.DB, project.id, "main.tex");
    expect(returned).toBe(r2Key);
    expect(await getProjectFiles(env.DB, project.id)).toHaveLength(0);
  });

  it("returns null for a file that does not exist", async () => {
    const owner = await upsertUser(env.DB, claims("sso-del-miss"));
    const project = await createProject(env.DB, "Miss Project", owner.id);
    expect(await deleteFile(env.DB, project.id, "nonexistent.tex")).toBeNull();
  });
});
