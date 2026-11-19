# GridTube

A self-hosted TypeScript web application built with **SvelteKit** and **Drizzle ORM** for streaming up to four YouTube live feeds simultaneously in a full-viewport 2×2 grid.

## Features

- **100% Viewport 2×2 Video Wall**: In grid view, the four stream panes occupy `100% × 100%` of the viewport with a tucked top-left `Menu ▾` drawer that stays clear of YouTube's built-in controls (plus `f` key fullscreen toggle and iPadOS/iOS mobile support).
- **Per-Feed Audio & Live Persistence**: Configure Mute/Unmute and `0–100%` volume per pane in the Add/Edit dialog, applied via the YouTube IFrame API; desktop player volume and mute adjustments automatically save back to the grid configuration.
- **Partial Grid Support**: Any of the 4 feed slots can be left blank and configured later directly from the empty pane.
- **Role-Based Authentication & Private Grids**: Cookie-backed token sessions (`HttpOnly`, 7-day sliding expiration), strict per-user grid privacy, self-service `/profile` updates, and admin-only `/admin` user management.
- **PostgreSQL + Embedded PGlite Storage**: Uses external PostgreSQL when `DATABASE_URL` is provided, or embedded **`PGlite`** persisted inside `DATA_DIR` (`/data/pgdata`) with zero external database setup required.
- **Automatic Startup Migrations & Legacy Import**: Runs Drizzle SQL migrations (`./drizzle`) automatically when the server boots, imports existing `$DATA_DIR/grids.json` data on first upgrade if present, and otherwise seeds the example `choo-choos` grid.

---

## Local Development & Quick Start

### Prerequisites

- **Node.js >= 20** (and npm)
- Optional: **PostgreSQL** instance if you prefer external Postgres instead of embedded `PGlite`
- Optional: **Docker** for container builds

### 1. Run Locally with Embedded PGlite (Zero External DB Setup)

```bash
# Install dependencies
npm install

# Start SvelteKit dev server on http://localhost:8080
# Database migrations run automatically on startup into ./data/pgdata
npm run dev
```

Or run the compiled production Node server locally:

```bash
npm run build
PORT=8080 DATA_DIR=./data npm start
# Open http://localhost:8080
```

### 2. Run Locally Against PostgreSQL (via Docker Compose)

[docker-compose.yml](docker-compose.yml) includes a `postgres` service wired to `gridtube`. To develop locally with Vite against that Postgres container:

```bash
# Start only PostgreSQL on 127.0.0.1:5432
docker compose up -d postgres

# Connect the SvelteKit dev server to it (migrations run automatically on startup)
DATABASE_URL="postgres://gridtube:gridtube@127.0.0.1:5432/gridtube" npm run dev
```

### 3. Typecheck, Tests & Migrations

```bash
# Run svelte-check + TypeScript validation
npm run check

# Build production Node bundle and run the API + PGlite smoke suite
npm run build
npm test

# Generate new Drizzle SQL migrations after editing src/lib/server/db/schema.ts
npm run db:generate
```

### 4. Full Stack with Docker & Docker Compose (`gridtube` + `postgres`)

```bash
# Build and start both GridTube and PostgreSQL wired together
docker compose up --build -d

# Or pull and run the published develop/release image with PostgreSQL
IMAGE_TAG=develop docker compose up -d

# Or run standalone with docker run + embedded PGlite (no external Postgres)
docker run -d --name gridtube -p 8080:8080 -v "$(pwd)/data:/data" ghcr.io/steasdal/gridtube:latest
```

---

## Authentication & Initial Admin Password

GridTube uses token-based authentication persisted in PostgreSQL/PGlite (`user_sessions`) via a 7-day sliding `HttpOnly` cookie:

