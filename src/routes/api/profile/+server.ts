import type { RequestHandler } from './$types';
import { validatePassword, validateUsername } from '$lib/auth';
import { requireApiUser } from '$lib/server/auth';
import { updateOwnProfile } from '$lib/server/db/users-repo';
import { jsonNoStore, readJsonBody } from '$lib/server/http';
import { logger } from '$lib/server/logger';

export const PUT: RequestHandler = async ({ locals, request }) => {
  const auth = requireApiUser(locals);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid JSON payload';
    return jsonNoStore({ error: message }, 400);
  }

  const payload = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const hasUsername = payload.username !== undefined;
  const hasNewPassword = payload.newPassword !== undefined && payload.newPassword !== '';

  if (!hasUsername && !hasNewPassword) {
    return jsonNoStore({ error: 'Provide a new username or password to update.' }, 400);
  }

  let nextUsername: string | undefined;
  if (hasUsername) {
    const usernameCheck = validateUsername(payload.username);
    if (!usernameCheck.ok) {
      return jsonNoStore({ error: usernameCheck.error }, 400);
    }
    nextUsername = usernameCheck.username;
  }

  let nextPassword: string | undefined;
  let currentPassword: string | undefined;
  if (hasNewPassword) {
    currentPassword = typeof payload.currentPassword === 'string' ? payload.currentPassword : '';
    if (!currentPassword) {
      return jsonNoStore({ error: 'Current password is required.' }, 400);
    }
    const passwordCheck = validatePassword(payload.newPassword, 'New password');
    if (!passwordCheck.ok) {
      return jsonNoStore({ error: passwordCheck.error }, 400);
    }
    nextPassword = passwordCheck.password;
  }

  try {
    const result = await updateOwnProfile(auth.user.id, locals.sessionId, {
      username: nextUsername,
      currentPassword,
      newPassword: nextPassword
    });
    if (!result.ok) {
      return jsonNoStore({ error: result.error }, result.status);
    }
    logger.info('profile.updated', {
      requestId: locals.requestId,
      userId: auth.user.id,
      usernameChanged: Boolean(nextUsername && nextUsername !== auth.user.username),
      passwordChanged: Boolean(nextPassword)
    });
    return jsonNoStore({ user: result.data });
  } catch (err) {
    logger.error('api.profile.update.failed', { requestId: locals.requestId, userId: auth.user.id, err });
    return jsonNoStore({ error: 'Internal server error' }, 500);
  }
};
