import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listOtherUsers } from '$lib/server/db/users-repo';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) {
    redirect(302, '/?next=%2Fadmin');
  }

  if (locals.user.role !== 'admin') {
    redirect(302, '/');
  }

  return {
    user: locals.user,
    users: await listOtherUsers(locals.user.id)
  };
};
