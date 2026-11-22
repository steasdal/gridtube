import crypto from 'node:crypto';
import type { Cookies, RequestEvent } from '@sveltejs/kit';
import { and, eq, gt, ne } from 'drizzle-orm';
import { getDb, type AppDatabase } from '$lib/server/db';
import { userSessions, users } from '$lib/server/db/schema';
import { jsonNoStore } from '$lib/server/http';
import { toPublicUser } from '$lib/server/password';
import type { AuthUser } from '$lib/types';

export const SESSION_COOKIE_NAME = 'gridtube_session';
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
export const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;
const SESSION_SLIDE_THRESHOLD_MS = 60 * 1000;

function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function isHttpsRequest(request: Request, url: URL): boolean {
  if (url.protocol === 'https:') return true;
  const forwarded = request.headers.get('x-forwarded-proto');
  if (!forwarded) return false;
  return forwarded.split(',')[0]?.trim().toLowerCase() === 'https';
}

export function setSessionCookie(cookies: Cookies, token: string, request: Request, url: URL): void {
  cookies.set(SESSION_COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttpsRequest(request, url),
    maxAge: SESSION_TTL_SECONDS
  });
}

export function clearSessionCookie(cookies: Cookies, request: Request, url: URL): void {
  cookies.delete(SESSION_COOKIE_NAME, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttpsRequest(request, url)
  });
}

export function extractSessionToken(event: RequestEvent): { token: string; fromCookie: boolean } | null {
  const authHeader = event.request.headers.get('authorization');
  if (authHeader) {
    const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
    if (match?.[1]) {
      return { token: match[1].trim(), fromCookie: false };
    }
  }
  const cookieToken = event.cookies.get(SESSION_COOKIE_NAME)?.trim();
  if (cookieToken) {
    return { token: cookieToken, fromCookie: true };
  }
  return null;
}

export async function createSession(
  userId: string
): Promise<{ sessionId: string; token: string; expiresAt: string }> {
  const db = await getDb();
  const sessionId = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();

  await db.insert(userSessions).values({
    id: sessionId,
    tokenHash,
    userId,
    expiresAt,
    createdAt: now.toISOString(),
    lastSeenAt: now.toISOString()
  });

  return { sessionId, token, expiresAt };
}

export async function deleteSessionById(sessionId: string): Promise<void> {
  const db = await getDb();
  await db.delete(userSessions).where(eq(userSessions.id, sessionId));
}

export async function deleteSessionsForUser(
  userId: string,
  exceptSessionId?: string | null,
  executor?: Pick<AppDatabase, 'delete'>
): Promise<void> {
  const db = executor ?? (await getDb());
  if (exceptSessionId) {
    await db
      .delete(userSessions)
      .where(and(eq(userSessions.userId, userId), ne(userSessions.id, exceptSessionId)));
    return;
  }
  await db.delete(userSessions).where(eq(userSessions.userId, userId));
}

export async function resolveRequestSession(event: RequestEvent): Promise<void> {
  event.locals.user = null;
  event.locals.sessionId = null;

  const extracted = extractSessionToken(event);
  if (!extracted) return;

  const db = await getDb();
  const now = new Date();
  const nowIso = now.toISOString();
  const tokenHash = hashSessionToken(extracted.token);

  const rows = await db
    .select({
      sessionId: userSessions.id,
      expiresAt: userSessions.expiresAt,
      lastSeenAt: userSessions.lastSeenAt,
      userId: users.id,
      username: users.username,
      role: users.role,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt
    })
    .from(userSessions)
    .innerJoin(users, eq(userSessions.userId, users.id))
    .where(and(eq(userSessions.tokenHash, tokenHash), gt(userSessions.expiresAt, nowIso)))
    .limit(1);

  const match = rows[0];
  if (!match) {
    await db.delete(userSessions).where(eq(userSessions.tokenHash, tokenHash));
    if (extracted.fromCookie) {
      clearSessionCookie(event.cookies, event.request, event.url);
    }
    return;
  }

  event.locals.user = toPublicUser({
    id: match.userId,
    username: match.username,
    role: match.role,
    createdAt: match.createdAt,
    updatedAt: match.updatedAt
  });
  event.locals.sessionId = match.sessionId;

  const lastSeenMs = Date.parse(match.lastSeenAt);
  if (Number.isNaN(lastSeenMs) || now.getTime() - lastSeenMs >= SESSION_SLIDE_THRESHOLD_MS) {
    const nextExpiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
    await db
      .update(userSessions)
      .set({
        expiresAt: nextExpiresAt,
        lastSeenAt: nowIso
      })
      .where(eq(userSessions.id, match.sessionId));

    if (extracted.fromCookie) {
      setSessionCookie(event.cookies, extracted.token, event.request, event.url);
    }
  }
}

export function requireApiUser(locals: App.Locals): { ok: true; user: AuthUser } | { ok: false; response: Response } {
  if (!locals.user) {
    return {
      ok: false,
      response: jsonNoStore({ error: 'Authentication required.' }, 401)
    };
  }
  return { ok: true, user: locals.user };
}

export function requireApiAdmin(locals: App.Locals): { ok: true; user: AuthUser } | { ok: false; response: Response } {
  const auth = requireApiUser(locals);
  if (!auth.ok) return auth;
  if (auth.user.role !== 'admin') {
    return {
      ok: false,
      response: jsonNoStore({ error: 'Administrator access required.' }, 403)
    };
  }
  return auth;
}
