import type { RequestHandler } from './$types';
import { requireApiAdmin } from '$lib/server/auth';
import { setGridPublic } from '$lib/server/db/grids-repo';
import { jsonNoStore, readJsonBody } from '$lib/server/http';
import { logger } from '$lib/server/logger';
import { recordGridMutation } from '$lib/server/metrics';

export const PUT: RequestHandler = async ({ locals, params, request }) => {
  const auth = requireApiAdmin(locals);
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

  const payload = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  if (typeof payload.isPublic !== 'boolean') {
    return jsonNoStore({ error: 'isPublic boolean is required.' }, 400);
  }

  try {
    const updated = await setGridPublic(id, auth.user.id, payload.isPublic);
    if (!updated) {
      return jsonNoStore({ error: 'Grid not found.' }, 404);
    }
    recordGridMutation(payload.isPublic ? 'publish' : 'unpublish');
    logger.info('grid.visibility.updated', {
      requestId: locals.requestId,
      userId: auth.user.id,
      gridId: id,
      isPublic: payload.isPublic
    });
    return jsonNoStore({ grid: updated });
  } catch (err) {
    logger.error('api.grids.public.failed', { requestId: locals.requestId, userId: auth.user.id, gridId: id, err });
    return jsonNoStore({ error: 'Internal server error' }, 500);
  }
};
