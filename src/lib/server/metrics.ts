import http from 'node:http';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from '@prometheus-io/client';
import { getDbMetricsSnapshot } from '$lib/server/db';
import { logger } from '$lib/server/logger';
import { APP_VERSION } from '$lib/server/version';

export const metricsRegistry = new Registry();

collectDefaultMetrics({
  register: metricsRegistry
});

const buildInfoGauge = new Gauge({
  name: 'gridtube_build_info',
  help: 'GridTube build and database driver metadata.',
  labelNames: ['version', 'driver'] as const,
  registers: [metricsRegistry]
});

const httpRequestsTotal = new Counter({
  name: 'gridtube_http_requests_total',
  help: 'Total HTTP requests handled by GridTube.',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [metricsRegistry]
});

const httpRequestDurationSeconds = new Histogram({
  name: 'gridtube_http_request_duration_seconds',
  help: 'HTTP request latency in seconds.',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [metricsRegistry]
});

const httpRequestsInFlight = new Gauge({
  name: 'gridtube_http_requests_in_flight',
  help: 'Number of HTTP requests currently being processed.',
  registers: [metricsRegistry]
});

const authLoginsTotal = new Counter({
  name: 'gridtube_auth_logins_total',
  help: 'Total login attempts partitioned by outcome.',
  labelNames: ['result'] as const,
  registers: [metricsRegistry]
});

const authLogoutsTotal = new Counter({
  name: 'gridtube_auth_logouts_total',
  help: 'Total explicit user logouts.',
  registers: [metricsRegistry]
});

const authDeniedTotal = new Counter({
  name: 'gridtube_auth_denied_total',
  help: 'Total unauthorized (401) or forbidden (403) API responses.',
  labelNames: ['route', 'status_code'] as const,
  registers: [metricsRegistry]
});

const gridViewsTotal = new Counter({
  name: 'gridtube_grid_views_total',
  help: 'Total grid player views partitioned by visibility.',
  labelNames: ['visibility'] as const,
  registers: [metricsRegistry]
});

const gridMutationsTotal = new Counter({
  name: 'gridtube_grid_mutations_total',
  help: 'Total grid write operations partitioned by action.',
  labelNames: ['action'] as const,
  registers: [metricsRegistry]
});

const usersTotalGauge = new Gauge({
  name: 'gridtube_users_total',
  help: 'Current number of registered GridTube users by role.',
  labelNames: ['role'] as const,
  registers: [metricsRegistry]
});

const activeSessionsGauge = new Gauge({
  name: 'gridtube_sessions_active',
  help: 'Current number of non-expired user sessions.',
  registers: [metricsRegistry]
});

const gridsTotalGauge = new Gauge({
  name: 'gridtube_grids_total',
  help: 'Current total number of saved grids.',
  registers: [metricsRegistry]
});

const publicGridsTotalGauge = new Gauge({
  name: 'gridtube_public_grids_total',
  help: 'Current number of admin-published public grids.',
  registers: [metricsRegistry]
});

const dbUpGauge = new Gauge({
  name: 'gridtube_db_up',
  help: 'Whether the GridTube database is reachable (1 = up, 0 = down).',
  registers: [metricsRegistry]
});

const dbPoolConnectionsGauge = new Gauge({
  name: 'gridtube_db_pool_connections',
  help: 'PostgreSQL connection pool counts by state (when using external Postgres).',
  labelNames: ['state'] as const,
  registers: [metricsRegistry]
});

export function setBuildInfo(version: string, driver: 'postgres' | 'pglite'): void {
  buildInfoGauge.reset();
  buildInfoGauge.set({ version, driver }, 1);
}

export function incrementInFlightRequests(): void {
  httpRequestsInFlight.inc();
}

export function decrementInFlightRequests(): void {
  httpRequestsInFlight.dec();
}

export function recordHttpRequest(
  method: string,
  route: string,
  statusCode: number,
  durationSeconds: number
): void {
  const labels = {
    method: method.toUpperCase(),
    route,
    status_code: String(statusCode)
  };
  httpRequestsTotal.inc(labels);
  httpRequestDurationSeconds.observe(labels, durationSeconds);
}

