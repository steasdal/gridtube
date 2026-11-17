import type { RequestHandler } from './$types';
import { validatePassword, validateUserRole, validateUsername } from '$lib/auth';
import { requireApiAdmin } from '$lib/server/auth';
import { deleteManagedUser, updateManagedUser } from '$lib/server/db/users-repo';
import { jsonNoStore, readJsonBody } from '$lib/server/http';

export const PUT: RequestHandler = async ({ locals, params, request }) => {
  const auth = requireApiAdmin(locals);
  if (!auth.ok) return auth.response;

  const targetId = params.id?.trim();
  if (!targetId) {
    return jsonNoStore({ error: 'User ID is required.' }, 400);
  }
  if (targetId === auth.user.id) {
    return jsonNoStore({ error: 'Use Profile to update your own account.' }, 400);
  }

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

  const roleCheck = validateUserRole(payload.role);
  if (!roleCheck.ok) {
    return jsonNoStore({ error: roleCheck.error }, 400);
  }

  let nextPassword: string | undefined;
  if (typeof payload.password === 'string' && payload.password.length > 0) {
    const passwordCheck = validatePassword(payload.password, 'Password');
    if (!passwordCheck.ok) {
      return jsonNoStore({ error: passwordCheck.error }, 400);
    }
    nextPassword = passwordCheck.password;
  }

  try {
    const result = await updateManagedUser(targetId, {
      username: usernameCheck.username,
      role: roleCheck.role,
      password: nextPassword
    });
    if (!result.ok) {
      return jsonNoStore({ error: result.error }, result.status);
    }
    return jsonNoStore({ user: result.data });
  } catch (err) {
    console.error('PUT /api/users/:id failed:', err);
    return jsonNoStore({ error: 'Internal server error' }, 500);
  }
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  const auth = requireApiAdmin(locals);
  if (!auth.ok) return auth.response;

  const targetId = params.id?.trim();
  if (!targetId) {
    return jsonNoStore({ error: 'User ID is required.' }, 400);
  }
  if (targetId === auth.user.id) {
    return jsonNoStore({ error: 'You cannot delete your own account.' }, 400);
  }

  try {
    const deleted = await deleteManagedUser(targetId);
    if (!deleted) {
      return jsonNoStore({ error: 'User not found.' }, 404);
    }
    return jsonNoStore({ deleted: targetId });
  } catch (err) {
    console.error('DELETE /api/users/:id failed:', err);
    return jsonNoStore({ error: 'Internal server error' }, 500);
  }
};
