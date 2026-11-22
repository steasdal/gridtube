# GridTube

A self-hosted TypeScript web application built with **SvelteKit** and **Drizzle ORM** for streaming up to four YouTube live feeds simultaneously in a full-viewport 2×2 grid.

## Features

- **100% Viewport 2×2 Video Wall**: In grid view, the four stream panes occupy `100% × 100%` of the viewport with a tucked top-left `Menu ▾` drawer that stays clear of YouTube's built-in controls (plus `f` key fullscreen toggle and iPadOS/iOS mobile support).
- **Per-Feed Audio & Live Persistence**: Configure Mute/Unmute and `0–100%` volume per pane in the Add/Edit dialog, applied via the YouTube IFrame API; desktop player volume and mute adjustments automatically save back to the grid configuration.
- **Partial Grid Support**: Any of the 4 feed slots can be left blank and configured later directly from the empty pane.
- **Role-Based Authentication & Private Grids**: Cookie- and Bearer-backed token sessions (`HttpOnly`, 7-day sliding expiration), strict per-user grid privacy, self-service `/profile` updates, and admin-only `/admin` user management.
- **Public Read-Only Grids**: Admins can publish selected grids to the logged-out landing page gallery so visitors can open `/grid/[id]` read-only without signing in (without persisting player audio changes).
- **PostgreSQL + Embedded PGlite Storage**: Uses external PostgreSQL when `DATABASE_URL` is provided, or embedded **`PGlite`** persisted inside `DATA_DIR` (`/data/pgdata`) with zero external database setup required.
- **Automatic Startup Migrations & Legacy Import**: Runs Drizzle SQL migrations (`./drizzle`) automatically when the server boots (serialized across PostgreSQL replicas via `pg_advisory_lock`), imports existing `$DATA_DIR/grids.json` data on first upgrade if present, and otherwise seeds the example `choo-choos` grid.
- **Production Observability & Security**: Single-line JSON structured logging to `stdout`/`stderr`, optional internal Prometheus `/metrics` listener, nonce-based Content Security Policy (CSP), HTTP security headers, and per-IP/per-username login rate limiting.

---

## Local Development & Quick Start

### Prerequisites

- **Node.js >= 20** (and npm; container builds and CI target **Node 24**)
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

The production image ([Dockerfile](Dockerfile)) runs as non-root `node` (`UID 1000`), includes a built-in `HEALTHCHECK` against `/api/health`, and supports running with a **read-only root filesystem** (`readOnlyRootFilesystem: true`) when backed by external PostgreSQL.

---

## Authentication, Public Grids & Initial Admin Password

GridTube uses token-based authentication persisted in PostgreSQL/PGlite (`user_sessions`) via a 7-day sliding `HttpOnly` cookie (`gridtube_session`) or `Authorization: Bearer <token>`:

- **First-Time Bootstrap**: When the server starts with an empty `users` table, it automatically creates an `admin` account with a randomly generated password and assigns any pre-existing grids to it.
- **Finding the Initial Password**: Look for the `GRIDTUBE INITIAL ADMIN ACCOUNT CREATED` banner in the container/server stdout logs on first boot:

  ```bash
  # Docker Compose
  docker compose logs gridtube | grep -A 6 "GRIDTUBE INITIAL ADMIN ACCOUNT CREATED"

  # Kubernetes (prod or dev)
  kubectl -n gridtube logs deploy/gridtube | grep -A 6 "GRIDTUBE INITIAL ADMIN ACCOUNT CREATED"
  ```

- **Profile (`/profile`)**: Any signed-in user can change their username or password (12-character minimum; existing password required). Password changes revoke all *other* active sessions for that user.
- **Administration (`/admin`)**: Admins can create, edit (username, role, optional password reset), and delete other users. Password resets or role changes atomically revoke the target user's sessions (and demoting an admin unpublishes their public grids).
- **Public Grids**: Admins can toggle any of their own grids between `private` and `public` (`PUT /api/grids/[id]/public`). Published grids appear on the logged-out `/` landing page and open read-only at `/grid/[id]`.

---