- **First-Time Bootstrap**: When the server starts with an empty `users` table, it automatically creates an `admin` account with a randomly generated password and assigns any pre-existing grids to it.
- **Finding the Initial Password**: Look for the `GRIDTUBE INITIAL ADMIN ACCOUNT CREATED` banner in the container/server stdout logs on first boot:

  ```bash
  # Docker Compose
  docker compose logs gridtube | grep -A 6 "GRIDTUBE INITIAL ADMIN ACCOUNT CREATED"

  # Kubernetes (prod or dev)
  kubectl -n gridtube logs deploy/gridtube | grep -A 6 "GRIDTUBE INITIAL ADMIN ACCOUNT CREATED"
  ```

- **Profile (`/profile`)**: Any signed-in user can change their username or password (12-character minimum; existing password required).
- **Administration (`/admin`)**: Admins can create, edit (username, role, optional password reset), and delete other users.

---

## Environment Variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` (`8080` in Docker/K8s) | HTTP port for the Node server |
| `DATA_DIR` | `./data` (`/data` in Docker/K8s) | Directory for embedded `PGlite` (`pgdata/`) and legacy `grids.json` import |
| `DATABASE_URL` | *Unset* | PostgreSQL connection string; when unset, embedded `PGlite` is used |
| `MIGRATIONS_DIR` | `./drizzle` | Path to Drizzle SQL migrations executed automatically on startup |

---

## Architecture & Codebase Layout

GridTube is a **SvelteKit 3 / Svelte 5** TypeScript application compiled with `@sveltejs/adapter-node` into a standalone Node.js server (`build/index.js`). It uses **Drizzle ORM** over PostgreSQL (external `pg` or embedded `PGlite`) with zero separate frontend build/backend split—SSR page loaders, JSON API routes, and client components live in one codebase.

### Directory Layout

```text
.
├── drizzle/                        # Versioned Drizzle SQL migrations (0000..0003) & snapshots
├── src/
│   ├── app.html                    # Root HTML shell & base viewport meta
│   ├── app.css                     # Global dark theme, 2×2 player wall & safe-area styles
│   ├── hooks.server.ts             # Server boot (initDatabase) + per-request session lookup
│   ├── routes/                     # SvelteKit file-based pages & JSON API endpoints
│   │   ├── +layout.server.ts       # Passes app version + authenticated user to all pages
│   │   ├── +page.{server.ts,svelte} # Dashboard (signed-in) or login + public grids (signed-out)
│   │   ├── grid/[id]/              # Full-viewport 2×2 player route (supports read-only public grids)
│   │   ├── profile/                # Self-service username & password management
│   │   ├── admin/                  # Admin-only user management UI
│   │   └── api/
│   │       ├── auth/{login,logout,me}/   # Session creation, revocation & current-user check
│   │       ├── grids/                    # GET/POST /api/grids, PUT/DELETE /api/grids/[id],
│   │       │                             # PUT /api/grids/[id]/public (admin publish toggle)
│   │       ├── profile/                  # PUT /api/profile
│   │       ├── users/                    # Admin CRUD: /api/users & /api/users/[id]
│   │       ├── health/                   # Unauthenticated DB driver health check
│   │       └── version/                  # Unauthenticated app version from version.yml
│   └── lib/
│       ├── types.ts                # Shared TypeScript interfaces (Grid, FeedEntry, AuthUser)
│       ├── youtube.ts              # Shared YouTube URL/ID parser, payload validator & embed URL builder
│       ├── auth.ts                 # Shared username/password validation & redirect sanitizer
│       ├── server/                 # Server-only modules (never bundled to the browser)
│       │   ├── db/
│       │   │   ├── schema.ts       # Drizzle PostgreSQL schema (5 tables)
│       │   │   ├── index.ts        # Dual pg / PGlite driver setup, auto-migrate & bootstrap
│       │   │   ├── grids-repo.ts   # Grid, slot URL & public-grid queries/mutations
│       │   │   └── users-repo.ts   # User CRUD & lookup queries
│       │   ├── auth.ts             # Cookie/Bearer token auth, sliding TTL & RBAC guards
│       │   ├── password.ts         # Node crypto.scrypt hashing & timing-safe verification
│       │   ├── http.ts             # Cache-Control: no-store JSON responses & 64 KB body cap
│       │   └── version.ts          # Reads version.yml at startup
│       ├── client/                 # Browser-only modules
│       │   ├── api.ts              # Typed fetch wrappers for /api/* endpoints
│       │   ├── youtube-audio.ts    # YouTube IFrame postMessage commands & audio diffing
│       │   ├── ipad-viewport.ts    # iOS/iPadOS platform detection, viewport & safe-area sync
│       │   └── dialog-helpers.ts   # Shared modal/dialog focus & close helpers
│       └── components/             # Svelte 5 UI components (StreamWall, PlayerHud, modals, cards)
├── test/
│   └── smoke.test.js               # End-to-end node:test suite against compiled build/index.js
├── drizzle.config.ts               # Drizzle Kit config (schema -> ./drizzle)
├── Dockerfile                      # Multi-stage Node production container
├── docker-compose.yml              # Local gridtube + postgres stack
└── version.yml                     # Release version metadata stamped by CI
```

