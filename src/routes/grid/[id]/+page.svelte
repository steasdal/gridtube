<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { updateGridApi } from '$lib/client/api';
  import { createPlayerViewportController } from '$lib/client/ipad-viewport';
  import GridFormModal from '$lib/components/GridFormModal.svelte';
  import PlayerHud from '$lib/components/PlayerHud.svelte';
  import StreamWall from '$lib/components/StreamWall.svelte';
  import type { FeedEntry, Grid } from '$lib/types';
  import { normalizeFeedsList } from '$lib/youtube';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let grid = $derived<Grid>(data.grid);
  let playerViewEl: HTMLElement | undefined = $state();
  let streamWallEl: HTMLElement | undefined = $state();
  let hud: PlayerHud | undefined = $state();
  let formModal: GridFormModal | undefined = $state();
  let isModalOpen = $state(false);
  let isFullscreen = $state(false);
  let viewportCtrl: ReturnType<typeof createPlayerViewportController> | null = null;

  // Debounced & serialized persistence when user drags volume or mutes inside a YouTube pane
  const AUDIO_PERSIST_DEBOUNCE_MS = 350;
  let audioSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let dirtyAudioSave = false;
  let inFlightAudioSave = false;
  let audioSaveRevision = 0;

  function clearPendingAudioSave({ clearDirty = false } = {}) {
    if (audioSaveTimer) {
      clearTimeout(audioSaveTimer);
      audioSaveTimer = null;
    }
    if (clearDirty) {
      dirtyAudioSave = false;
      audioSaveRevision += 1;
    }
  }

  async function persistAudioChanges({ keepalive = false } = {}) {
    if (inFlightAudioSave) return;

    const saveRevision = audioSaveRevision;
    const gridToSave = grid;
    dirtyAudioSave = false;
    inFlightAudioSave = true;

    try {
      const updated = await updateGridApi(
        gridToSave.id,
        {
          name: gridToSave.name,
          feeds: normalizeFeedsList(gridToSave.feeds)
        },
        { keepalive }
      );
      if (audioSaveRevision === saveRevision && grid.id === updated.id) {
        grid = updated;
      }
    } catch (err) {
      console.warn('Failed to persist pane audio change:', err);
    } finally {
      inFlightAudioSave = false;
      if (dirtyAudioSave) {
        persistAudioChanges();
      }
    }
  }

  function scheduleAudioPersist() {
    clearPendingAudioSave();
    audioSaveTimer = setTimeout(() => {
      audioSaveTimer = null;
      persistAudioChanges();
    }, AUDIO_PERSIST_DEBOUNCE_MS);
  }

  function flushAudioPersist({ keepalive = false } = {}) {
    if (!audioSaveTimer && !dirtyAudioSave) return;
    clearPendingAudioSave();
    persistAudioChanges({ keepalive });
  }

  function handleLiveAudioChange(paneIndex: number, nextFeed: FeedEntry) {
    const nextFeeds = normalizeFeedsList(grid.feeds);
    nextFeeds[paneIndex] = nextFeed;
    grid = { ...grid, feeds: nextFeeds };
    audioSaveRevision += 1;
    dirtyAudioSave = true;
    scheduleAudioPersist();
  }

  function handleBack() {
    flushAudioPersist({ keepalive: true });
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    goto('/');
  }

  function handleEdit(focusFeedIndex: number | null = null) {
    flushAudioPersist();
    formModal?.openEdit(grid, focusFeedIndex);
  }

  function handleModalSaved(saved: Grid) {
    grid = saved;
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && hud?.isOpen() && !isModalOpen) {
      hud.setOpen(false, true);
      return;
    }

    const target = e.target as HTMLElement | null;
    if (
      (e.key === 'f' || e.key === 'F') &&
      !e.repeat &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      !isModalOpen &&
      !target?.closest?.('input, textarea, select, [contenteditable]') &&
      !target?.isContentEditable
    ) {
      e.preventDefault();
      toggleFullscreen();
    }
  }

  function handleFullscreenChange() {
    isFullscreen = Boolean(document.fullscreenElement);
  }

  function handlePageHide() {
    flushAudioPersist({ keepalive: true });
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      flushAudioPersist({ keepalive: true });
    }
  }

  onMount(() => {
    isFullscreen = Boolean(document.fullscreenElement);
    playerViewEl?.focus();

    if (playerViewEl && streamWallEl) {
      viewportCtrl = createPlayerViewportController({
        playerView: playerViewEl,
        streamWall: streamWallEl,
        isModalOpen: () => isModalOpen
      });
    }

    document.addEventListener('keydown', handleKeydown);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      flushAudioPersist({ keepalive: true });
      viewportCtrl?.destroy();
      document.removeEventListener('keydown', handleKeydown);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  });
</script>

<svelte:head>
  <title>{grid.name} — GridTube</title>
</svelte:head>

<section
  bind:this={playerViewEl}
  id="player-view"
  class="player-view"
  aria-labelledby="player-grid-title"
  tabindex="-1"
>
  <PlayerHud
    bind:this={hud}
    gridName={grid.name}
    {isFullscreen}
    onBack={handleBack}
    onEdit={() => handleEdit(null)}
    onToggleFullscreen={toggleFullscreen}
  />

  <StreamWall
    bind:streamWallEl
    {grid}
    isModalOpen={() => isModalOpen}
    onConfigureSlot={(idx) => handleEdit(idx)}
    onLiveAudioChange={handleLiveAudioChange}
  />
</section>

<GridFormModal
  bind:this={formModal}
  onSaved={handleModalSaved}
  onDialogOpenChange={(open) => {
    isModalOpen = open;
    if (!open) {
      viewportCtrl?.scheduleSync({ withRotationRetries: true });
    }
  }}
  onBeforeSubmitEdit={() => clearPendingAudioSave({ clearDirty: true })}
/>
