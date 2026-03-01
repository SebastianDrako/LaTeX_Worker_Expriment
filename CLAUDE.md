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
├── LICENSE          # MIT License
└── CLAUDE.md        # This file
```

The repository is in its initial state. As the project grows, this structure will be updated to reflect new directories and files.

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

- Use standard LaTeX distributions (e.g., TeX Live, MiKTeX) as the compilation backend where applicable
- Support standard LaTeX engines: `pdflatex`, `xelatex`, `lualatex`
- Handle compilation errors gracefully and surface log output to the caller
- Clean up auxiliary files (`.aux`, `.log`, `.toc`, `.out`, etc.) after compilation unless explicitly asked to keep them
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
- Maneja multi-pass automáticamente
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
  tectonic = "0.14"       # motor LaTeX embebido
  axum = "0.7"            # HTTP local
  tokio                   # async runtime
  notify = "6"            # file watcher (live reload)

Frontend:
  Cloudflare Pages        # web app (React/Svelte/etc.)

Cloud (opcional, para sync/share):
  Cloudflare D1           # metadata y proyectos
  Cloudflare R2           # almacenamiento .tex y .pdf
```

### Opciones descartadas y por qué

| Opción | Motivo de descarte |
|---|---|
| VPS dedicado de compilación | Costo, complejidad de infra, no necesario |
| WASM en Cloudflare Worker | Límite de 128MB RAM, 30s CPU |
| WASM en browser (SwiftLaTeX) | Proyecto poco mantenido |
| WASM en browser (Tectonic) | Válido como fallback futuro, no como MVP |
| Tauri 2.0 | Sobreingeniería — es solo una WebView; Rust ya es multiplataforma y el browser real es suficiente como UI |

### Próximo paso acordado

Construir el **core Rust** mínimo:
1. Daemon con Axum exponiendo `POST /compile`
2. Tectonic embebido compilando `.tex` → `.pdf`
3. File watcher con WebSocket para live reload

---

## Environment Setup (Placeholder)

_To be filled in once the tech stack is decided._

```bash
# Build daemon
cargo build --release

# Run dev
cargo run
```

---

## Notes

- The repository name contains a deliberate typo ("Expriment" instead of "Experiment") — preserve this as the canonical name
- This is explicitly an **experiment** — expect rapid iteration and potential architectural pivots