### How the App Works

#### 1. Startup, Dual Database Driver & Schema
On server startup, SvelteKit runs `init()` in `src/hooks.server.ts`, calling `initDatabase()` in `src/lib/server/db/index.ts`:
- **Driver selection**: Connects to external PostgreSQL via `pg` (`drizzle-orm/node-postgres`) if `DATABASE_URL` is set; otherwise opens an embedded `PGlite` database at `$DATA_DIR/pgdata` (`drizzle-orm/pglite`).
- **Auto-migrations & bootstrap**: Both drivers share the same Drizzle schema (`src/lib/server/db/schema.ts`) and automatically run pending SQL migrations from `./drizzle`. On a fresh database, the server generates an initial `admin` user (logging the one-time password to stdout), imports `$DATA_DIR/grids.json` if present, or seeds the default `choo-choos` grid.

The schema consists of five tables in `src/lib/server/db/schema.ts`:
- `users` — user accounts (`username`, unique `username_lower`, `scrypt` `password_hash`, `role` of `'admin'` or `'user'`).
- `user_sessions` — active sessions storing SHA-256 `token_hash` values, `user_id` (cascade-deleted with the user), `expires_at`, and `last_seen_at`.
- `grids` — per-user grid records (`id`, `user_id`, `name`).
- `grid_urls` — four normalized feed slots (`slot` `0`–`3`, unique `(grid_id, slot)`) holding each pane's `url`, `volume` (`0`–`100`), and `muted` flag.
- `public_grids` — links admin-published grids so logged-out visitors can view them read-only on `/` and `/grid/[id]`.

#### 2. Request & Authentication Flow
Every HTTP request passes through `handle()` in `src/hooks.server.ts` → `resolveRequestSession()` (`src/lib/server/auth.ts`):
- Extracts a session token from `Authorization: Bearer <token>` or the `HttpOnly` `gridtube_session` cookie, hashes it with SHA-256, and joins `user_sessions` with `users`.
- Attaches `event.locals.user` and `event.locals.sessionId` for downstream page loaders and API endpoints.
- Slides the 7-day session expiration forward (at most once per 60 seconds) and automatically clears expired/unknown session cookies.
- Server route loaders (`+page.server.ts`) redirect unauthenticated requests (or serve read-only public grids where allowed), while API routes enforce access via `requireApiUser()` and `requireApiAdmin()`.

