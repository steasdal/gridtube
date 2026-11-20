const DEFAULT_MAX_ATTEMPTS = 10;
const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const MAX_TRACKED_KEYS = 10_000;

interface FailureBucket {
  timestamps: number[];
}

const ipBuckets = new Map<string, FailureBucket>();
const userBuckets = new Map<string, FailureBucket>();

function getMaxAttempts(): number {
  const raw = process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS?.trim();
  if (!raw) return DEFAULT_MAX_ATTEMPTS;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_ATTEMPTS;
}

function getWindowMs(): number {
  const raw = process.env.LOGIN_RATE_LIMIT_WINDOW_MS?.trim();
  if (!raw) return DEFAULT_WINDOW_MS;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1000 ? parsed : DEFAULT_WINDOW_MS;
}

function pruneBucket(map: Map<string, FailureBucket>, key: string, cutoff: number): number[] {
  const existing = map.get(key);
  if (!existing) return [];
  const active = existing.timestamps.filter((ts) => ts > cutoff);
  if (active.length === 0) {
    map.delete(key);
    return [];
  }
  existing.timestamps = active;
  return active;
}

function evictIfNeeded(map: Map<string, FailureBucket>, cutoff: number): void {
  if (map.size < MAX_TRACKED_KEYS) return;
  for (const [key, bucket] of map) {
    const active = bucket.timestamps.filter((ts) => ts > cutoff);
    if (active.length === 0) {
      map.delete(key);
    } else {
      bucket.timestamps = active;
    }
  }
  // If still full under a heavy distributed attack, evict the oldest inserted keys.
  while (map.size >= MAX_TRACKED_KEYS) {
    const oldestKey = map.keys().next().value;
    if (oldestKey === undefined) break;
    map.delete(oldestKey);
  }
}

export interface LoginRateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  scope?: 'ip' | 'username';
}

export function checkLoginRateLimit(ip: string | undefined, username: string): LoginRateLimitResult {
  const maxAttempts = getMaxAttempts();
  const windowMs = getWindowMs();
  const now = Date.now();
  const cutoff = now - windowMs;

  if (ip) {
    const ipAttempts = pruneBucket(ipBuckets, ip, cutoff);
    if (ipAttempts.length >= maxAttempts) {
      const oldest = ipAttempts[0];
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      return { allowed: false, retryAfterSeconds, scope: 'ip' };
    }
  }

  const userKey = username.trim().toLowerCase();
  if (userKey) {
    const userAttempts = pruneBucket(userBuckets, userKey, cutoff);
    if (userAttempts.length >= maxAttempts) {
      const oldest = userAttempts[0];
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      return { allowed: false, retryAfterSeconds, scope: 'username' };
    }
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

export function recordFailedLoginAttempt(ip: string | undefined, username: string): void {
  const windowMs = getWindowMs();
  const now = Date.now();
  const cutoff = now - windowMs;

  if (ip) {
    const active = pruneBucket(ipBuckets, ip, cutoff);
    if (active.length === 0) {
      evictIfNeeded(ipBuckets, cutoff);
      ipBuckets.set(ip, { timestamps: [now] });
    } else {
      active.push(now);
    }
  }

  const userKey = username.trim().toLowerCase();
  if (userKey) {
    const active = pruneBucket(userBuckets, userKey, cutoff);
    if (active.length === 0) {
      evictIfNeeded(userBuckets, cutoff);
      userBuckets.set(userKey, { timestamps: [now] });
    } else {
      active.push(now);
    }
  }
}

export function clearLoginRateLimit(ip: string | undefined, username: string): void {
  if (ip) {
    ipBuckets.delete(ip);
  }
  const userKey = username.trim().toLowerCase();
  if (userKey) {
    userBuckets.delete(userKey);
  }
}
