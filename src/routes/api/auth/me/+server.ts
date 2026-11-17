import type { RequestHandler } from './$types';
import { requireApiUser } from '$lib/server/auth';
import { jsonNoStore } from '$lib/server/http';

export const GET: RequestHandler = async ({ locals }) => {
  const auth = requireApiUser(locals);
  if (!auth.ok) return auth.response;
  return jsonNoStore({ user: auth.user });
};
