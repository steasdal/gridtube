import type { LayoutServerLoad } from './$types';
import { APP_VERSION } from '$lib/server/version';

export const load: LayoutServerLoad = async ({ locals }) => {
  return {
    version: APP_VERSION,
    user: locals.user
  };
};