## Environment Variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` (`8080` in Docker/K8s) | HTTP port for the Node server |
| `DATA_DIR` | `./data` (`/data` in Docker/K8s) | Directory for embedded `PGlite` (`pgdata/`) and legacy `grids.json` import |
| `DATABASE_URL` | *Unset* | PostgreSQL connection string; when unset, embedded `PGlite` is used |
| `PG_POOL_MAX` | `10` | Maximum `pg` connection pool size per instance (`1`–`100`, PostgreSQL mode only) |
| `MIGRATIONS_DIR` | `./drizzle` | Path to Drizzle SQL migrations executed automatically on startup |
| `METRICS_PORT` | *Unset* | Optional internal HTTP port exposing Prometheus `/metrics` (disabled when unset) |
| `METRICS_HOST` | `0.0.0.0` | Bind address for the internal Prometheus `/metrics` listener |
| `METRICS_DB_CACHE_MS` | `10000` | Cache TTL (ms) for database-backed state gauges refreshed on `/metrics` scrapes |
| `LOG_LEVEL` | `info` | Structured JSON log level (`debug`, `info`, `warn`, `error`, `silent`) |
| `LOGIN_RATE_LIMIT_MAX_ATTEMPTS` | `10` | Max failed login attempts per IP or username within the rate-limit window |
| `LOGIN_RATE_LIMIT_WINDOW_MS` | `900000` | Sliding rate-limit window (ms) for failed login attempts (default: 15 minutes) |
| `PROTOCOL_HEADER` | *Unset* (`x-forwarded-proto` in Docker) | Reverse-proxy header read by `@sveltejs/adapter-node` for `Secure` cookies, HSTS, and CSRF origin checks |
| `HOST_HEADER` | *Unset* (`x-forwarded-host` in Docker) | Reverse-proxy host header read by `@sveltejs/adapter-node` |
| `PORT_HEADER` | *Unset* (`x-forwarded-port` in Docker) | Reverse-proxy port header read by `@sveltejs/adapter-node` |
| `ORIGIN` | *Unset* | Optional explicit public origin (e.g., `https://grid.example.com`) if your reverse proxy does not forward `x-forwarded-*` headers |
| `SHUTDOWN_TIMEOUT` | `30` | Seconds `@sveltejs/adapter-node` waits for in-flight HTTP requests to drain on `SIGTERM`/`SIGINT` |

---

## Observability: Logging & Metrics

### Structured JSON Logging (`src/lib/server/logger.ts`)

GridTube emits single-line JSON logs directly to standard streams (zero in-app log files or rotation):

- **Stream routing**: `debug` and `info` write to `stdout`; `warn` and `error` write to `stderr`.
- **Log format**: Every entry contains `ts` (ISO-8601), `level`, `msg`, and event-specific fields (with `Error` objects automatically serialized as `{ name, message, stack }`):
  ```json
  {"ts":"2026-11-22T03:28:53.939Z","level":"info","msg":"http.request","requestId":"a1b2c3d4","method":"GET","route":"/grid/[id]","path":"/grid/choo-choos","status":200,"durationMs":4.12,"userId":"...","username":"admin","ip":"203.0.113.10"}
  ```
- **Automatic HTTP logging (`src/hooks.server.ts`)**: Every request receives a short `requestId` (`event.locals.requestId`). Status `>= 500` logs at `error`, `4xx` at `warn`, and `2xx`/`3xx` at `info`—except `/api/health` and `/_app/*` static assets, which are downgraded to `debug` so health probes do not clutter `info` logs.
- **Client IP attribution**: `getClientIp()` resolves the client address in priority order: `CF-Connecting-IP` (preferred so clients behind Cloudflare cannot spoof `X-Forwarded-For`) → first entry of `X-Forwarded-For` → `X-Real-IP` → socket address.
- **Event naming conventions**:
  - Lifecycle: `db.ready`, `db.closed`, `db.bootstrap_lock.{acquired,released}`, `metrics.server.{listening,closed}`, `server.shutdown.{started,completed}`
  - Audit: `auth.login.{succeeded,failed,rate_limited}`, `auth.logout`, `profile.updated`, `grid.{created,deleted,visibility.updated}`, `admin.user.{created,updated,deleted}`
  - Errors: `http.request.unhandled`, `http.server_error`, `api.*.failed`
- **Local debugging**: Set `LOG_LEVEL=debug` (e.g., `LOG_LEVEL=debug npm run dev`) to inspect health checks, advisory lock acquisition, and static asset requests.

### Prometheus Metrics (`src/lib/server/metrics.ts`)

Metrics are served from a **separate internal HTTP server** so `/metrics` is never exposed on the public web port (`8080`):

```bash
# Enable locally on port 9090 and inspect the scrape output
METRICS_PORT=9090 npm run dev
curl -s http://127.0.0.1:9090/metrics | grep '^gridtube_'
```

