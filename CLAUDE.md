# CLAUDE.md

This file provides guidance for AI assistants (Claude and others) working on the **LaTeX Worker Experiment** repository.

---

## Project Overview

**Repository:** `SebastianDrako/LaTeX_Worker_Expriment`
**Owner:** Sebastian Guerrero Casadiegos
**License:** MIT
**Status:** Early development / experiment stage

This project is an experiment for building a **LaTeX worker** — a service or tool designed to process, compile, and/or manage LaTeX documents programmatically. The exact architecture and tech stack are yet to be established as of the initial commit.

---

## Repository Structure

```
LaTeX_Worker_Expriment/
├── LICENSE              # MIT License
├── CLAUDE.md            # This file
├── daemon/              # Rust daemon (Axum + Tectonic)
│   ├── Cargo.toml
│   └── src/
│       └── main.rs      # HTTP server + WebSocket + Tectonic driver + tests
├── cloudflare/          # Cloudflare Worker (TypeScript + Wrangler)
│   ├── wrangler.toml    # Worker config: D1, R2, Durable Objects
│   ├── package.json
│   ├── tsconfig.json
│   ├── migrations/
│   │   └── 0001_initial.sql   # D1 schema (users, projects, files)
│   └── src/
│       ├── index.ts     # Router + auth middleware + all API routes
│       ├── auth.ts      # Cloudflare Access JWT validation (RS256 + JWKS)
│       ├── db.ts        # D1 CRUD helpers
│       ├── storage.ts   # R2 key helpers
│       └── do/
│           └── ProjectRoom.ts  # Durable Object: WebSocket relay (text + binary)
└── frontend/            # React frontend (Vite + TypeScript)
    ├── index.html
    ├── package.json
    ├── vite.config.ts
    └── src/
        ├── main.tsx         # Entry point
        ├── App.tsx          # Root: auth guard + project/editor routing
        ├── types/index.ts   # Shared TypeScript interfaces
        ├── api/client.ts    # Fetch wrapper for Worker API + WebSocket URL
        ├── styles/app.css   # Global CSS (Overleaf-inspired design)
        ├── hooks/
        │   ├── useAuth.ts       # GET /api/me on mount
        │   ├── useProject.ts    # Project + file state management
        │   ├── useCompile.ts    # Daemon compile flow + PDF upload
        │   └── usePdfReload.ts  # WebSocket listener for pdf_updated
        └── components/
            ├── ProjectList/     # Project selection + create/delete
            └── Editor/
                ├── index.tsx    # 3-panel layout (react-resizable-panels)
                ├── Toolbar.tsx  # Compile button + status
                ├── FileTree.tsx # File list + upload + delete
                ├── CodeEditor.tsx  # CodeMirror 6 + LaTeX syntax + Yjs
                └── PdfViewer.tsx   # PDF.js multi-page viewer
```

---

## Development Workflow

### Branching Strategy

- `main` / `master` — stable, production-ready code
- `claude/<description>-<session-id>` — branches used by AI assistants for specific tasks
- Feature branches should be named descriptively: `feature/<short-description>`
- Bug fix branches: `fix/<short-description>`

### Git Conventions

- Write clear, imperative commit messages: `Add LaTeX compilation worker`, not `Added stuff`
- Keep commits focused and atomic — one logical change per commit
- Always push to the correct branch; **never push directly to `main`/`master`** without a pull request
- Use `git push -u origin <branch-name>` when pushing a branch for the first time

### Pull Request Guidelines

- PRs should have a clear title (under 70 characters) and a summary body
- Include a test plan in the PR description
- Target `main` for merges unless otherwise specified

---

## Code Conventions

Since the tech stack is not yet established, the following are general conventions to follow until a specific stack is chosen:

### General

- Prefer clarity and readability over cleverness
- Keep functions small and single-purpose
- Avoid premature abstraction — implement what is needed now, not hypothetical future requirements
- Do not add unnecessary comments; code should be self-documenting where possible

### LaTeX-Specific Considerations

When building LaTeX processing logic:

- **Compilation engine: Tectonic** (embedded as a Rust library, not a subprocess)
- Tectonic handles multi-pass and BibTeX automatically — no manual `pdflatex` → `bibtex` → `pdflatex` loops
- Supported source types: `.tex`, `.bib`, images (`.png`, `.jpg`, `.pdf`, `.eps`, etc.)
- Handle compilation errors gracefully and surface the full Tectonic log to the caller
- Auxiliary files (`.aux`, `.log`, `.toc`, `.out`, etc.) are managed in memory — no disk cleanup required
- Treat `.tex` source files as the single source of truth; never modify them unless that is the explicit purpose of the worker

### Security

