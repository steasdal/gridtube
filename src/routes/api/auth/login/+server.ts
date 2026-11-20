import type { RequestHandler } from './$types';
import { createSession, setSessionCookie } from '$lib/server/auth';
import { authenticateUser } from '$lib/server/db/users-repo';
import { jsonNoStore, readJsonBody } from '$lib/server/http';
import { getClientIp, logger } from '$lib/server/logger';
import { recordLoginAttempt } from '$lib/server/metrics';
import {
  checkLoginRateLimit,
  clearLoginRateLimit,
  recordFailedLoginAttempt
} from '$lib/server/rate-limit';

export const POST: RequestHandler = async ({ cookies, getClientAddress, locals, request, url }) => {
  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid JSON payload';
    return jsonNoStore({ error: message }, 400);
  }

  const payload = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const username = typeof payload.username === 'string' ? payload.username.trim() : '';
  const password = typeof payload.password === 'string' ? payload.password : '';

  if (!username || !password) {
    return jsonNoStore({ error: 'Username and password are required.' }, 400);
  }

  let clientIp = getClientIp(request);
  if (!clientIp) {
    try {
      clientIp = getClientAddress();
    } catch {
      clientIp = undefined;
    }
  }

  const rateLimit = checkLoginRateLimit(clientIp, username);
  if (!rateLimit.allowed) {
    recordLoginAttempt('rate_limited');
    logger.warn('auth.login.rate_limited', {
      requestId: locals.requestId,
      username,
      ip: clientIp,
      scope: rateLimit.scope,
      retryAfterSeconds: rateLimit.retryAfterSeconds
    });
    const res = jsonNoStore(
      { error: 'Too many failed login attempts. Please wait and try again.' },
      429
    );
    res.headers.set('Retry-After', String(rateLimit.retryAfterSeconds));
    return res;
  }

  try {
    const user = await authenticateUser(username, password);
    if (!user) {
      recordFailedLoginAttempt(clientIp, username);
      recordLoginAttempt('failure');
      logger.warn('auth.login.failed', {
        requestId: locals.requestId,
        username,
        ip: clientIp
      });
      return jsonNoStore({ error: 'Invalid username or password.' }, 401);
    }

    clearLoginRateLimit(clientIp, username);
    const session = await createSession(user.id);
    setSessionCookie(cookies, session.token, request, url);
    recordLoginAttempt('success');
    logger.info('auth.login.succeeded', {
      requestId: locals.requestId,
      userId: user.id,
      username: user.username,
      role: user.role,
      ip: clientIp
    });
    return jsonNoStore({ user, expiresAt: session.expiresAt });
  } catch (err) {
    logger.error('api.auth.login.failed', { requestId: locals.requestId, err });
    return jsonNoStore({ error: 'Internal server error' }, 500);
  }
};
