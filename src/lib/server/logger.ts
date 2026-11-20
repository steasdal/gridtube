type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100
};

function resolveLogLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL?.trim().toLowerCase();
  if (raw && raw in LEVEL_PRIORITY) {
    return raw as LogLevel;
  }
  return 'info';
}

function serializeValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack
    };
  }
  return value;
}

function formatEntry(level: Exclude<LogLevel, 'silent'>, msg: string, fields?: Record<string, unknown>): string {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg
  };

  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) {
        entry[key] = serializeValue(value);
      }
    }
  }

  try {
    return JSON.stringify(entry);
  } catch {
    return JSON.stringify({
      ts: entry.ts,
      level,
      msg,
      serializationError: true
    });
  }
}

function emit(level: Exclude<LogLevel, 'silent'>, msg: string, fields?: Record<string, unknown>): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[resolveLogLevel()]) {
    return;
  }
  const line = formatEntry(level, msg, fields);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export function getClientIp(request: Request): string | undefined {
  // Prefer Cloudflare's edge-set header when present so clients cannot spoof X-Forwarded-For.
  const cfIp = request.headers.get('cf-connecting-ip')?.trim();
  if (cfIp) return cfIp;

  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get('x-real-ip')?.trim();
  return realIp || undefined;
}

export const logger = {
  debug(msg: string, fields?: Record<string, unknown>): void {
    emit('debug', msg, fields);
  },
  info(msg: string, fields?: Record<string, unknown>): void {
    emit('info', msg, fields);
  },
  warn(msg: string, fields?: Record<string, unknown>): void {
    emit('warn', msg, fields);
  },
  error(msg: string, fields?: Record<string, unknown>): void {
    emit('error', msg, fields);
  }
};
