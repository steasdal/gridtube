import type { RequestHandler } from './$types';
import { getDatabaseHealth } from '$lib/server/db';
import { jsonNoStore } from '$lib/server/http';
import { APP_VERSION } from '$lib/server/version';

export const GET: RequestHandler = async () => {
  try {
    const db = await getDatabaseHealth();
    return jsonNoStore({
      status: 'ok',
      version: APP_VERSION,
      driver: db.driver,
      storage: db.target
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Database health check failed';
    return jsonNoStore({ status: 'error', version: APP_VERSION, error: message }, 500);
  }
};
