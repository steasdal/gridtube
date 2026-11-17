import type { FeedEntry, Grid } from '$lib/types';

export async function requestJson<T>(
  url: string,
  options: RequestInit = {},
  fallbackMessage = 'Request failed.'
): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...options.headers
    }
  });

  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  let data: (T & { error?: string }) | null = null;

  if (isJson) {
    try {
      data = (await res.json()) as T & { error?: string };
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    if (data?.error) {
      throw new Error(data.error);
    }
    if (res.status === 403 && !isJson) {
      throw new Error(
        'Request was blocked upstream (HTTP 403). If your security session expired or you switched device emulation, reload the page and try again.'
      );
    }
    throw new Error(`${fallbackMessage} (HTTP ${res.status})`);
  }

  if (!isJson || data === null) {
    throw new Error('Unexpected response from server. Try reloading the page.');
  }

  return data;
}

export interface GridPayload {
  name: string;
  feeds: FeedEntry[];
}

export function createGridApi(payload: GridPayload): Promise<Grid> {
  return requestJson<Grid>(
    '/api/grids',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    },
    'Could not save grid.'
  );
}

export function updateGridApi(
  id: string,
  payload: GridPayload,
  { keepalive = false }: { keepalive?: boolean } = {}
): Promise<Grid> {
  return requestJson<Grid>(
    `/api/grids/${encodeURIComponent(id)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive
    },
    'Could not save grid.'
  );
}

export function deleteGridApi(id: string): Promise<{ deleted: string }> {
  return requestJson<{ deleted: string }>(
    `/api/grids/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' }
    },
    'Failed to delete grid.'
  );
}
