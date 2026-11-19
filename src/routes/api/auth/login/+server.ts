import type { RequestHandler } from './$types';
import { createSession, setSessionCookie } from '$lib/server/auth';
import { authenticateUser } from '$lib/server/db/users-repo';
import { jsonNoStore, readJsonBody } from '$lib/server/http';
import { getClientIp, logger } from '$lib/server/logger';
import { recordLoginAttempt } from '$lib/server/metrics';

export const POST: RequestHandler = async ({ cookies, locals, request, url }) => {
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

  try {
    const user = await authenticateUser(username, password);
    if (!user) {
      recordLoginAttempt('failure');
      logger.warn('auth.login.failed', {
        requestId: locals.requestId,
        username,
        ip: getClientIp(request)
      });
      return jsonNoStore({ error: 'Invalid username or password.' }, 401);
    }

    const session = await createSession(user.id);
    setSessionCookie(cookies, session.token, request, url);
    recordLoginAttempt('success');
    logger.info('auth.login.succeeded', {
      requestId: locals.requestId,
      userId: user.id,
      username: user.username,
      role: user.role,
      ip: getClientIp(request)
    });
    return jsonNoStore({ user, expiresAt: session.expiresAt });
  } catch (err) {
    logger.error('api.auth.login.failed', { requestId: locals.requestId, err });
    return jsonNoStore({ error: 'Internal server error' }, 500);
  }
};
