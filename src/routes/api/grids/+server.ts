import type { RequestHandler } from './$types';
import { createGrid, listGrids } from '$lib/server/db/grids-repo';
import { jsonNoStore, readJsonBody } from '$lib/server/http';
import { validateGridPayload } from '$lib/youtube';

export const GET: RequestHandler = async () => {
  try {
    const allGrids = await listGrids();
    return jsonNoStore(allGrids);
  } catch (err) {
    console.error('GET /api/grids failed:', err);
    return jsonNoStore({ error: 'Internal server error' }, 500);
  }
};

export const POST: RequestHandler = async ({ request }) => {
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
    const created = await createGrid(validated.name, validated.feeds);
    return jsonNoStore(created, 201);
  } catch (err) {
    console.error('POST /api/grids failed:', err);
    return jsonNoStore({ error: 'Internal server error' }, 500);
  }
};
