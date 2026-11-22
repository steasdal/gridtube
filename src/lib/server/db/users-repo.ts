import crypto from 'node:crypto';
import { and, asc, eq, ne } from 'drizzle-orm';
import { deleteSessionsForUser } from '$lib/server/auth';
import { getDb } from '$lib/server/db';
import { publicGrids, users } from '$lib/server/db/schema';
import { hashPassword, toPublicUser, verifyPassword } from '$lib/server/password';
import type { AuthUser, UserRole } from '$lib/types';

export type RepoResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
    const rec = current as { code?: unknown; cause?: unknown };
    if (rec.code === '23505') return true;
    current = rec.cause;
  }
  return false;
}

export async function authenticateUser(
  username: string,
  password: string
): Promise<AuthUser | null> {
  const db = await getDb();
  const usernameLower = username.trim().toLowerCase();
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.usernameLower, usernameLower))
    .limit(1);

  const user = rows[0];
  if (!user) return null;

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return null;

  return toPublicUser(user);
}

export async function listOtherUsers(excludeUserId: string): Promise<AuthUser[]> {
  const db = await getDb();
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      role: users.role,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt
    })
    .from(users)
    .where(ne(users.id, excludeUserId))
    .orderBy(asc(users.createdAt), asc(users.usernameLower));

  return rows.map(toPublicUser);
}

export async function getUserById(id: string): Promise<AuthUser | null> {
  const db = await getDb();
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      role: users.role,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  return rows[0] ? toPublicUser(rows[0]) : null;
}

export async function createUser(
  username: string,
  password: string,
  role: UserRole
): Promise<RepoResult<AuthUser>> {
  const db = await getDb();
  const cleanUsername = username.trim();
  const usernameLower = cleanUsername.toLowerCase();

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.usernameLower, usernameLower))
    .limit(1);

  if (existing.length > 0) {
    return { ok: false, status: 409, error: `Username "${cleanUsername}" is already taken.` };
  }

  const now = new Date().toISOString();
  const passwordHash = await hashPassword(password);
  const newUser = {
    id: crypto.randomUUID(),
    username: cleanUsername,
    usernameLower,
    passwordHash,
    role,
    createdAt: now,
    updatedAt: null
  };

  try {
    await db.insert(users).values(newUser);
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { ok: false, status: 409, error: `Username "${cleanUsername}" is already taken.` };
    }
    throw err;
  }
  return { ok: true, data: toPublicUser(newUser) };
}

export async function updateManagedUser(
  targetId: string,
  updates: { username: string; role: UserRole; password?: string }
): Promise<RepoResult<AuthUser>> {
  const db = await getDb();
  const cleanUsername = updates.username.trim();
  const usernameLower = cleanUsername.toLowerCase();

  // Compute scrypt password hash outside the DB transaction to avoid holding locks during CPU work.
  const hashedNewPassword = updates.password ? await hashPassword(updates.password) : null;

  try {
    return await db.transaction(async (tx) => {
      const existingRows = await tx
        .select()
        .from(users)
        .where(eq(users.id, targetId))
        .limit(1);

      const existing = existingRows[0];
      if (!existing) {
        return { ok: false, status: 404, error: 'User not found.' };
      }

      const conflicting = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.usernameLower, usernameLower), ne(users.id, targetId)))
        .limit(1);

      if (conflicting.length > 0) {
        return { ok: false, status: 409, error: `Username "${cleanUsername}" is already taken.` };
      }

      const now = new Date().toISOString();
      const nextPasswordHash = hashedNewPassword ?? existing.passwordHash;

      await tx
        .update(users)
        .set({
          username: cleanUsername,
          usernameLower,
          role: updates.role,
          passwordHash: nextPasswordHash,
          updatedAt: now
        })
        .where(eq(users.id, targetId));

      if (updates.role !== 'admin') {
        await tx.delete(publicGrids).where(eq(publicGrids.userId, targetId));
      }

      if (hashedNewPassword || updates.role !== existing.role) {
        await deleteSessionsForUser(targetId, null, tx);
      }

      return {
        ok: true,
        data: toPublicUser({
          id: existing.id,
          username: cleanUsername,
          role: updates.role,
          createdAt: existing.createdAt,
          updatedAt: now
        })
      };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { ok: false, status: 409, error: `Username "${cleanUsername}" is already taken.` };
    }
    throw err;
  }
}

export async function deleteManagedUser(targetId: string): Promise<boolean> {
  const db = await getDb();
  const deleted = await db
    .delete(users)
    .where(eq(users.id, targetId))
    .returning({ id: users.id });
  return deleted.length > 0;
}

export async function updateOwnProfile(
  userId: string,
  currentSessionId: string | null,
  updates: {
    username?: string;
    currentPassword?: string;
    newPassword?: string;
  }
): Promise<RepoResult<AuthUser>> {
  const db = await getDb();
  const initialRows = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const initial = initialRows[0];
  if (!initial) {
    return { ok: false, status: 404, error: 'User not found.' };
  }

  // Verify and hash passwords outside the DB transaction so scrypt work doesn't hold DB locks.
  let hashedNewPassword: string | null = null;
  let passwordChanged = false;

  if (updates.newPassword !== undefined) {
    if (!updates.currentPassword) {
      return { ok: false, status: 400, error: 'Current password is required to set a new password.' };
    }
    const matches = await verifyPassword(updates.currentPassword, initial.passwordHash);
    if (!matches) {
      return { ok: false, status: 403, error: 'Current password is incorrect.' };
    }
    hashedNewPassword = await hashPassword(updates.newPassword);
    passwordChanged = true;
  }

  const cleanUsername = updates.username ? updates.username.trim() : initial.username;
  const usernameLower = cleanUsername.toLowerCase();

  try {
    return await db.transaction(async (tx) => {
      const existingRows = await tx
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      const existing = existingRows[0];
      if (!existing) {
        return { ok: false, status: 404, error: 'User not found.' };
      }

      const targetUsername = updates.username ? cleanUsername : existing.username;
      const targetUsernameLower = targetUsername.toLowerCase();

      if (updates.username) {
        const conflicting = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.usernameLower, targetUsernameLower), ne(users.id, userId)))
          .limit(1);

        if (conflicting.length > 0) {
          return { ok: false, status: 409, error: `Username "${targetUsername}" is already taken.` };
        }
      }

      const now = new Date().toISOString();
      const nextPasswordHash = hashedNewPassword ?? existing.passwordHash;

      await tx
        .update(users)
        .set({
          username: targetUsername,
          usernameLower: targetUsernameLower,
          passwordHash: nextPasswordHash,
          updatedAt: now
        })
        .where(eq(users.id, userId));

      if (passwordChanged) {
        await deleteSessionsForUser(userId, currentSessionId, tx);
      }

      return {
        ok: true,
        data: toPublicUser({
          id: existing.id,
          username: targetUsername,
          role: existing.role,
          createdAt: existing.createdAt,
          updatedAt: now
        })
      };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { ok: false, status: 409, error: `Username "${cleanUsername}" is already taken.` };
    }
    throw err;
  }
}
