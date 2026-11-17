import type { RequestHandler } from './$types';
import { jsonNoStore } from '$lib/server/http';
import { APP_VERSION } from '$lib/server/version';

export const GET: RequestHandler = async () => {
  return jsonNoStore({ version: APP_VERSION });
};
