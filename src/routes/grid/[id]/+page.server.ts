import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getGridById } from '$lib/server/db/grids-repo';

export const load: PageServerLoad = async ({ locals, params, url }) => {
  if (!locals.user) {
    redirect(302, `/?next=${encodeURIComponent(url.pathname)}`);
  }

  const grid = await getGridById(params.id, locals.user.id);
  if (!grid) {
    redirect(302, '/');
  }
  return { grid };
};