- Never execute arbitrary shell commands constructed from untrusted input (LaTeX injection risk)
- Sandbox compilation processes where possible (containers, restricted environments)
- Validate all file paths to prevent directory traversal attacks
- Do not expose internal file system paths in error messages returned to clients

---

## AI Assistant Instructions

When working in this repository, follow these guidelines:

### What to do

- Read existing files before modifying them
- Keep changes minimal and focused on the task at hand
- Follow the branching strategy above — always develop on the designated `claude/` branch
- Update this `CLAUDE.md` whenever the project structure, stack, or conventions change significantly
- Prefer editing existing files over creating new ones
- Run any available tests/linters before committing

### What to avoid

- Do not push to `main` or `master` directly
- Do not add features beyond what is explicitly requested
- Do not refactor surrounding code when fixing a bug
- Do not introduce dependencies without a clear, immediate need
- Do not generate or hardcode secrets, credentials, or API keys in any file

### When the stack is established

Once a programming language, framework, or build system is chosen, update this file with:

- Language version and runtime requirements
- How to install dependencies
- How to run the project locally
- How to run tests
- How to lint/format code
- Environment variable requirements (names only, never values)

---

## Architecture Decisions (session 2026-03-01)

### Decisión: Stack de compilación LaTeX

Después de evaluar varias opciones, se decidió el siguiente enfoque:

**Motor de compilación: Tectonic**
- Escrito en Rust, compila a WASM y targets nativos
- Carga paquetes bajo demanda via HTTP Range Requests (compatible con R2)
- Maneja multi-pass automáticamente (incluye BibTeX)
- Alternativas descartadas: TeXLive.js (abandonado), SwiftLaTeX (C → Emscripten, poco mantenido)

**Modo de ejecución: Daemon local (Rust nativo)**
- El daemon corre en la máquina del usuario
- El frontend (web) se comunica con él via `localhost`
- Tectonic se embebe como librería Rust, no como subprocess
- Cero costo de infra para compilación, privacidad total

**Distribución: binario Rust nativo**
- `cargo build --release` genera un ejecutable para Windows/macOS/Linux
- El usuario instala solo el daemon; la UI vive en el browser
- Sin WebView empaquetada, sin Electron, sin Tauri

### Stack técnico

```
Daemon Rust:
  tectonic = "0.14"       # motor LaTeX embebido (soporta .tex, .bib, imágenes)
  axum = "0.7"            # HTTP local
  tokio                   # async runtime
  notify = "6"            # file watcher (live reload)

Frontend:
  Cloudflare Pages        # web app (React/Svelte/etc.)

Cloud (sync/share/auth):
  Cloudflare Access       # SSO (Google, GitHub, Microsoft — sin envío de mails)
  Cloudflare D1           # metadata, usuarios y proyectos
  Cloudflare R2           # archivos fuente y último PDF compilado
  Cloudflare Durable Objects  # coordinación de edición concurrente en tiempo real
```

### Opciones descartadas y por qué

| Opción | Motivo de descarte |
|---|---|
| VPS dedicado de compilación | Costo, complejidad de infra, no necesario |
| WASM en Cloudflare Worker | Límite de 128MB RAM, 30s CPU |
| WASM en browser (SwiftLaTeX) | Proyecto poco mantenido |
| WASM en browser (Tectonic) | Válido como fallback futuro, no como MVP |
| Tauri 2.0 | Sobreingeniería — es solo una WebView; Rust ya es multiplataforma y el browser real es suficiente como UI |
| Email auth | Workers no pueden enviar mails; SSO via Cloudflare Access cubre el caso |

---

## Architecture Decisions (session 2026-03-01 — detalle de servicios cloud)

### Autenticación: Cloudflare Access (SSO)

- Proveedores: Google, GitHub, Microsoft (configurable)
- El Worker valida el JWT recibido en `Cf-Access-Jwt-Assertion`
- El usuario se crea en D1 en el primer login (`upsert` por `sso_id`)
- No se gestiona ningún flujo de email

### D1 — Schema

```sql
users (
  id         TEXT PRIMARY KEY,
  sso_id     TEXT NOT NULL UNIQUE,   -- identity from SSO provider
  provider   TEXT NOT NULL,          -- "google" | "github" | "microsoft"
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  created_at TEXT NOT NULL
)

projects (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  owner_id   TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)

project_members (
  project_id TEXT NOT NULL REFERENCES projects(id),
  user_id    TEXT NOT NULL REFERENCES users(id),
  role       TEXT NOT NULL,          -- "owner" | "editor" | "viewer"
  PRIMARY KEY (project_id, user_id)
)

files (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id),
  name        TEXT NOT NULL,
  r2_key      TEXT NOT NULL,
  type        TEXT NOT NULL,         -- "tex" | "bib" | "image" | "pdf"
  size        INTEGER,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT NOT NULL REFERENCES users(id)
)
```

