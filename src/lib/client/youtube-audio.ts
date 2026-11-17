import type { FeedEntry } from '$lib/types';
import { normalizeFeedEntry } from '$lib/youtube';

export const AUDIO_COMMAND_ECHO_SUPPRESS_MS = 900;

export interface IframeAudioSyncState {
  gridId: string;
  paneIndex: number;
  feed: FeedEntry;
  userUnmuted: boolean;
  syncedOnPlay: boolean;
  suppressAudioPersistUntil: number;
}

export function postYouTubeCommand(
  iframe: HTMLIFrameElement | null | undefined,
  func: string,
  args: Array<number | string> = []
): void {
  if (!iframe?.contentWindow) return;
  iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
}

export function postYouTubeListening(
  iframe: HTMLIFrameElement | null | undefined,
  paneIndex: number
): void {
  if (!iframe?.contentWindow) return;
  iframe.contentWindow.postMessage(
    JSON.stringify({
      event: 'listening',
      id: `gridtube-pane-${paneIndex}`,
      channel: 'widget'
    }),
    '*'
  );
}

export function computeAudioUpdate(
  prevFeed: FeedEntry,
  info: { volume?: unknown; muted?: unknown }
): FeedEntry | null {
  const hasVolume = typeof info.volume === 'number' && Number.isFinite(info.volume);
  const hasMuted = typeof info.muted === 'boolean';
  if (!hasVolume && !hasMuted) return null;

  const nextVolume = hasVolume
    ? Math.max(0, Math.min(100, Math.round(info.volume as number)))
    : prevFeed.volume;

  let nextMuted = prevFeed.muted;
  if (hasMuted) {
    nextMuted = info.muted as boolean;
  } else if (hasVolume && nextVolume === 0) {
    nextMuted = true;
  } else if (hasVolume && nextVolume > 0 && prevFeed.volume === 0 && prevFeed.muted) {
    nextMuted = false;
  }

  if (nextVolume === prevFeed.volume && nextMuted === prevFeed.muted) {
    return null;
  }

  return normalizeFeedEntry({
    ...prevFeed,
    volume: nextVolume,
    muted: nextMuted
  });
}
