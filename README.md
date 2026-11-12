# GridTube

A modern, self-hosted Single Page Application (SPA) for streaming up to four YouTube live feeds simultaneously in a full-viewport 2×2 grid with zero wasted screen space.

## Features

- **100% Viewport 2×2 Video Wall**: In grid view, the four stream panes occupy `100% × 100dvh` with an auto-hiding floating HUD pill that disappears after mouse inactivity.
- **Partial Grid Support**: Any of the 4 feed URLs can be left blank; unconfigured slots render a clean empty box with a one-click button to add a feed URL later.
- **Persistent Volume Storage**: Saved grids are stored as JSON in `DATA_DIR` (`/data/grids.json` by default in Docker/Kubernetes), ready for a local Docker volume bind mount or Kubernetes `PersistentVolumeClaim`.
- **Pre-seeded Example**: Automatically seeds the `choo-choos` railroad crossing grid on first start if `grids.json` does not exist yet.

## Quick Start

### 1. Local Node.js

```bash
node server.js
# Open http://localhost:8080
```

### 2. Docker & Docker Compose

```bash
# Build and start with a local ./data volume mounted to /data
docker compose up -d --build

# Or with docker run:
docker build -t gridtube:latest .
docker run -d --name gridtube -p 8080:8080 -v "$(pwd)/data:/data" gridtube:latest
```

### 3. Kubernetes (with PVC)

```bash
kubectl apply -f k8s.yaml
kubectl port-forward svc/gridtube 8080:80
```
