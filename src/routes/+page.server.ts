import type { PageServerLoad } from './$types';
import { listGrids } from '$lib/server/db/grids-repo';

export const load: PageServerLoad = async () => {
  return {
    grids: await listGrids()
  };
};