No hay historial de compilaciones. El PDF de salida se sobreescribe en R2 cada vez que el usuario lo solicita explícitamente.

### R2 — Estructura de claves

```
projects/{project_id}/tex/{filename}.tex
projects/{project_id}/bib/{filename}.bib
projects/{project_id}/assets/{filename}     # imágenes y otros recursos
projects/{project_id}/output.pdf            # último PDF compilado (sobreescribe)
```

### Durable Objects — Edición concurrente

Un Durable Object por proyecto activo:
- Mantiene conexiones WebSocket con todos los editores del proyecto
- Gestiona presencia (quién está editando)
- Coordina y serializa cambios para evitar conflictos

### Daemon — Contrato de la API

El frontend recopila todos los archivos del proyecto desde R2 y los envía al daemon local en un solo request:

```
POST http://localhost:{puerto}/compile
Content-Type: application/json

{
  "main": "<contenido completo del .tex principal>",
  "assets": {
    "figura.png": "<base64>",
    "logo.jpg":   "<base64>",
    "refs.bib":   "<contenido texto plano>",
    "extra.tex":  "<contenido texto plano>"
  }
}
```

Respuesta exitosa:

```
200 OK
Content-Type: application/pdf

<bytes del PDF>
```

Respuesta con error de compilación:

```
422 Unprocessable Entity
Content-Type: application/json

{
  "error": "compilation_failed",
  "log": "<salida completa del log de Tectonic>"
}
```

### Próximo paso acordado

Construir el **core Rust** mínimo:
1. Daemon con Axum exponiendo `POST /compile`
2. Tectonic embebido recibiendo bundle (`.tex` + `.bib` + imágenes en memoria)
3. Devolver PDF en bytes o log de error estructurado
4. WebSocket en el daemon para live reload (notifica cuando el PDF cambia)

---

## Environment Setup

### Prerequisites

- Rust toolchain (`rustup`): <https://rustup.rs/>
- Node.js ≥ 18 + npm (for Cloudflare Worker)
- Internet access on first run (Tectonic downloads the TeX bundle via HTTP Range Requests)

### Build & run

```bash
cd daemon

# Development
cargo run

# Production binary
cargo build --release
# → target/release/latex-daemon

# Override default port (7878)
PORT=9000 cargo run
```

### Tests

```bash
cd daemon

# Run all tests (unit + integration)
cargo test

# Run a specific test by name
cargo test looks_binary

# Show stdout from passing tests (useful for debugging)
cargo test -- --nocapture
```

#### Test inventory

| Test | What it covers |
|---|---|
| `binary_extensions_detected` | `looks_binary` returns `true` for image/PDF extensions |
| `text_extensions_not_binary` | `looks_binary` returns `false` for `.tex`, `.bib`, etc. |
| `binary_detection_is_case_insensitive` | Extension matching is case-insensitive |
| `compile_empty_body_returns_400` | Empty JSON body → HTTP 400 |
| `compile_invalid_json_returns_400` | Malformed JSON → HTTP 400 |
| `compile_missing_main_field_returns_400` | Missing `main` field → HTTP 400 |
| `compile_invalid_latex_returns_json_error` | Bad LaTeX → non-200 with `{ error, log }` JSON |
| `ws_receives_pdf_updated_after_broadcast` | WS client receives `{"event":"pdf_updated"}` after compile |
| `ws_closes_cleanly_when_client_disconnects` | Dropping client doesn't panic the server |

> The `compile_invalid_latex_returns_json_error` test is network-agnostic: it passes whether Tectonic
> can reach the bundle or not, because all error paths return the same JSON shape.

### Cloudflare Worker — setup & dev

```bash
cd cloudflare
npm install

# First-time cloud resource creation (run once)
npx wrangler d1 create latex-worker-db         # copy the database_id into wrangler.toml
npx wrangler r2 bucket create latex-worker-files

# Secrets (never commit values — set via Wrangler)
npx wrangler secret put CF_ACCESS_TEAM_DOMAIN  # e.g. myteam.cloudflareaccess.com
npx wrangler secret put CF_ACCESS_AUD          # Application Audience Tag from Access dashboard

# Apply D1 migrations
npm run db:migrate:local   # local dev DB
npm run db:migrate:remote  # production DB

# Local development (Worker + D1 + R2 emulated locally)
npm run dev

# Run tests (Vitest + @cloudflare/vitest-pool-workers via Miniflare)
npm test

# Deploy to Cloudflare
npm run deploy
```

