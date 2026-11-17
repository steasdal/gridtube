import type { FeedEntry, ValidationResult } from './types';

export const SLOT_POSITIONS = ['Top-Left', 'Top-Right', 'Bottom-Left', 'Bottom-Right'] as const;
export const SLOT_LABELS = [
  'Top-Left Feed',
  'Top-Right Feed',
  'Bottom-Left Feed',
  'Bottom-Right Feed'
] as const;

export const YOUTUBE_URL_INPUT_PATTERN =
  '^(https?://(www\\.|m\\.|music\\.)?(youtube\\.com|youtu\\.be|youtube-nocookie\\.com)/.+|[A-Za-z0-9_\\-]{11})$';

const VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

export function extractYouTubeId(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return '';

  if (VIDEO_ID_REGEX.test(trimmed)) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();

    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      return id && VIDEO_ID_REGEX.test(id) ? id : null;
    }

    if (
      host === 'youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'music.youtube.com' ||
      host === 'youtube-nocookie.com'
    ) {
      const vParam = url.searchParams.get('v');
      if (vParam && VIDEO_ID_REGEX.test(vParam)) {
        return vParam;
      }
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && ['embed', 'live', 'shorts', 'v'].includes(parts[0])) {
        const candidate = parts[1];
        if (VIDEO_ID_REGEX.test(candidate)) {
          return candidate;
        }
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function normalizeFeedEntry(entry: unknown): FeedEntry {
  if (typeof entry === 'string') {
    return { url: entry.trim(), volume: 100, muted: false };
  }
  if (entry && typeof entry === 'object') {
    const record = entry as Record<string, unknown>;
    const url = typeof record.url === 'string' ? record.url.trim() : '';
    const rawVol = Number(record.volume);
    const volume = Number.isFinite(rawVol)
      ? Math.max(0, Math.min(100, Math.round(rawVol)))
      : 100;
    const muted = Boolean(record.muted);
    return { url, volume, muted };
  }
  return { url: '', volume: 100, muted: false };
}

export function normalizeFeedsList(rawFeeds: unknown): FeedEntry[] {
  const list = Array.isArray(rawFeeds) ? rawFeeds : [];
  return [0, 1, 2, 3].map((idx) => normalizeFeedEntry(list[idx]));
}

export function validateGridPayload(body: unknown): ValidationResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Request body must be a JSON object.' };
  }

  const record = body as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (!name) {
    return { ok: false, error: 'Grid name is required.' };
  }
  if (name.length > 80) {
    return { ok: false, error: 'Grid name must be 80 characters or fewer.' };
  }

  if (!Array.isArray(record.feeds) || record.feeds.length > 4) {
    return { ok: false, error: 'Feeds must be an array of up to 4 URLs.' };
  }

  const normalizedFeeds = normalizeFeedsList(record.feeds);

  for (let i = 0; i < 4; i++) {
    const { url } = normalizedFeeds[i];
    if (url !== '') {
      const videoId = extractYouTubeId(url);
      if (!videoId) {
        return {
          ok: false,
          error: `Feed ${i + 1} is not a valid YouTube URL or 11-character video ID.`
        };
      }
    }
  }

  return { ok: true, name, feeds: normalizedFeeds };
}

export function buildEmbedUrl(feedEntry: FeedEntry | string | undefined, isIOS: boolean): string | null {
  const feed = normalizeFeedEntry(feedEntry);
  const videoId = extractYouTubeId(feed.url);
  if (!videoId) return null;

  const isMuted = isIOS || feed.muted || feed.volume === 0;
  const params = new URLSearchParams({
    autoplay: '1',
    mute: isMuted ? '1' : '0',
    playsinline: '1',
    rel: '0',
    enablejsapi: '1'
  });
  return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?${params.toString()}`;
}

export function buildThumbnailUrl(feedEntry: FeedEntry | string | undefined): string | null {
  const feed = normalizeFeedEntry(feedEntry);
  const videoId = extractYouTubeId(feed.url);
  if (!videoId) return null;
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg`;
}
