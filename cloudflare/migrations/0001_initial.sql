-- Users created/upserted on first SSO login via Cloudflare Access
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  sso_id     TEXT NOT NULL UNIQUE,   -- "sub" claim from Cloudflare Access JWT
  provider   TEXT NOT NULL,          -- "google" | "github" | "microsoft"
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  owner_id   TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL REFERENCES projects(id),
  user_id    TEXT NOT NULL REFERENCES users(id),
  role       TEXT NOT NULL CHECK(role IN ('owner', 'editor', 'viewer')),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS files (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id),
  name        TEXT NOT NULL,
  r2_key      TEXT NOT NULL,
  type        TEXT NOT NULL CHECK(type IN ('tex', 'bib', 'image', 'pdf')),
  size        INTEGER,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT NOT NULL REFERENCES users(id),
  UNIQUE (project_id, name)
);
