import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) {
    redirect(302, '/?next=%2Fprofile');
  }

  return {
    user: locals.user
  };
};
