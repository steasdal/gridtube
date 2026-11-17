import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { resolveRequestSession } from '$lib/server/auth';
import { initDatabase } from '$lib/server/db';

export const init: ServerInit = async () => {
  await initDatabase();
};

export const handle: Handle = async ({ event, resolve }) => {
  await resolveRequestSession(event);
  return resolve(event);
};
