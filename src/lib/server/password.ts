import crypto from 'node:crypto';
import type { UserRow } from '$lib/server/db/schema';
import type { AuthUser, UserRole } from '$lib/types';

const READABLE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export function generateInitialAdminPassword(length = 16): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += READABLE_ALPHABET[bytes[i] % READABLE_ALPHABET.length];
  }
  return out;
}

export function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(`scrypt$${salt}$${derivedKey.toString('hex')}`);
    });
  });
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }
  const [, salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  if (expected.length === 0) return false;

  const actual = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, expected.length, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });

  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

export function toPublicUser(
  row: Pick<UserRow, 'id' | 'username' | 'role' | 'createdAt' | 'updatedAt'>
): AuthUser {
  const role: UserRole = row.role === 'admin' ? 'admin' : 'user';
  return {
    id: row.id,
    username: row.username,
    role,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt ?? null
  };
}
