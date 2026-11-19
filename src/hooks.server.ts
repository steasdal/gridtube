import crypto from 'node:crypto';
import type { Handle, HandleServerError, ServerInit } from '@sveltejs/kit/hooks';
import { resolveRequestSession } from '$lib/server/auth';
import { initDatabase } from '$lib/server/db';
import { getClientIp, logger } from '$lib/server/logger';
import {
  decrementInFlightRequests,
  incrementInFlightRequests,
  recordAuthDenied,
  recordHttpRequest,
  setBuildInfo,
  startMetricsServer
} from '$lib/server/metrics';
import { APP_VERSION } from '$lib/server/version';

export const init: ServerInit = async () => {
  const ctx = await initDatabase();
  setBuildInfo(APP_VERSION, ctx.driver);
  startMetricsServer();
};

function getRouteLabel(routeId: string | null, pathname: string): string {
  if (routeId) return routeId;
  if (pathname.startsWith('/_app/')) return '/_app/*';
  return 'unmatched';
}

export const handle: Handle = async ({ event, resolve }) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  event.locals.requestId = requestId;

  const startNs = process.hrtime.bigint();
  incrementInFlightRequests();

  try {
    await resolveRequestSession(event);
    const response = await resolve(event);

    const durationSeconds = Number(process.hrtime.bigint() - startNs) / 1e9;
    const durationMs = Math.round(durationSeconds * 1000 * 100) / 100;
    const route = getRouteLabel(event.route.id, event.url.pathname);
    const status = response.status;

    recordHttpRequest(event.request.method, route, status, durationSeconds);

    if ((status === 401 || status === 403) && event.url.pathname.startsWith('/api/')) {
      recordAuthDenied(route, status);
    }

    const isQuietPath = event.url.pathname === '/api/health' || event.url.pathname.startsWith('/_app/');
    const logFields = {
      requestId,
      method: event.request.method,
      route,
      path: event.url.pathname,
      status,
      durationMs,
      userId: event.locals.user?.id,
      username: event.locals.user?.username,
      ip: getClientIp(event.request)
    };

    if (status >= 500) {
      logger.error('http.request', logFields);
    } else if (status >= 400) {
      logger.warn('http.request', logFields);
    } else if (isQuietPath) {
      logger.debug('http.request', logFields);
    } else {
      logger.info('http.request', logFields);
    }

    return response;
  } catch (err) {
    const durationSeconds = Number(process.hrtime.bigint() - startNs) / 1e9;
    const durationMs = Math.round(durationSeconds * 1000 * 100) / 100;
    const route = getRouteLabel(event.route.id, event.url.pathname);

    recordHttpRequest(event.request.method, route, 500, durationSeconds);
    logger.error('http.request.unhandled', {
      requestId,
      method: event.request.method,
      route,
      path: event.url.pathname,
      durationMs,
      userId: event.locals.user?.id,
      ip: getClientIp(event.request),
      err
    });
    throw err;
  } finally {
    decrementInFlightRequests();
  }
};

export const handleError: HandleServerError = ({ kind, error, event }) => {
  if (kind === 'unknown') {
    logger.error('http.server_error', {
      requestId: event.locals.requestId,
      method: event.request.method,
      route: getRouteLabel(event.route.id, event.url.pathname),
      path: event.url.pathname,
      kind,
      userId: event.locals.user?.id,
      err: error
    });
  }
};
