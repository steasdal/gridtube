import type { RequestHandler } from './$types';
import { requireApiUser } from '$lib/server/auth';
import { createGrid, listGrids } from '$lib/server/db/grids-repo';
import { jsonNoStore, readJsonBody } from '$lib/server/http';
import { logger } from '$lib/server/logger';
import { recordGridMutation } from '$lib/server/metrics';
import { validateGridPayload } from '$lib/youtube';

export const GET: RequestHandler = async ({ locals }) => {
  const auth = requireApiUser(locals);
  if (!auth.ok) return auth.response;

  try {
    const allGrids = await listGrids(auth.user.id);
    return jsonNoStore(allGrids);
  } catch (err) {
    logger.error('api.grids.list.failed', { requestId: locals.requestId, userId: auth.user.id, err });
    return jsonNoStore({ error: 'Internal server error' }, 500);
  }
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const auth = requireApiUser(locals);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid JSON payload';
    return jsonNoStore({ error: message }, 400);
  }

  const validated = validateGridPayload(body);
  if (!validated.ok) {
    return jsonNoStore({ error: validated.error }, 400);
  }

  const rawBody = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const isPublic = rawBody.isPublic === true;
  if (isPublic && auth.user.role !== 'admin') {
    return jsonNoStore({ error: 'Only administrators can make grids public.' }, 403);
  }

  try {
    const created = await createGrid(auth.user.id, validated.name, validated.feeds, isPublic);
    recordGridMutation('create');
    if (isPublic) {
      recordGridMutation('publish');
    }
    logger.info('grid.created', {
      requestId: locals.requestId,
      userId: auth.user.id,
      gridId: created.id,
      isPublic
    });
    return jsonNoStore(created, 201);
  } catch (err) {
    logger.error('api.grids.create.failed', { requestId: locals.requestId, userId: auth.user.id, err });
    return jsonNoStore({ error: 'Internal server error' }, 500);
  }
};
