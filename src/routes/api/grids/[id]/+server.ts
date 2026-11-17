import type { RequestHandler } from './$types';
import { deleteGrid, getGridById, updateGrid } from '$lib/server/db/grids-repo';
import { jsonNoStore, readJsonBody } from '$lib/server/http';
import { validateGridPayload } from '$lib/youtube';

export const GET: RequestHandler = async ({ params }) => {
  const id = params.id?.trim();
  if (!id) {
    return jsonNoStore({ error: 'Grid ID is required.' }, 400);
  }
  const grid = await getGridById(id);
  if (!grid) {
    return jsonNoStore({ error: 'Grid not found.' }, 404);
  }
  return jsonNoStore(grid);
};

export const PUT: RequestHandler = async ({ params, request }) => {
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

  try {
    const updated = await updateGrid(id, validated.name, validated.feeds);
    if (!updated) {
      return jsonNoStore({ error: 'Grid not found.' }, 404);
    }
    return jsonNoStore(updated);
  } catch (err) {
    console.error('PUT /api/grids/:id failed:', err);
    return jsonNoStore({ error: 'Internal server error' }, 500);
  }
};

export const DELETE: RequestHandler = async ({ params }) => {
  const id = params.id?.trim();
  if (!id) {
    return jsonNoStore({ error: 'Grid ID is required.' }, 400);
  }

  try {
    const deleted = await deleteGrid(id);
    if (!deleted) {
      return jsonNoStore({ error: 'Grid not found.' }, 404);
    }
    return jsonNoStore({ deleted: id });
  } catch (err) {
    console.error('DELETE /api/grids/:id failed:', err);
    return jsonNoStore({ error: 'Internal server error' }, 500);
  }
};
