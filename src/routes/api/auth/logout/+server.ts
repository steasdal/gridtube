import type { RequestHandler } from './$types';
import { clearSessionCookie, deleteSessionById } from '$lib/server/auth';
import { jsonNoStore } from '$lib/server/http';
import { logger } from '$lib/server/logger';
import { recordLogout } from '$lib/server/metrics';

export const POST: RequestHandler = async ({ cookies, locals, request, url }) => {
  try {
    if (locals.sessionId) {
      await deleteSessionById(locals.sessionId);
    }
    clearSessionCookie(cookies, request, url);
    recordLogout();
    logger.info('auth.logout', {
      requestId: locals.requestId,
      userId: locals.user?.id,
      username: locals.user?.username
    });
    return jsonNoStore({ ok: true });
  } catch (err) {
    logger.error('api.auth.logout.failed', { requestId: locals.requestId, err });
    return jsonNoStore({ error: 'Internal server error' }, 500);
  }
};
