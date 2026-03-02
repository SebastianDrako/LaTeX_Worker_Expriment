<div align="center">

```
██╗      █████╗ ████████╗███████╗██╗  ██╗    ██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗██████╗
██║     ██╔══██╗╚══██╔══╝██╔════╝╚██╗██╔╝    ██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝██╔══██╗
██║     ███████║   ██║   █████╗   ╚███╔╝     ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ █████╗  ██████╔╝
██║     ██╔══██║   ██║   ██╔══╝   ██╔██╗     ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ██╔══╝  ██╔══██╗
███████╗██║  ██║   ██║   ███████╗██╔╝ ██╗    ╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████╗██║  ██║
╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═╝     ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝
```

**Self-hosted. Privacy-first. Permanently free.**

*Your documents compile on your machine. They never touch anyone else's server.*

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/Rust-1.75+-orange.svg)](https://rustup.rs/)
[![Node](https://img.shields.io/badge/Node-18+-brightgreen.svg)](https://nodejs.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Status](https://img.shields.io/badge/Status-Experiment-blueviolet.svg)]()

</div>

---

## Why does this exist?

### The Overleaf problem

Overleaf is great until you check the pricing page. The **free tier** caps you at one collaborator, no version history, and compiles that time out on larger documents. The **premium plan** runs $21/month (or more for teams) — for a document editor.

For students, researchers, and small teams that just need to write papers without worrying about hitting a paywall mid-deadline, that's not acceptable.

### The cloud trust problem

2025 and 2026 brought a wave of scrutiny over how US-based cloud AI and SaaS companies handle user data — especially in academic and government contexts. Contracts with intelligence agencies, training data clauses buried in ToS updates, subpoenas, and policy reversals made it clear: **if you don't control the infrastructure, you don't control your data.**

LaTeX documents often contain unpublished research, thesis drafts, grant proposals, and proprietary content. Sending those bytes to a third-party cloud for compilation is a trust assumption most users never consciously make.

**LaTeX Worker removes that assumption entirely.** Compilation runs on the user's own machine via a local Rust daemon. The cloud layer (Cloudflare) only stores metadata and files you explicitly upload — it never sees the compilation process.

### The philosophy

| | Overleaf | LaTeX Worker |
|---|---|---|
| Compilation | Their servers | **Your machine** |
| Cost | $21/month+ | **$0** (Cloudflare free tier) |
| Collaboration | Paid feature | **Included** (Durable Objects) |
| Offline compile | No | **Yes** (daemon is local) |
| Source code | Closed | **Open, MIT** |
| Data sovereignty | Their ToS | **Yours** |

---

## Architecture

LaTeX Worker is three independent components that compose cleanly:

```
┌─────────────────────────────────────────────────────────────────────┐
│                          USER'S BROWSER                             │
│                                                                     │
│  ┌──────────────┐  ┌─────────────────────┐  ┌───────────────────┐  │
│  │  File Tree   │  │  CodeMirror 6        │  │   PDF Viewer      │  │
│  │  (R2 files)  │  │  LaTeX + Yjs sync    │  │   (PDF.js)        │  │
│  └──────────────┘  └─────────────────────┘  └───────────────────┘  │
│         │                    │  △                      △            │
│         │ REST               │  │ Yjs CRDT             │ pdf_updated│
└─────────┼────────────────────┼──┼──────────────────────┼────────────┘
          │                    │  │                      │
          ▼                    ▼  │                      │
┌─────────────────────────────────────────────────────────────────────┐
│                      CLOUDFLARE EDGE                                │
│                                                                     │
│  ┌──────────────────────────────────┐  ┌───────────────────────┐   │
│  │        Worker (TypeScript)       │  │  Durable Object       │   │
│  │  ┌──────┐ ┌──────┐ ┌─────────┐  │  │  ProjectRoom          │   │
│  │  │ Auth │ │  D1  │ │   R2    │  │  │  - WebSocket relay    │   │
│  │  │ JWT  │ │ meta │ │  files  │  │  │  - binary (Yjs)       │   │
│  │  └──────┘ └──────┘ └─────────┘  │  │  - text (events)      │   │
│  └──────────────────────────────────┘  └───────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
          │
          │  POST /compile  { main: "...", assets: {...} }
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    USER'S MACHINE (daemon)                           │
│                                                                     │
│   Rust + Axum + Tectonic (embedded, no subprocess)                  │
│   localhost:7878                                                     │
│                                                                     │
│   POST /compile  →  Tectonic  →  PDF bytes  (or error log)          │
│   GET  /ws       →  live-reload WebSocket                           │
└─────────────────────────────────────────────────────────────────────┘
```

### Compilation flow (step by step)

```
1. User clicks Compile (or presses Ctrl+Enter)
2. Frontend fetches all project files from R2 via Worker API
3. Frontend POSTs { main, assets } to http://localhost:7878/compile
4. Daemon writes assets to a temporary directory. Tectonic then compiles the main document in-process (multi-pass + BibTeX), reading assets from the temp dir.
5. On success → daemon returns PDF bytes. The temp directory is cleaned up automatically.
6. Frontend PUTs the PDF to Worker → R2 (overwrites previous)
7. Worker calls ProjectRoom.broadcast({ event: "pdf_updated" })
8. All connected browsers reload their PDF viewer instantly
```

The document source **never leaves the user's machine** during steps 3–5. Only the final PDF is sent to Cloudflare.

---

## Modules

### `daemon/` — Rust compilation engine

The heart of the project. A lightweight Axum HTTP server that embeds [Tectonic](https://tectonic-typesetting.github.io/) as a Rust library.

| File | Role |
|---|---|
| `src/main.rs` | HTTP server, `/compile` handler, `/ws` WebSocket, Tectonic driver |

**Key design choices:**
- Tectonic runs **in-process** (no `pdflatex` subprocess). Faster and avoids PATH issues. It doesn't write intermediate files like `.aux` or `.log` to disk.
- Project assets are written to a temporary directory for each compile; this is cleaned up automatically.
- Tectonic handles multi-pass automatically (no `pdflatex → bibtex → pdflatex` dance).
- TeX bundle downloaded via HTTP Range Requests on first use — subsequent compiles are instant.
- Binary assets (images, PDFs) are sent as base64 in the JSON bundle; text files (`.tex`, `.bib`) as plain strings.

**API contract:**

```
POST /compile
Content-Type: application/json

{
  "main": "\\documentclass{article}\\begin{document}Hello\\end{document}",
  "assets": {
    "figure.png": "<base64>",
    "refs.bib":   "% bib content..."
  }
}

→ 200 OK + PDF bytes
→ 422 { "error": "compilation_failed", "log": "..." }
```

---

### `cloudflare/` — Edge API + storage

A Cloudflare Worker that handles auth, metadata, file storage, and real-time coordination — all on the free tier.

| Module | Role |
|---|---|
| `src/index.ts` | Router + auth middleware + all REST routes |
| `src/auth.ts` | Cloudflare Access JWT validation (RS256 + JWKS) |
| `src/db.ts` | D1 CRUD: users, projects, files |
| `src/storage.ts` | R2 key layout helpers |
| `src/do/ProjectRoom.ts` | Durable Object: WebSocket relay (Yjs binary + JSON events) |

**Services used (all on Cloudflare free tier):**

| Service | Purpose | Free limit |
|---|---|---|
| Workers | API runtime | 100k req/day |
| D1 | SQLite metadata | 5M rows |
| R2 | File & PDF storage | 10 GB |
| Durable Objects | WebSocket relay | 1M req/month |
| Access | SSO (Google/GitHub/Microsoft) | 50 users |

**Auth model:** [Cloudflare Access](https://www.cloudflare.com/zero-trust/products/access/) sits in front of the Worker. It validates identity and injects a signed JWT into every request. No email flows, no OAuth boilerplate — just configure your SSO provider in the Access dashboard.

---

### `frontend/` — React editor

An Overleaf-inspired browser editor. Deploys to Cloudflare Pages (static, zero cost).

| Module | Role |
|---|---|
| `src/App.tsx` | Auth guard + state-based routing |
| `src/api/client.ts` | Typed fetch wrapper for the Worker API |
| `src/hooks/useCompile.ts` | Full compile flow: R2 fetch → daemon → R2 upload |
| `src/hooks/usePdfReload.ts` | WebSocket listener for `pdf_updated` |
| `src/components/Editor/CodeEditor.tsx` | CodeMirror 6 + custom LaTeX syntax + Yjs |
| `src/components/Editor/PdfViewer.tsx` | PDF.js multi-page renderer |
| `src/components/Editor/FileTree.tsx` | File list with upload + delete |

**Editor tech:**
- **CodeMirror 6** with a custom `StreamLanguage` for LaTeX — no fragile third-party grammar packages.
- **Yjs** (CRDT) for conflict-free real-time collaboration. Updates flow as binary WebSocket messages through the Durable Object relay.
- **PDF.js** renders every page as a `<canvas>`. Auto-reloads when the Durable Object broadcasts `pdf_updated`.

---

## Getting started

### Prerequisites

| Tool | Version | Install |
|---|---|---|
| Rust + Cargo | stable | [rustup.rs](https://rustup.rs/) |
| Node.js | ≥ 18 | [nodejs.org](https://nodejs.org/) |
| Wrangler CLI | ≥ 3 | `npm i -g wrangler` |

### 1. Clone

```bash
git clone https://github.com/SebastianDrako/LaTeX_Worker_Expriment.git
cd LaTeX_Worker_Expriment
```

### 2. Start the daemon

```bash
cd daemon
cargo run          # first run downloads the TeX bundle (~500 MB, cached afterwards)
# → Listening on http://localhost:7878
```

> **First run takes a few minutes** while Tectonic fetches the TeX Live bundle from the internet. Subsequent starts are instant.
>
> **OpenSUSE Tumbleweed:** use `CXX=scripts/cxx_wrapper cargo run` — see [Step 5](#step-5--run-the-daemon) for details.

### 3. Start the Cloudflare Worker (local)

```bash
cd cloudflare
npm install
npm run db:migrate:local       # create the local D1 database
npm run dev
# → Worker at http://localhost:8787
```

### 4. Start the frontend

```bash
cd frontend
npm install
cp .env.example .env           # defaults are fine for local dev
npm run dev
# → http://localhost:5173
```

Open [http://localhost:5173](http://localhost:5173). Because Cloudflare Access is not active in local dev, you may need to mock the JWT or temporarily bypass auth — see [Local dev without Access](#local-dev-without-access) in the FAQ.

---

## Deploying to production

Deploying this project involves four main parts:
1.  **One-Time Setup:** Creating the necessary Cloudflare resources (D1, R2, Access).
2.  **Worker Deployment:** Publishing the backend API and database migrations.
3.  **Frontend Deployment:** Publishing the user interface and connecting it to the Worker.
4.  **Daemon Build:** Compiling the daemon binary for users to run locally.

### Step 1 — One-Time Cloudflare Setup

```bash
npx wrangler login

npx wrangler d1 create latex-worker-db       # note the database_id in the output
npx wrangler r2 bucket create latex-worker-files
```

After creating the D1 database, wrangler will output a `database_id`. You **must** add this to the worker's configuration file.
- Open `cloudflare/wrangler.toml`.
- Find the `[[d1_databases]]` section.
- Replace the placeholder `REPLACE_WITH_D1_DATABASE_ID` with the `database_id` you just received.

### Step 2 — Configure Cloudflare Access (SSO)

This is a manual step in the Cloudflare dashboard to protect your application.

1.  Go to the **Zero Trust** dashboard.
2.  Navigate to **Access → Applications** and add a new **Self-hosted** application.
3.  **Application Domain:** Set this to the final URL of your **frontend** (e.g., `https://latex-worker-frontend.pages.dev`). This is important for redirects to work correctly.
4.  Create at least one **policy** to allow users (e.g., based on their email address).
5.  Configure your desired **identity providers** (Google, GitHub, One-Time PIN, etc.).
6.  Once created, find and note two values from the application's page:
    *   **Application Audience (AUD) Tag**.
    *   Your **Team Domain** (from the URL, e.g., `my-team.cloudflareaccess.com`).

Then set them as encrypted Worker secrets (you'll be prompted to enter the values):

```bash
npx wrangler secret put CF_ACCESS_TEAM_DOMAIN
npx wrangler secret put CF_ACCESS_AUD
```

### Step 3 — Deploy the Worker

```bash
npm --prefix cloudflare/ run db:migrate:remote   # apply D1 migrations
npm --prefix cloudflare/ run deploy              # → https://latex-worker.<you>.workers.dev
```

### Step 4 — Deploy the Frontend & Connect to Worker

**Part A: Build and Deploy**

The repo includes `frontend/functions/api/[[path]].ts` — a Pages Function that proxies every `/api/*` and WebSocket request to your Worker via an internal Service Binding (no CORS, auth headers preserved, zero extra latency). Wrangler picks it up automatically.

```bash
# 1. Build the React application
npm --prefix frontend/ run build

# 2. Deploy to Cloudflare Pages — run from frontend/ so wrangler finds functions/
cd frontend
npx wrangler pages deploy dist --project-name latex-worker-frontend
cd ..
```

> `VITE_WORKER_URL` defaults to `""` (same origin) — no env var needed. Each user sets their own daemon URL; it cannot be configured globally.

**Part B: Configure the Service Binding**

After the first deploy, the Pages project exists in the dashboard. Tell Cloudflare what `LATEX_WORKER` refers to:

1.  Go to your **Pages project → Settings → Functions → Service Bindings**.
2.  Click **Add binding** and set:
    *   **Variable name:** `LATEX_WORKER`
    *   **Service:** Select your `latex-worker` from the dropdown.
3.  Redeploy for the binding to take effect.


### Step 5 — Run the Daemon

Users have two options: **Docker** (zero setup) or **native binary** (lower overhead).

---

#### Option A — Docker (recommended, any platform)

```bash
# Build the image once
docker build -t latex-daemon -f docker/linux/Dockerfile .

# Run — the TeX bundle is cached in a named volume so the first download
# only happens once even across container restarts
docker run -d \
  --name latex-daemon \
  -p 127.0.0.1:7878:7878 \
  -v tectonic-cache:/root/.cache/Tectonic \
  --restart unless-stopped \
  latex-daemon
```

> **First start** downloads the TeX Live bundle (~500 MB). Subsequent starts are instant.

To stop/remove: `docker stop latex-daemon && docker rm latex-daemon`

---

#### Option B — Native binary

Install the system dependencies for your platform, then build with Cargo:

**Debian / Ubuntu**
```bash
sudo apt-get install -y g++ pkg-config \
    libharfbuzz-dev libfreetype-dev libfontconfig-dev libssl-dev
cargo build --release --manifest-path daemon/Cargo.toml
```

**Arch Linux**
```bash
sudo pacman -S --needed base-devel harfbuzz freetype2 fontconfig openssl pkg-config
cargo build --release --manifest-path daemon/Cargo.toml
```

**OpenSUSE Tumbleweed**
```bash
sudo zypper install -y gcc-c++ pkg-config \
    harfbuzz-devel freetype-devel fontconfig-devel libopenssl-devel

# ICU 75+ headers require C++17 but tectonic requests C++14 — use the wrapper:
CXX=daemon/scripts/cxx_wrapper cargo build --release --manifest-path daemon/Cargo.toml
```

**Windows**
Native compilation on Windows requires a full MinGW-w64 toolchain. The easiest paths are:
- **WSL2** — use the Debian instructions above inside WSL2
- **Docker Desktop** — use Option A

The binary is at `daemon/target/release/latex-daemon` (or `.exe`). Install it as a system service with the scripts in `daemon/install/`:

```bash
# Linux — registers as a systemd service (requires root)
sudo bash daemon/install/install.sh

# Windows — registers as a Windows Service (run in elevated PowerShell)
# .\daemon\install\install.ps1
```

---

## FAQ

### Do I need to pay for anything?

No. The entire cloud stack runs within Cloudflare's **free tier**:
- Workers: 100,000 requests/day free
- D1: 5 million row reads/day free
- R2: 10 GB storage, 1 million operations/month free
- Durable Objects: 1 million requests/month free
- Pages: unlimited static requests free
- Access: up to 50 users free

The daemon runs on the user's own hardware — zero server cost for compilation.

### Does compilation require internet access?

Only on the **first run**, when Tectonic downloads the TeX Live bundle (~500 MB). After that, the bundle is cached locally and compilation is fully offline.

### Why a local daemon instead of compiling in the browser (WASM)?

Two reasons:

1. **Memory.** Cloudflare Workers cap at 128 MB RAM. A full TeX Live compilation easily exceeds that.
2. **Maintenance.** Browser WASM builds of TeX (SwiftLaTeX, etc.) lag years behind upstream and require a maintained fork. Tectonic in native Rust is actively developed and just works.

The tradeoff is that users install a small binary. Given that most LaTeX users already have TeX Live or MiKTeX installed, this is a familiar model — just a much smaller install.

### Can multiple people edit the same document at the same time?

Yes. The editor uses **Yjs** (a CRDT library) for conflict-free real-time collaboration. Changes from all editors are merged automatically — no "last write wins" conflicts. Cursor positions are shared via the awareness protocol.

The Cloudflare Durable Object acts as a WebSocket relay: it forwards Yjs binary updates between all connected browsers without interpreting them.

### What happens if two people compile at the same time?

The last PDF wins. Both compilations run locally on each user's daemon. Whichever one finishes last and successfully uploads to R2 becomes the current output. In practice this is fine for document editing — compilations take seconds and the PDF viewer auto-reloads for everyone.

### Is my LaTeX source sent to Cloudflare?

Your source files are stored in **R2** (Cloudflare's object storage) when you upload them or auto-save. The compilation itself happens on your local machine — Cloudflare never sees the compilation process.

If you want full air-gap privacy (no cloud storage at all), the daemon's `/compile` endpoint works standalone: you can POST to it directly from any client without the Cloudflare layer.

### Local dev without Access

Cloudflare Access injects the JWT automatically in production. In local dev (`wrangler dev`), you need to either:

**Option A — bypass auth in the Worker (dev only):**

Edit `cloudflare/src/index.ts` and replace the auth check with a hardcoded test user. Never commit this to main.

**Option B — generate a test JWT:**

```bash
# Install step CLI (https://smallstep.com/cli/)
step crypto jwt sign \
  --key <your-private-key> \
  --aud <your-aud> \
  --sub test@example.com \
  --exp +8h
```

Pass the token as the `Cf-Access-Jwt-Assertion` header.

### Why is the repo name misspelled?

`LaTeX_Worker_Expriment` — yes, "Expriment" is intentional. It's the canonical name. We preserve it.

### Can I self-host the sync layer too (no Cloudflare)?

The Worker and Durable Objects are designed to run on Cloudflare's infrastructure. However, the daemon is completely standalone and the architecture is simple enough to port:

- Replace D1 with any SQLite-compatible DB
- Replace R2 with any S3-compatible bucket
- Replace Durable Objects with a simple Node.js WebSocket server using `y-websocket`
- Replace Cloudflare Access with any JWT-based auth (Auth0, Keycloak, etc.)

PRs welcome.

---

## Contributing

This is an early-stage experiment. The best contributions right now are:

- **Bug reports** — open an issue with a minimal reproduction
- **Architecture feedback** — open a discussion
- **PRs** — keep them focused and atomic; one change per PR

Branch naming: `feature/<description>` or `fix/<description>`. PRs target `main`.

---

## License

MIT © 2026 Sebastian Guerrero Casadiegos

> *"Write once, compile anywhere."*
