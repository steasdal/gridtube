<script lang="ts">
  import { onMount, tick } from 'svelte';

  interface Props {
    gridName: string;
    isFullscreen: boolean;
    readOnly?: boolean;
    onBack: () => void;
    onEdit: () => void;
    onToggleFullscreen: () => void;
  }

  let {
    gridName,
    isFullscreen,
    readOnly = false,
    onBack,
    onEdit,
    onToggleFullscreen
  }: Props = $props();

  let hudEl: HTMLElement | undefined = $state();
  let toggleBtnEl: HTMLButtonElement | undefined = $state();
  let backBtnEl: HTMLButtonElement | undefined = $state();
  let open = $state(false);

  export async function setOpen(nextOpen: boolean, returnFocus = false): Promise<void> {
    open = nextOpen;
    if (nextOpen) {
      await tick();
      backBtnEl?.focus();
    } else if (returnFocus) {
      await tick();
      toggleBtnEl?.focus();
    }
  }

  export function isOpen(): boolean {
    return open;
  }

  function handlePointerDown(e: PointerEvent) {
    if (open && hudEl && !hudEl.contains(e.target as Node)) {
      setOpen(false);
    }
  }

  onMount(() => {
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  });
</script>

<header bind:this={hudEl} id="player-hud" class="player-hud" data-open={open ? 'true' : 'false'}>
  <div id="player-hud-bar" class="player-hud-bar">
    <button
      bind:this={backBtnEl}
      type="button"
      id="back-to-grids-btn"
      class="hud-btn"
      aria-label="Back to saved grids"
      onclick={() => {
        setOpen(false);
        onBack();
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.25"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <line x1="19" y1="12" x2="5" y2="12"></line>
        <polyline points="12 19 5 12 12 5"></polyline>
      </svg>
      <span>Grids</span>
    </button>

    <h2 id="player-grid-title" class="hud-title">{gridName}</h2>

    <div class="hud-actions">
      {#if !readOnly}
        <button
          type="button"
          id="edit-active-grid-btn"
          class="hud-btn"
          aria-label="Edit feeds in this grid"
          onclick={() => {
            setOpen(false);
            onEdit();
          }}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M12 20h9"></path>
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
          </svg>
          <span>Edit</span>
        </button>
      {/if}

      <button
        type="button"
        id="fullscreen-btn"
        class="hud-btn"
        aria-label="Toggle fullscreen"
        aria-keyshortcuts="f"
        onclick={onToggleFullscreen}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <polyline points="15 3 21 3 21 9"></polyline>
          <polyline points="9 21 3 21 3 15"></polyline>
          <line x1="21" y1="3" x2="14" y2="10"></line>
          <line x1="3" y1="21" x2="10" y2="14"></line>
        </svg>
        <span id="fullscreen-label">{isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}</span>
      </button>

      <button
        type="button"
        id="close-hud-btn"
        class="hud-btn hud-close-btn"
        aria-label="Hide menu"
        onclick={(e) => setOpen(false, e.detail === 0)}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.25"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <polyline points="18 15 12 9 6 15"></polyline>
        </svg>
      </button>
    </div>
  </div>

  <button
    bind:this={toggleBtnEl}
    type="button"
    id="player-hud-toggle"
    class="player-hud-tab"
    aria-expanded={open ? 'true' : 'false'}
    aria-controls="player-hud-bar"
    aria-label="Open stream menu"
    onclick={() => setOpen(true)}
  >
    <span>Menu</span>
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9"></polyline>
    </svg>
  </button>
</header>