#### 3. 2×2 Video Wall, Live Audio Persistence & iOS Handling
- **Page orchestration (`src/routes/grid/[id]/+page.svelte`)**: Coordinates `StreamWall.svelte`, the top-left `PlayerHud.svelte` menu drawer, `GridFormModal.svelte`, fullscreen toggling (`f` shortcut), and `createPlayerViewportController()`.
- **Stable iframe rendering (`src/lib/components/StreamWall.svelte`)**: Builds `youtube.com/embed/...` URLs with `enablejsapi=1` (`src/lib/youtube.ts`) and pins each pane's iframe `src` by `(grid.id, videoId)` so changing volume or mute state never reloads a live stream.
- **Bidirectional YouTube audio sync (`src/lib/client/youtube-audio.ts`)**: Communicates with each iframe over `window.postMessage`. Once a player signals ready/playing, saved volume and mute preferences are pushed via `setVolume`/`mute`/`unMute`. On desktop, subsequent user adjustments inside YouTube's controls emit `infoDelivery` events that trigger debounced (`350ms`) `PUT /api/grids/:id` saves (flushed with `keepalive: true` on navigation, with a `900ms` echo-suppression window to avoid feedback loops).
- **Mobile & iOS adaptations (`src/lib/client/ipad-viewport.ts`, `StreamWall.svelte`)**: iOS devices start muted for autoplay compliance and render per-pane touch mute/unmute overlays (unmuting one pane mutes the others). `createPlayerViewportController()` adjusts viewport metadata (omitting `viewport-fit=cover` on iOS player views and tracking `visualViewport` bounds) so Dynamic Island safe areas and Safari toolbars do not shift or clip the grid.

#### 4. Adding a Change & Running Tests
- **Schema changes**: Edit `src/lib/server/db/schema.ts`, run `npm run db:generate` to emit a new SQL file in `drizzle/`, and commit both the SQL file and `drizzle/meta/*`.
- **Testing**: `test/smoke.test.js` spawns the compiled `build/index.js` server against isolated temporary `PGlite` directories using Node's built-in `node:test` runner (covering auth/RBAC, grid CRUD, public grids, legacy `grids.json` import, multi-version migrations, and sliding sessions). Always run `npm run build` before `npm test` after modifying `src/`.

---

## CI/CD Pipeline & GitOps Deployment

GridTube is self-hosted in my homelab on a highly available **Talos Linux Kubernetes cluster** running across three Proxmox VE servers—provisioned and bootstrapped with Terraform in [`steasdal/kubernetes-terraform`](https://github.com/steasdal/kubernetes-terraform). Both the dev (`grid-dev.teasdale.dev`) and production (`grid.teasdale.dev`) environments run on this cluster and are continuously reconciled by **Flux CD** from [`steasdal/gitops`](https://github.com/steasdal/gitops).

Releases follow a **Git-Flow** branching strategy paired with a multi-job GitHub Actions DAG ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) that validates changes, publishes multi-arch container images to GHCR, and automatically promotes image tags into the GitOps repository:

```mermaid
flowchart LR
    Checks["typecheck + docker-lint + smoke-test"] --> Build["docker-build-push\n(linux/amd64, linux/arm64)"]
    Build -->|"push to develop"| Dev["deploy-dev\ngrid-dev.teasdale.dev"]
    Build -->|"tag X.Y.Z / vX.Y.Z"| Prod["deploy-prod\ngrid.teasdale.dev"]
```

- **Pull Requests (`develop` / `main`)**: Runs `typecheck`, `docker-lint`, `smoke-test`, and verifies the multi-arch `docker-build-push` (`push: false`), skipping `deploy-dev` and `deploy-prod`.
- **Push to `develop`**: Pushes `:develop` and `:develop-<sha>` to GHCR and updates `apps/gridtube/dev/02-app.yaml` in `steasdal/gitops`.
- **Release Tag (`X.Y.Z` / `vX.Y.Z`)**: Stamps `version.yml`, pushes `:<version>` and `:latest` to GHCR, and updates `apps/gridtube/prod/02-app.yaml` in `steasdal/gitops`.

---

## Development & Release Workflow (`git-flow`)

1. **Feature work (`feature/*` → `develop`)**:
   ```bash
   git flow feature start <feature-name>
   git add . && git commit -m "feat: describe change"
   git push -u origin feature/<feature-name>
   gh pr create --base develop --head feature/<feature-name> --fill
   ```
2. **Release (`release/*` → `main` & `develop`)**:
   ```bash
   git fetch origin
   git checkout develop && git merge --ff-only origin/develop
   git checkout main && git merge --ff-only origin/main
   git flow release start <version>
   npm version --no-git-tag-version <version>
   git add package.json && git commit -m "chore(release): <version>"
   git flow release finish <version> -m "Release <version>"
   git push origin main develop <version>
   ```