#### Test inventory (Cloudflare Worker)

| File | What it covers |
|---|---|
| `test/storage.test.ts` | `fileTypeFromName`, `r2KeyForSourceFile`, `outputPdfKey`, `contentTypeFor` |
| `test/auth.test.ts` | `validateJwt`: malformed, expired, wrong audience, tampered sig, valid JWT, array aud |
| `test/db.test.ts` | D1 CRUD: upsertUser (idempotent), createProject, getMemberRole, getUserProjects, upsertFile (upsert), deleteFile |
| `test/api.test.ts` | HTTP routes via `SELF.fetch()`: auth guard, GET /api/me, POST/GET /api/projects, file CRUD, output.pdf store/retrieve |

Tests run inside the actual Cloudflare Workers runtime (Miniflare) — D1 and R2 are fully emulated, no mocks needed except the Cloudflare Access JWKS endpoint (`fetchMock`).

#### Cloudflare Worker API

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/me` | Current user (creates on first login) |
| `GET` | `/api/projects` | List user's projects |
| `POST` | `/api/projects` | Create project (`{ name }`) |
| `GET` | `/api/projects/:id` | Project detail + file list |
| `DELETE` | `/api/projects/:id` | Delete project (owner only) |
| `GET` | `/api/projects/:id/files` | List files |
| `PUT` | `/api/projects/:id/files/:name` | Upload a source file |
| `GET` | `/api/projects/:id/files/:name` | Download a source file |
| `DELETE` | `/api/projects/:id/files/:name` | Delete a source file |
| `PUT` | `/api/projects/:id/output.pdf` | Store compiled PDF (triggers WS broadcast) |
| `GET` | `/api/projects/:id/output.pdf` | Get latest compiled PDF |
| `GET` | `/api/projects/:id/ws` | WebSocket — receives `{"event":"pdf_updated"}` |

All routes require `Cf-Access-Jwt-Assertion` header (injected automatically by Cloudflare Access).

#### Environment variables (Worker)

| Variable | Where to set | Description |
|---|---|---|
| `CF_ACCESS_TEAM_DOMAIN` | `wrangler secret put` | e.g. `myteam.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | `wrangler secret put` | Audience Tag from the Access application |

### Frontend — setup & dev

```bash
cd frontend
npm install

# Copy and edit env vars
cp .env.example .env

# Local dev (requires wrangler dev running in another terminal for /api)
npm run dev
# → http://localhost:5173

# Production build (output in dist/)
npm run build
```

#### Environment variables (Frontend)

| Variable | Default | Description |
|---|---|---|
| `VITE_WORKER_URL` | `""` (same origin) | Base URL of the Cloudflare Worker. In dev: `http://localhost:8787` |
| `VITE_DAEMON_URL` | `http://localhost:7878` | URL of the local Rust daemon |

In production (Cloudflare Pages), both the frontend and Worker share the same domain so `VITE_WORKER_URL` can be left empty.

#### Frontend tech stack

| Library | Version | Purpose |
|---|---|---|
| React | 18 | UI framework |
| Vite | 5 | Bundler + dev server |
| CodeMirror 6 | 6 | LaTeX editor with custom syntax |
| pdfjs-dist | 4 | Multi-page PDF renderer |
| react-resizable-panels | 2 | Resizable 3-panel layout |
| Yjs | 13 | CRDT for real-time collaboration |
| y-codemirror.next | 0.3 | CodeMirror ↔ Yjs binding |
| y-protocols | 1 | Awareness (cursor sharing) |

#### Collaboration architecture

The frontend uses Yjs for real-time collaborative editing:

```
[Browser A]  ←→  WebSocket  ←→  [Durable Object]  ←→  WebSocket  ←→  [Browser B]
  Y.Doc                           (binary relay)                          Y.Doc
```

- Binary WebSocket messages = Yjs CRDT updates (document sync)
- Text WebSocket messages = JSON notifications (`{"event":"pdf_updated"}`)
- The Durable Object relays both types transparently
- Late joiners load the base document from R2, then receive incremental Yjs updates

#### Compilation flow

```
1. Frontend fetches all project files from R2 (via Worker API)
2. POST { main, assets } → http://localhost:7878/compile (local daemon)
3. Daemon compiles with Tectonic → returns PDF bytes (200) or { error, log } (422)
4. Frontend PUT PDF bytes → Worker /api/projects/:id/output.pdf
5. Worker broadcasts {"event":"pdf_updated"} to all WebSocket clients
6. All PDF viewers reload
```

---

## Notes

- The repository name contains a deliberate typo ("Expriment" instead of "Experiment") — preserve this as the canonical name
- This is explicitly an **experiment** — expect rapid iteration and potential architectural pivots
