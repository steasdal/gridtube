import type { RequestHandler } from './$types';
import { clearSessionCookie, deleteSessionById } from '$lib/server/auth';
import { jsonNoStore } from '$lib/server/http';

export const POST: RequestHandler = async ({ cookies, locals, request, url }) => {
  try {
    if (locals.sessionId) {
      await deleteSessionById(locals.sessionId);
    }
    clearSessionCookie(cookies, request, url);
    return jsonNoStore({ ok: true });
  } catch (err) {
    console.error('POST /api/auth/logout failed:', err);
    return jsonNoStore({ error: 'Internal server error' }, 500);
  }
};