Exported application metrics (alongside standard Node.js runtime metrics from `@prometheus-io/client`):

| Metric | Type | Labels | Description |
| :--- | :--- | :--- | :--- |
| `gridtube_build_info` | Gauge | `version`, `driver` | Build version and active DB driver (`postgres` / `pglite`) |
| `gridtube_http_requests_total` | Counter | `method`, `route`, `status_code` | Total HTTP requests handled |
| `gridtube_http_request_duration_seconds` | Histogram | `method`, `route`, `status_code` | Request latency buckets (`5ms`–`5s`) |
| `gridtube_http_requests_in_flight` | Gauge | — | Requests currently executing |
| `gridtube_auth_logins_total` | Counter | `result` | Login outcomes (`success`, `failure`, `rate_limited`) |
| `gridtube_auth_logouts_total` | Counter | — | Explicit logouts |
| `gridtube_auth_denied_total` | Counter | `route`, `status_code` | API `401` / `403` denials |
| `gridtube_grid_views_total` | Counter | `visibility` | Grid player views (`private`, `public`) |
| `gridtube_grid_mutations_total` | Counter | `action` | Grid writes (`create`, `update`, `delete`, `publish`, `unpublish`) |
| `gridtube_users_total` | Gauge | `role` | Registered users by role (`admin`, `user`) |
| `gridtube_sessions_active` | Gauge | — | Non-expired user sessions |
| `gridtube_grids_total` | Gauge | — | Total saved grids |
| `gridtube_public_grids_total` | Gauge | — | Admin-published public grids |
| `gridtube_db_up` | Gauge | — | Database reachability (`1` = up, `0` = down) |
| `gridtube_db_pool_connections` | Gauge | `state` | Postgres pool counts (`total`, `idle`, `waiting`) |

Database-backed gauges (`users`, `sessions`, `grids`, `public_grids`, `db_up`) are refreshed lazily on `/metrics` scrapes and cached for `METRICS_DB_CACHE_MS` (default `10s`) with in-flight deduplication.

---

## Security Hardening & Reverse-Proxy Notes

