import type { ServerInit } from '@sveltejs/kit/hooks';
import { initDatabase } from '$lib/server/db';

export const init: ServerInit = async () => {
  await initDatabase();
};
