import type { RequestHandler } from './$types';
import { validatePassword, validateUserRole, validateUsername } from '$lib/auth';
import { requireApiAdmin } from '$lib/server/auth';
import { createUser, listOtherUsers } from '$lib/server/db/users-repo';
import { jsonNoStore, readJsonBody } from '$lib/server/http';

export const GET: RequestHandler = async ({ locals }) => {
  const auth = requireApiAdmin(locals);
  if (!auth.ok) return auth.response;

  try {
    const otherUsers = await listOtherUsers(auth.user.id);
    return jsonNoStore({ users: otherUsers });
  } catch (err) {
    console.error('GET /api/users failed:', err);
    return jsonNoStore({ error: 'Internal server error' }, 500);
  }
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const auth = requireApiAdmin(locals);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid JSON payload';
    return jsonNoStore({ error: message }, 400);
  }

  const payload = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const usernameCheck = validateUsername(payload.username);
  if (!usernameCheck.ok) {
    return jsonNoStore({ error: usernameCheck.error }, 400);
  }

  const passwordCheck = validatePassword(payload.password, 'Password');
  if (!passwordCheck.ok) {
    return jsonNoStore({ error: passwordCheck.error }, 400);
  }

  const roleCheck = validateUserRole(payload.role ?? 'user');
  if (!roleCheck.ok) {
    return jsonNoStore({ error: roleCheck.error }, 400);
  }

  try {
    const result = await createUser(usernameCheck.username, passwordCheck.password, roleCheck.role);
    if (!result.ok) {
      return jsonNoStore({ error: result.error }, result.status);
    }
    return jsonNoStore({ user: result.data }, 201);
  } catch (err) {
    console.error('POST /api/users failed:', err);
    return jsonNoStore({ error: 'Internal server error' }, 500);
  }
};
