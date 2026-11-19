import type { RequestHandler } from './$types';
import { requireApiUser } from '$lib/server/auth';
import { deleteGrid, getGridById, updateGrid } from '$lib/server/db/grids-repo';
import { jsonNoStore, readJsonBody } from '$lib/server/http';
import { logger } from '$lib/server/logger';
import { recordGridMutation } from '$lib/server/metrics';
import { validateGridPayload } from '$lib/youtube';

export const GET: RequestHandler = async ({ locals, params }) => {
  const auth = requireApiUser(locals);
  if (!auth.ok) return auth.response;

  const id = params.id?.trim();
  if (!id) {
    return jsonNoStore({ error: 'Grid ID is required.' }, 400);
  }
  const grid = await getGridById(id, auth.user.id);
  if (!grid) {
    return jsonNoStore({ error: 'Grid not found.' }, 404);
  }
  return jsonNoStore(grid);
};

export const PUT: RequestHandler = async ({ locals, params, request }) => {
  const auth = requireApiUser(locals);
  if (!auth.ok) return auth.response;

  const id = params.id?.trim();
  if (!id) {
    return jsonNoStore({ error: 'Grid ID is required.' }, 400);
  }

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
  let isPublic: boolean | undefined;
  if (typeof rawBody.isPublic === 'boolean') {
    if (auth.user.role !== 'admin') {
      return jsonNoStore({ error: 'Only administrators can change public grid visibility.' }, 403);
    }
    isPublic = rawBody.isPublic;
  }

  try {
    const updated = await updateGrid(id, auth.user.id, validated.name, validated.feeds, isPublic);
    if (!updated) {
      return jsonNoStore({ error: 'Grid not found.' }, 404);
    }
    recordGridMutation('update');
    return jsonNoStore(updated);
  } catch (err) {
    logger.error('api.grids.update.failed', { requestId: locals.requestId, userId: auth.user.id, gridId: id, err });
    return jsonNoStore({ error: 'Internal server error' }, 500);
  }
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  const auth = requireApiUser(locals);
  if (!auth.ok) return auth.response;

  const id = params.id?.trim();
  if (!id) {
    return jsonNoStore({ error: 'Grid ID is required.' }, 400);
  }

  try {
    const deleted = await deleteGrid(id, auth.user.id);
    if (!deleted) {
      return jsonNoStore({ error: 'Grid not found.' }, 404);
    }
    recordGridMutation('delete');
    logger.info('grid.deleted', { requestId: locals.requestId, userId: auth.user.id, gridId: id });
    return jsonNoStore({ deleted: id });
  } catch (err) {
    logger.error('api.grids.delete.failed', { requestId: locals.requestId, userId: auth.user.id, gridId: id, err });
    return jsonNoStore({ error: 'Internal server error' }, 500);
  }
};