- **Content Security Policy (CSP)**: Configured in [vite.config.ts](vite.config.ts) with `mode: 'auto'` (per-request script nonces). `frame-src` explicitly allows `https://www.youtube.com` and `https://www.youtube-nocookie.com`; `img-src` allows `'self'`, `data:`, and `https://i.ytimg.com`; `frame-ancestors` and `object-src` are `'none'`. If you add any external script, font, or embed source, update the CSP directives in `vite.config.ts`.
- **HTTP Security Headers**: Applied to every response in [src/hooks.server.ts](src/hooks.server.ts):
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains` (sent only when `x-forwarded-proto: https` is present or served directly over HTTPS on a non-loopback host)
- **Login Rate Limiting (`src/lib/server/rate-limit.ts`)**: Bounded (`10,000` key cap) sliding-window limiter tracking failed attempts by both client IP (`CF-Connecting-IP` preferred) and lowercase username. Exceeding `LOGIN_RATE_LIMIT_MAX_ATTEMPTS` within `LOGIN_RATE_LIMIT_WINDOW_MS` returns HTTP `429` with a `Retry-After` header; a successful login clears both buckets. Stored **in-memory per process**.
- **API & Auth Protections**: JSON bodies are capped at `64 KB` and API responses include `Cache-Control: no-store` ([src/lib/server/http.ts](src/lib/server/http.ts)); passwords are hashed with Node `crypto.scrypt` and compared with `crypto.timingSafeEqual`; `?next=` post-login redirects are sanitized to relative same-origin paths only.
- **Reverse-Proxy Headers**: The Docker image pre-sets `PROTOCOL_HEADER=x-forwarded-proto`, `HOST_HEADER=x-forwarded-host`, and `PORT_HEADER=x-forwarded-port`. Ensure your reverse proxy (Envoy, Nginx, Caddy, Traefik, Cloudflare Tunnel) forwards `X-Forwarded-Proto` and `X-Forwarded-Host` so `Secure` session cookies, HSTS, and SvelteKit CSRF origin validation work properly.

---

## REST API Reference

All `/api/*` endpoints return JSON with `Cache-Control: no-store`. Authenticated endpoints accept either the `gridtube_session` cookie or `Authorization: Bearer <token>`.

| Method & Path | Auth | Purpose |
| :--- | :--- | :--- |
| `GET /api/health` | Public | Database connectivity check (`status`, `driver`) |
| `GET /api/version` | Public | Application version metadata from `version.yml` |
| `POST /api/auth/login` | Public | Authenticate user, issue session cookie (`429` if rate-limited) |
| `POST /api/auth/logout` | User | Revoke current session and clear cookie |
| `GET /api/auth/me` | User | Return currently authenticated user |
| `GET /api/grids` | User | List signed-in user's grids |
| `POST /api/grids` | User | Create a new grid (`isPublic: true` requires Admin) |
| `GET /api/grids/[id]` | User | Fetch a specific grid owned by the signed-in user |
| `PUT /api/grids/[id]` | User | Update grid name, feed URLs/audio, and (if Admin) visibility |
| `DELETE /api/grids/[id]` | User | Delete an owned grid |
| `PUT /api/grids/[id]/public` | Admin | Toggle public visibility on an admin-owned grid |
| `PUT /api/profile` | User | Update own username and/or password (requires `currentPassword`) |
| `GET /api/users` | Admin | List all other user accounts |
| `POST /api/users` | Admin | Create a user account |
| `PUT /api/users/[id]` | Admin | Update another user's username, role, or password |
| `DELETE /api/users/[id]` | Admin | Delete another user (cascades their grids and sessions) |

---

## Architecture & Codebase Layout

GridTube is a **SvelteKit 3 / Svelte 5** TypeScript application compiled with `@sveltejs/adapter-node` into a standalone Node.js server (`build/index.js`). It uses **Drizzle ORM** over PostgreSQL (external `pg` or embedded `PGlite`) with zero separate frontend/backend build split—SSR page loaders, JSON API routes, and client components live in one codebase.

### Directory Layout

```text
.
├── drizzle/                        # Versioned Drizzle SQL migrations (0000..0003) & snapshots
├── src/
│   ├── app.html                    # Root HTML shell & base viewport meta
│   ├── app.css                     # Global dark theme, 2×2 player wall & safe-area styles
│   ├── hooks.server.ts             # Startup init, graceful shutdown, session lookup, security headers, metrics & HTTP logging
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
│       │   │   ├── index.ts        # Dual pg / PGlite driver setup, advisory-locked auto-migrate & shutdown
│       │   │   ├── grids-repo.ts   # Grid, slot URL & public-grid queries/mutations
│       │   │   └── users-repo.ts   # Transactional user CRUD, 23505 conflict handling & lookup queries
│       │   ├── auth.ts             # Cookie/Bearer token auth, sliding TTL & RBAC guards
│       │   ├── logger.ts           # Structured JSON logger to stdout/stderr (LOG_LEVEL) & client IP helper
│       │   ├── metrics.ts          # Prometheus registry (@prometheus-io/client) & METRICS_PORT server
│       │   ├── password.ts         # Node crypto.scrypt hashing & timing-safe verification
│       │   ├── rate-limit.ts       # Bounded sliding-window per-IP & per-username login rate limiter
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
├── vite.config.ts                  # Vite 8 + SvelteKit 3 config (@sveltejs/adapter-node & nonce CSP)
├── drizzle.config.ts               # Drizzle Kit config (schema -> ./drizzle)
├── Dockerfile                      # Multi-stage Node 24 non-root production container
├── docker-compose.yml              # Local gridtube + postgres stack
├── k8s.yaml                        # Standalone Kubernetes example manifest (embedded PGlite + PVC)
└── version.yml                     # Release version metadata stamped by CI
```

### How the App Works

#### 1. Startup, Dual Database Driver, Schema & Shutdown
On server startup, SvelteKit runs `init()` in `src/hooks.server.ts`, calling `initDatabase()`, `startMetricsServer()`, and registering the `sveltekit:shutdown` hook:
- **Driver selection**: Connects to external PostgreSQL via `pg` (`drizzle-orm/node-postgres`) if `DATABASE_URL` is set; otherwise opens an embedded `PGlite` database at `$DATA_DIR/pgdata` (`drizzle-orm/pglite`).
- **Auto-migrations & bootstrap**: Both drivers share the same Drizzle schema (`src/lib/server/db/schema.ts`) and automatically run pending SQL migrations from `./drizzle`. In PostgreSQL mode, migrations and initial bootstrap are serialized across concurrent replicas using a session-level `pg_advisory_lock` on a dedicated `PoolClient`. On a fresh database, the server generates an initial `admin` user (logging the one-time password to stdout), imports `$DATA_DIR/grids.json` if present, or seeds the default `choo-choos` grid.
- **Graceful shutdown**: When `@sveltejs/adapter-node` receives `SIGTERM` or `SIGINT`, it stops accepting new connections, drains in-flight HTTP requests (up to `SHUTDOWN_TIMEOUT`), and emits `sveltekit:shutdown`. GridTube's hook then closes the internal metrics server and calls `pool.end()` (PostgreSQL) or `pglite.close()` (PGlite) cleanly before exiting.

The schema consists of five tables in `src/lib/server/db/schema.ts`:
- `users` — user accounts (`username`, unique `username_lower`, `scrypt` `password_hash`, `role` of `'admin'` or `'user'`).
- `user_sessions` — active sessions storing SHA-256 `token_hash` values, `user_id` (cascade-deleted with the user), `expires_at`, and `last_seen_at`.
- `grids` — per-user grid records (`id`, `user_id`, `name`).
- `grid_urls` — four normalized feed slots (`slot` `0`–`3`, unique `(grid_id, slot)`) holding each pane's `url`, `volume` (`0`–`100`), and `muted` flag.
- `public_grids` — links admin-published grids so logged-out visitors can view them read-only on `/` and `/grid/[id]`.

#### 2. Request & Authentication Flow
Every HTTP request passes through `handle()` in `src/hooks.server.ts` → `resolveRequestSession()` (`src/lib/server/auth.ts`):
- Extracts a session token from `Authorization: Bearer <token>` or the `HttpOnly` `gridtube_session` cookie, hashes it with SHA-256, and joins `user_sessions` with `users`.
- Attaches `event.locals.user`, `event.locals.sessionId`, and `event.locals.requestId` for downstream page loaders and API endpoints.
- Slides the 7-day session expiration forward (at most once per 60 seconds) and automatically clears expired/unknown session cookies.
- Server route loaders (`+page.server.ts`) redirect unauthenticated requests (or serve read-only public grids where allowed), while API routes enforce access via `requireApiUser()` and `requireApiAdmin()`.
- Applies HTTP security headers, records Prometheus latency/status counters, and emits a structured `http.request` JSON log entry.

#### 3. 2×2 Video Wall, Live Audio Persistence & iOS Handling
- **Page orchestration (`src/routes/grid/[id]/+page.svelte`)**: Coordinates `StreamWall.svelte`, the top-left `PlayerHud.svelte` menu drawer, `GridFormModal.svelte`, fullscreen toggling (`f` shortcut), and `createPlayerViewportController()`.
- **Stable iframe rendering (`src/lib/components/StreamWall.svelte`)**: Builds `youtube.com/embed/...` URLs with `enablejsapi=1` (`src/lib/youtube.ts`) and pins each pane's iframe `src` by `(grid.id, videoId)` so changing volume or mute state never reloads a live stream.
- **Bidirectional YouTube audio sync (`src/lib/client/youtube-audio.ts`)**: Communicates with each iframe over `window.postMessage`. Once a player signals ready/playing, saved volume and mute preferences are pushed via `setVolume`/`mute`/`unMute`. On desktop, subsequent user adjustments inside YouTube's controls emit `infoDelivery` events that trigger debounced (`350ms`) `PUT /api/grids/:id` saves (flushed with `keepalive: true` on navigation, with a `900ms` echo-suppression window to avoid feedback loops).
- **Mobile & iOS adaptations (`src/lib/client/ipad-viewport.ts`, `StreamWall.svelte`)**: iOS devices start muted for autoplay compliance and render per-pane touch mute/unmute overlays (unmuting one pane mutes the others). `createPlayerViewportController()` adjusts viewport metadata (omitting `viewport-fit=cover` on iOS player views and tracking `visualViewport` bounds) so Dynamic Island safe areas and Safari toolbars do not shift or clip the grid.

#### 4. Scaling & Multi-Replica Behavior
- **External PostgreSQL mode**: Safe to scale horizontally (`replicas: 2+`) behind a load balancer without sticky sessions—sessions live in PostgreSQL, grid/user mutations are transactional, startup migrations are serialized via `pg_advisory_lock`, and `PG_POOL_MAX` caps per-pod connections. Note that login rate-limiting buckets remain in-memory per replica, so effective brute-force ceilings scale linearly with replica count (`N × LOGIN_RATE_LIMIT_MAX_ATTEMPTS`).
- **Embedded `PGlite` mode**: Intended for single-instance local dev or simple single-container deployments only (file-backed storage cannot be shared across multiple pods).

#### 5. Adding a Change & Running Tests
- **Schema changes**: Edit `src/lib/server/db/schema.ts`, run `npm run db:generate` to emit a new SQL file in `drizzle/`, and commit both the SQL file and `drizzle/meta/*`.
- **Testing**: `test/smoke.test.js` spawns the compiled `build/index.js` server against isolated temporary `PGlite` directories using Node's built-in `node:test` runner—covering auth/RBAC, grid CRUD, public grids, legacy `grids.json` import, multi-version migrations, sliding sessions, Prometheus `/metrics`, structured JSON logs, login rate limiting, security headers, and `SIGTERM` graceful shutdown. Always run `npm run build` before `npm test` after modifying `src/`.

---

## 12-Factor App Assessment

GridTube is designed closely around the [Twelve-Factor App](https://12factor.net/) methodology, with two intentional homelab-friendly tradeoffs (in-memory rate limiting and automatic startup migrations):

| # | Factor | Verdict | Notes |
| :- | :--- | :--- | :--- |
| **I** | **Codebase** | ✅ Pass | One Git repo (`steasdal/gridtube`), deployed to both `dev` and `prod` via GitOps. |
| **II** | **Dependencies** | ✅ Pass | Explicit `package.json` + locked `package-lock.json`, deterministic `npm ci` + `npm prune --omit=dev` in a self-contained container. |
| **III** | **Config** | ✅ Pass | Strictly env-driven (`DATABASE_URL`, `PG_POOL_MAX`, `PORT`, `METRICS_PORT`, `LOG_LEVEL`, `LOGIN_RATE_LIMIT_*`, proxy headers) — zero env config baked into the image. |
| **IV** | **Backing Services** | ✅ Pass | External PostgreSQL is treated as an attached resource swapped purely via `DATABASE_URL` (with `PGlite` as a zero-setup local fallback). |
| **V** | **Build, Release, Run** | ✅ Pass | Immutable multi-arch image built in CI, tagged in GHCR, and paired with env-specific secrets/config at runtime by Flux. |
| **VI** | **Processes** | 🟡 Mostly | Stateless web tier (sessions in Postgres, `readOnlyRootFilesystem: true`). Tradeoff: login rate limiter (`src/lib/server/rate-limit.ts`) keeps sliding-window buckets in process memory rather than requiring a shared Redis dependency. |
| **VII** | **Port Binding** | ✅ Pass | Self-contained Node server (`@sveltejs/adapter-node`) exporting `PORT` (`8080`) + optional internal `METRICS_PORT` (`9090`). |
| **VIII** | **Concurrency** | ✅ Pass | Horizontally scalable via process replicas (`pg_advisory_lock`, transactional writes, K8s `topologySpreadConstraints` + `PodDisruptionBudget`). |
| **IX** | **Disposability** | ✅ Pass | Fast startup, `@sveltejs/adapter-node` drains in-flight HTTP requests on `SIGTERM`/`SIGINT`, and `sveltekit:shutdown` cleanly closes the metrics listener and PostgreSQL pool / PGlite handle. |
| **X** | **Dev/Prod Parity** | 🟡 Mostly | Same image & Drizzle schema everywhere, and `docker-compose.yml` supports local Postgres. Tradeoff: default `npm run dev` and `test/smoke.test.js` use embedded `PGlite` for zero-setup speed, so Postgres-only code paths (`pg_advisory_lock`, `pg.Pool`) are exercised in `dev`/`prod` rather than the local smoke suite. |
| **XI** | **Logs** | ✅ Pass | Textbook event stream: single-line JSON to `stdout`/`stderr` (`src/lib/server/logger.ts`), zero in-app log files, shipped out-of-band by `victoria-logs-collector`. |
| **XII** | **Admin Processes** | 🟡 Pragmatic | Migrations and initial admin bootstrap run automatically on app startup (`hooks.server.ts`) instead of as a separate one-off K8s `Job`/CLI. Strictly speaking Factor XII separates them, though with `pg_advisory_lock` auto-migration is a deliberate zero-ops tradeoff for a self-hosted app. |

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
   git add package.json package-lock.json && git commit -m "chore(release): <version>"
   git flow release finish <version> -m "Release <version>"
   git push origin main develop <version>
   ```
