import type { UserRole } from '$lib/types';

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 256;
export const MAX_USERNAME_LENGTH = 64;

export function normalizeUsername(raw: string): string {
  return raw.trim();
}

export function validateUsername(raw: unknown): { ok: true; username: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Username is required.' };
  }
  const username = normalizeUsername(raw);
  if (!username) {
    return { ok: false, error: 'Username is required.' };
  }
  if (username.length > MAX_USERNAME_LENGTH) {
    return { ok: false, error: `Username must be ${MAX_USERNAME_LENGTH} characters or less.` };
  }
  if (/[\u0000-\u001f\u007f]/.test(username)) {
    return { ok: false, error: 'Username contains invalid control characters.' };
  }
  return { ok: true, username };
}

export function validatePassword(raw: unknown, label = 'Password'): { ok: true; password: string } | { ok: false; error: string } {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { ok: false, error: `${label} is required.` };
  }
  if (raw.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `${label} must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (raw.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, error: `${label} must be ${MAX_PASSWORD_LENGTH} characters or less.` };
  }
  return { ok: true, password: raw };
}

export function validateUserRole(raw: unknown): { ok: true; role: UserRole } | { ok: false; error: string } {
  if (raw === 'admin' || raw === 'user') {
    return { ok: true, role: raw };
  }
  return { ok: false, error: 'Role must be "admin" or "user".' };
}

export function formatDisplayUsername(username: string): string {
  const trimmed = username.trim();
  if (!trimmed) return '';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function sanitizeRedirectPath(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string') return '/';
  const trimmed = raw.trim();
  // Prevent open redirects (must be an internal single-slash path)
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.startsWith('/\\')) {
    return '/';
  }
  return trimmed;
}
