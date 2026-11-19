import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getGridById, getPublicGridById } from '$lib/server/db/grids-repo';
import { recordGridView } from '$lib/server/metrics';

export const load: PageServerLoad = async ({ locals, params, url }) => {
  if (!locals.user) {
    const publicGrid = await getPublicGridById(params.id);
    if (publicGrid) {
      recordGridView('public');
      return { grid: publicGrid, readOnly: true, canPublish: false };
    }
    redirect(302, `/?next=${encodeURIComponent(url.pathname)}`);
  }

  const grid = await getGridById(params.id, locals.user.id);
  if (!grid) {
    redirect(302, '/');
  }
  recordGridView('private');
  return { grid, readOnly: false, canPublish: locals.user.role === 'admin' };
};
