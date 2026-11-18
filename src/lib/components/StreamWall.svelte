<script lang="ts">
  import { onMount } from 'svelte';
  import { detectPlatformFlags } from '$lib/client/ipad-viewport';
  import {
    AUDIO_COMMAND_ECHO_SUPPRESS_MS,
    computeAudioUpdate,
    postYouTubeCommand,
    postYouTubeListening,
    type IframeAudioSyncState
  } from '$lib/client/youtube-audio';
  import type { FeedEntry, Grid } from '$lib/types';
  import {
    buildEmbedUrl,
    extractYouTubeId,
    normalizeFeedEntry,
    SLOT_POSITIONS
  } from '$lib/youtube';

  interface Props {
    grid: Grid;
    streamWallEl?: HTMLElement;
    readOnly?: boolean;
    isModalOpen: () => boolean;
    onConfigureSlot: (paneIndex: number) => void;
    onLiveAudioChange: (paneIndex: number, nextFeed: FeedEntry) => void;
  }

  let {
    grid,
    streamWallEl = $bindable(),
    readOnly = false,
    isModalOpen,
    onConfigureSlot,
    onLiveAudioChange
  }: Props = $props();

  const platform = detectPlatformFlags();
  let iframeEls: Array<HTMLIFrameElement | undefined> = $state([
    undefined,
    undefined,
    undefined,
    undefined
  ]);
  let paneUnmuted = $state([false, false, false, false]);
  const syncStates = new WeakMap<HTMLIFrameElement, IframeAudioSyncState>();

  function getNormalizedFeed(idx: number): FeedEntry {
    return normalizeFeedEntry(grid.feeds?.[idx]);
  }

  function getPaneVideoId(idx: number): string {
    return extractYouTubeId(getNormalizedFeed(idx).url) || '';
  }

  function sendYouTubeAudioCommands(iframe: HTMLIFrameElement, feed: FeedEntry) {
    if (!iframe?.contentWindow) return;
    const state = syncStates.get(iframe);
    if (state) {
      state.suppressAudioPersistUntil = Date.now() + AUDIO_COMMAND_ECHO_SUPPRESS_MS;
    }
    const shouldMute = platform.isIOS
      ? !state?.userUnmuted
      : feed.muted || feed.volume === 0;
    if (shouldMute) {
      postYouTubeCommand(iframe, 'setVolume', [feed.volume]);
      postYouTubeCommand(iframe, 'mute', []);
    } else {
      postYouTubeCommand(iframe, 'unMute', []);
      postYouTubeCommand(iframe, 'setVolume', [feed.volume > 0 ? feed.volume : 100]);
    }
  }

  function initIframe(iframe: HTMLIFrameElement, paneIndex: number) {
    const feed = getNormalizedFeed(paneIndex);
    const unmuted = !(platform.isIOS || feed.muted || feed.volume === 0);
    paneUnmuted[paneIndex] = unmuted;
    syncStates.set(iframe, {
      gridId: grid.id,
      paneIndex,
      feed,
      userUnmuted: unmuted,
      syncedOnPlay: false,
      suppressAudioPersistUntil: Date.now() + AUDIO_COMMAND_ECHO_SUPPRESS_MS
    });
  }

  function bindIframeAction(node: HTMLIFrameElement, paneIndex: number) {
    initIframe(node, paneIndex);

    const startListening = () => {
      if (!node.contentWindow) return;
      const state = syncStates.get(node);
      postYouTubeListening(node, paneIndex);
      if (!state?.syncedOnPlay) {
        sendYouTubeAudioCommands(node, state?.feed || getNormalizedFeed(paneIndex));
      }
    };

    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const onLoad = () => {
      startListening();
      timers.push(setTimeout(startListening, 350));
      timers.push(setTimeout(startListening, 1000));
    };
    node.addEventListener('load', onLoad);

    return {
      destroy() {
        node.removeEventListener('load', onLoad);
        for (const t of timers) clearTimeout(t);
      }
    };
  }

  function togglePaneAudio(paneIndex: number) {
    const iframe = iframeEls[paneIndex];
    if (!iframe) return;
    const state = syncStates.get(iframe);
    if (!state) return;

    const now = Date.now();
    const nextUnmuted = !state.userUnmuted;
    if (nextUnmuted) {
      for (let i = 0; i < 4; i++) {
        if (i === paneIndex) continue;
        const otherFrame = iframeEls[i];
        if (!otherFrame) continue;
        const otherState = syncStates.get(otherFrame);
        if (otherState?.userUnmuted) {
          otherState.userUnmuted = false;
          otherState.suppressAudioPersistUntil = now + AUDIO_COMMAND_ECHO_SUPPRESS_MS;
          paneUnmuted[i] = false;
          postYouTubeCommand(otherFrame, 'mute', []);
        }
      }

      state.userUnmuted = true;
      state.syncedOnPlay = true;
      state.suppressAudioPersistUntil = now + AUDIO_COMMAND_ECHO_SUPPRESS_MS;
      paneUnmuted[paneIndex] = true;
      const targetVolume = state.feed.volume > 0 ? state.feed.volume : 100;
      postYouTubeCommand(iframe, 'unMute', []);
      postYouTubeCommand(iframe, 'setVolume', [targetVolume]);
      postYouTubeCommand(iframe, 'playVideo', []);
    } else {
      state.userUnmuted = false;
      state.suppressAudioPersistUntil = now + AUDIO_COMMAND_ECHO_SUPPRESS_MS;
      paneUnmuted[paneIndex] = false;
      postYouTubeCommand(iframe, 'mute', []);
    }
  }

  function handleWindowMessage(event: MessageEvent) {
    if (!event.origin.includes('youtube.com') && !event.origin.includes('youtube-nocookie.com')) {
      return;
    }
    let data: { event?: string; info?: { playerState?: number; volume?: unknown; muted?: unknown } | number };
    try {
      data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
    } catch {
      return;
    }
    if (!data || typeof data !== 'object') return;

    for (let i = 0; i < 4; i++) {
      const iframe = iframeEls[i];
      if (!iframe || iframe.contentWindow !== event.source) continue;
      const state = syncStates.get(iframe);
      if (!state) break;

      const infoObj = typeof data.info === 'object' && data.info !== null ? data.info : null;
      let ranInitialSyncNow = false;

      if (!state.syncedOnPlay) {
        if (data.event === 'onReady') {
          sendYouTubeAudioCommands(iframe, state.feed);
        } else if (data.event === 'onStateChange' && data.info === 1) {
          sendYouTubeAudioCommands(iframe, state.feed);
          state.syncedOnPlay = true;
          ranInitialSyncNow = true;
        } else if (data.event === 'infoDelivery' && infoObj?.playerState === 1) {
          sendYouTubeAudioCommands(iframe, state.feed);
          state.syncedOnPlay = true;
          ranInitialSyncNow = true;
        }
      }

      if (data.event === 'infoDelivery' && infoObj) {
        if (typeof infoObj.muted === 'boolean') {
          const isUnmuted = !infoObj.muted;
          if (state.syncedOnPlay || isUnmuted) {
            state.userUnmuted = isUnmuted;
            paneUnmuted[i] = isUnmuted;
          }
        }
        if (
          !ranInitialSyncNow &&
          !platform.isIOS &&
          state.syncedOnPlay &&
          Date.now() >= state.suppressAudioPersistUntil &&
          !isModalOpen()
        ) {
          const nextFeed = computeAudioUpdate(state.feed, infoObj);
          if (nextFeed) {
            state.feed = nextFeed;
            onLiveAudioChange(i, nextFeed);
          }
        }
      }
      break;
    }
  }

  // Push modal-saved audio changes to already-mounted iframes without reloading their streams
  $effect(() => {
    for (let i = 0; i < 4; i++) {
      const iframe = iframeEls[i];
      if (!iframe) continue;
      const state = syncStates.get(iframe);
      if (!state) continue;
      const feed = getNormalizedFeed(i);
      if (state.feed.volume === feed.volume && state.feed.muted === feed.muted) {
        continue;
      }
      state.feed = feed;
      if (feed.muted || feed.volume === 0) {
        state.userUnmuted = false;
        paneUnmuted[i] = false;
      }
      sendYouTubeAudioCommands(iframe, feed);
      setTimeout(() => sendYouTubeAudioCommands(iframe, feed), 150);
    }
  });

  onMount(() => {
    window.addEventListener('message', handleWindowMessage);
    return () => {
      window.removeEventListener('message', handleWindowMessage);
    };
  });
