import type { LayoutServerLoad } from './$types';
import { APP_VERSION } from '$lib/server/version';

export const load: LayoutServerLoad = async () => {
  return {
    version: APP_VERSION
  };
};
