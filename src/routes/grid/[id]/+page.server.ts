import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getGridById } from '$lib/server/db/grids-repo';

export const load: PageServerLoad = async ({ params }) => {
  const grid = await getGridById(params.id);
  if (!grid) {
    redirect(302, '/');
  }
  return { grid };
};