export function recordLoginAttempt(result: 'success' | 'failure'): void {
  authLoginsTotal.inc({ result });
}

export function recordLogout(): void {
  authLogoutsTotal.inc();
}

export function recordAuthDenied(route: string, statusCode: number): void {
  authDeniedTotal.inc({ route, status_code: String(statusCode) });
}

export function recordGridView(visibility: 'private' | 'public'): void {
  gridViewsTotal.inc({ visibility });
}

export function recordGridMutation(action: 'create' | 'update' | 'delete' | 'publish' | 'unpublish'): void {
  gridMutationsTotal.inc({ action });
}

const DEFAULT_DB_CACHE_MS = 10_000;
let lastDbRefreshAt = 0;
let inFlightDbRefresh: Promise<void> | null = null;

function getDbCacheMs(): number {
  const raw = process.env.METRICS_DB_CACHE_MS?.trim();
  if (!raw) return DEFAULT_DB_CACHE_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_DB_CACHE_MS;
}

async function refreshDatabaseGauges(): Promise<void> {
  const cacheMs = getDbCacheMs();
  const now = Date.now();
  if (cacheMs > 0 && now - lastDbRefreshAt < cacheMs) {
    return;
  }
  if (inFlightDbRefresh) {
    return inFlightDbRefresh;
  }

  inFlightDbRefresh = (async () => {
    try {
      const snapshot = await getDbMetricsSnapshot();
      setBuildInfo(APP_VERSION, snapshot.driver);
      dbUpGauge.set(snapshot.up ? 1 : 0);

      if (snapshot.counts) {
        usersTotalGauge.set({ role: 'admin' }, snapshot.counts.adminUsers);
        usersTotalGauge.set({ role: 'user' }, snapshot.counts.standardUsers);
        activeSessionsGauge.set(snapshot.counts.activeSessions);
        gridsTotalGauge.set(snapshot.counts.grids);
        publicGridsTotalGauge.set(snapshot.counts.publicGrids);
      }

      if (snapshot.pool) {
        dbPoolConnectionsGauge.set({ state: 'total' }, snapshot.pool.total);
        dbPoolConnectionsGauge.set({ state: 'idle' }, snapshot.pool.idle);
        dbPoolConnectionsGauge.set({ state: 'waiting' }, snapshot.pool.waiting);
      }
      lastDbRefreshAt = Date.now();
    } catch (err) {
      dbUpGauge.set(0);
      logger.error('metrics.refresh.failed', { err });
    } finally {
      inFlightDbRefresh = null;
    }
  })();

  return inFlightDbRefresh;
}

export async function renderMetrics(): Promise<string> {
  await refreshDatabaseGauges();
  return metricsRegistry.metrics();
}

let metricsServer: http.Server | null = null;

export function startMetricsServer(): void {
  if (metricsServer) return;

  const rawPort = process.env.METRICS_PORT?.trim();
  if (!rawPort) {
    logger.debug('metrics.server.disabled', { reason: 'METRICS_PORT not set' });
    return;
  }

  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    logger.error('metrics.server.invalid_port', { rawPort });
    return;
  }

  const host = process.env.METRICS_HOST?.trim() || '0.0.0.0';

  const server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url || '/', 'http://localhost');
    if (req.method !== 'GET' || reqUrl.pathname !== '/metrics') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found\n');
      return;
    }

    try {
      const body = await renderMetrics();
      res.writeHead(200, {
        'Content-Type': metricsRegistry.contentType,
        'Cache-Control': 'no-store'
      });
      res.end(body);
    } catch (err) {
      logger.error('metrics.scrape.failed', { err });
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Failed to collect metrics\n');
    }
  });

  server.on('error', (err) => {
    logger.error('metrics.server.error', { host, port, err });
  });

  server.listen(port, host, () => {
    logger.info('metrics.server.listening', { host, port, path: '/metrics' });
  });

  // Allow the main SvelteKit server to control process exit cleanly on SIGTERM/SIGINT.
  server.unref();
  metricsServer = server;
}
