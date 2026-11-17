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

## CI/CD Pipeline & GitOps Deployment

GridTube uses a **Git-Flow** branching strategy paired with a multi-job GitHub Actions DAG ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) and automated **Flux CD GitOps** image promotion into [`steasdal/gitops`](https://github.com/steasdal/gitops).

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
