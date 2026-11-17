import type { PageServerLoad } from './$types';
import { sanitizeRedirectPath } from '$lib/auth';
import { listGrids } from '$lib/server/db/grids-repo';

export const load: PageServerLoad = async ({ locals, url }) => {
  const redirectTo = sanitizeRedirectPath(url.searchParams.get('next'));
  if (!locals.user) {
    return {
      user: null,
      grids: [],
      redirectTo
    };
  }

  return {
    user: locals.user,
    grids: await listGrids(locals.user.id),
    redirectTo: '/'
  };
};
