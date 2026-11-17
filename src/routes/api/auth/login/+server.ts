import type { RequestHandler } from './$types';
import { createSession, setSessionCookie } from '$lib/server/auth';
import { authenticateUser } from '$lib/server/db/users-repo';
import { jsonNoStore, readJsonBody } from '$lib/server/http';

export const POST: RequestHandler = async ({ cookies, request, url }) => {
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
      return jsonNoStore({ error: 'Invalid username or password.' }, 401);
    }

    const session = await createSession(user.id);
    setSessionCookie(cookies, session.token, request, url);
    return jsonNoStore({ user, expiresAt: session.expiresAt });
  } catch (err) {
    console.error('POST /api/auth/login failed:', err);
    return jsonNoStore({ error: 'Internal server error' }, 500);
  }
};