</script>

<div bind:this={streamWallEl} id="stream-wall" class="stream-wall">
  {#each [0, 1, 2, 3] as i (i)}
    {@const videoId = getPaneVideoId(i)}
    {@const feed = getNormalizedFeed(i)}
    {@const embedUrl = buildEmbedUrl(feed, platform.isIOS)}
    <div class="stream-pane" data-video-id={videoId}>
      {#if embedUrl}
        {#key videoId}
          <iframe
            bind:this={iframeEls[i]}
            use:bindIframeAction={i}
            class="stream-frame"
            src={embedUrl}
            title={`${grid.name} — Pane ${i + 1} (${SLOT_POSITIONS[i]}) YouTube Live Feed`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowfullscreen
            referrerpolicy="strict-origin-when-cross-origin"
          ></iframe>
        {/key}

        {#if platform.isTouchMobile}
          <button
            type="button"
            class="pane-audio-btn"
            aria-pressed={paneUnmuted[i] ? 'true' : 'false'}
            aria-label={`Pane ${i + 1} (${SLOT_POSITIONS[i]}) sound`}
            onclick={() => togglePaneAudio(i)}
          >
            <svg
              class="icon-unmuted"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
            </svg>
            <svg
              class="icon-muted"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
              <line x1="23" y1="9" x2="17" y2="15"></line>
              <line x1="17" y1="9" x2="23" y2="15"></line>
            </svg>
          </button>
        {/if}
      {:else}
        <div class="empty-pane">
          <span class="empty-pane-badge">{i + 1}</span>
          <p class="empty-pane-label">
            Pane {i + 1} ({SLOT_POSITIONS[i]}) — No feed URL provided
          </p>
          {#if !readOnly}
            <button type="button" class="empty-pane-btn" onclick={() => onConfigureSlot(i)}>
              Add Feed URL
            </button>
          {/if}
        </div>
      {/if}
    </div>
  {/each}
</div>
