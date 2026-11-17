import { json } from '@sveltejs/kit';

const MAX_JSON_BODY_BYTES = 64 * 1024;

export function jsonNoStore(data: unknown, status = 200): Response {
  return json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' }
  });
}

export async function readJsonBody(request: Request): Promise<unknown> {
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_JSON_BODY_BYTES) {
    throw new Error('Payload too large');
  }
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON payload');
  }
}
