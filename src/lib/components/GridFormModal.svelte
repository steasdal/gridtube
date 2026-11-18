<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { createGridApi, updateGridApi } from '$lib/client/api';
  import {
    closeTopLayer,
    createFormValidationController,
    wireDialogBehavior,
    type FormValidationController
  } from '$lib/client/dialog-helpers';
  import type { FeedEntry, Grid } from '$lib/types';
  import { normalizeFeedEntry, SLOT_LABELS, YOUTUBE_URL_INPUT_PATTERN } from '$lib/youtube';

  interface Props {
    onSaved: (grid: Grid, isEdit: boolean) => Promise<void> | void;
    onDialogOpenChange?: (open: boolean) => void;
    onBeforeSubmitEdit?: (gridId: string) => void;
    canPublish?: boolean;
  }

  let { onSaved, onDialogOpenChange, onBeforeSubmitEdit, canPublish = false }: Props = $props();

  let dialogEl: HTMLDialogElement | undefined = $state();
  let formEl: HTMLFormElement | undefined = $state();
  let nameInputEl: HTMLInputElement | undefined = $state();
  let urlInputEls: Array<HTMLInputElement | undefined> = $state([
    undefined,
    undefined,
    undefined,
    undefined
  ]);

  let editingGridId = $state('');
  let modalTitle = $state('Add New Stream Grid');
  let submitLabel = $state('Save Grid');
  let gridName = $state('');
  let feedUrls = $state(['', '', '', '']);
  let feedVolumes = $state([100, 100, 100, 100]);
  let feedMuted = $state([false, false, false, false]);
  let lastNonZeroVolume = [100, 100, 100, 100];
  let isPublic = $state(false);
  let serverError = $state('');
  let saving = $state(false);

  let validationCtrl: FormValidationController | null = null;
  let unbindDialog: (() => void) | null = null;

  function setAudioState(idx: number, volume: number, muted: boolean) {
    const clampedVol = Math.max(0, Math.min(100, Math.round(Number(volume) || 0)));
    const isMuted = Boolean(muted);
    if (clampedVol > 0) {
      lastNonZeroVolume[idx] = clampedVol;
    }
    feedVolumes[idx] = clampedVol;
    feedMuted[idx] = isMuted;
  }

  function handleMuteToggle(idx: number) {
    if (feedMuted[idx]) {
      const currentVol = feedVolumes[idx];
      const restoredVol = currentVol === 0 ? lastNonZeroVolume[idx] || 100 : currentVol;
      setAudioState(idx, restoredVol, false);
    } else {
      setAudioState(idx, feedVolumes[idx], true);
    }
  }

  function handleVolumeInput(idx: number, rawValue: string) {
    const val = Number(rawValue);
    if (val === 0) {
      setAudioState(idx, 0, true);
    } else {
      setAudioState(idx, val, false);
    }
  }

  export async function openCreate(): Promise<void> {
    if (!dialogEl) return;
    editingGridId = '';
    gridName = '';
    feedUrls = ['', '', '', ''];
    lastNonZeroVolume = [100, 100, 100, 100];
    for (let i = 0; i < 4; i++) {
      setAudioState(i, 100, false);
    }
    modalTitle = 'Add New Stream Grid';
    submitLabel = 'Create Grid';
    isPublic = false;
    serverError = '';
    validationCtrl?.reset();
    onDialogOpenChange?.(true);
    dialogEl.showModal();
    await tick();
    nameInputEl?.focus();
  }

  export async function openEdit(grid: Grid, focusFeedIndex: number | null = null): Promise<void> {
    if (!dialogEl) return;
    editingGridId = grid.id;
    gridName = grid.name;
    lastNonZeroVolume = [100, 100, 100, 100];
    const feeds = Array.isArray(grid.feeds) ? grid.feeds : [];
    const nextUrls = ['', '', '', ''];
    for (let i = 0; i < 4; i++) {
      const feed = normalizeFeedEntry(feeds[i]);
      nextUrls[i] = feed.url;
      setAudioState(i, feed.volume, feed.muted);
    }
    feedUrls = nextUrls;
    modalTitle = `Edit "${grid.name}"`;
    submitLabel = 'Save Changes';
    isPublic = Boolean(grid.isPublic);
    serverError = '';
    validationCtrl?.reset();
    onDialogOpenChange?.(true);
    dialogEl.showModal();
    await tick();
    if (typeof focusFeedIndex === 'number' && urlInputEls[focusFeedIndex]) {
      urlInputEls[focusFeedIndex]?.focus();
    } else {
      nameInputEl?.focus();
    }
  }

  export function close(): Promise<void> {
    return closeTopLayer(dialogEl ?? null);
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    serverError = '';

    if (formEl && !formEl.checkValidity()) {
      const firstInvalid = formEl.querySelector(':invalid') as HTMLElement | null;
      firstInvalid?.focus();
      return;
    }

    const isEdit = Boolean(editingGridId);
    const feeds: FeedEntry[] = [0, 1, 2, 3].map((i) => ({
      url: feedUrls[i].trim(),
      volume: feedVolumes[i],
      muted: feedMuted[i]
    }));
    const payload = {
      name: gridName.trim(),
      feeds,
      ...(canPublish ? { isPublic } : {})
    };

    saving = true;
    if (isEdit) {
      onBeforeSubmitEdit?.(editingGridId);
    }

    try {
      const saved = isEdit
        ? await updateGridApi(editingGridId, payload)
        : await createGridApi(payload);
      await close();
      await onSaved(saved, isEdit);
    } catch (err) {
      serverError = err instanceof Error ? err.message : 'Could not save grid.';
    } finally {
      saving = false;
    }
  }

  onMount(() => {
    if (dialogEl) {
      unbindDialog = wireDialogBehavior(dialogEl);
      dialogEl.addEventListener('close', handleNativeClose);
    }
    if (formEl) {
      validationCtrl = createFormValidationController(formEl);
    }
    return () => {
      dialogEl?.removeEventListener('close', handleNativeClose);
      unbindDialog?.();
      validationCtrl?.destroy();
    };
  });

  function handleNativeClose() {
    onDialogOpenChange?.(false);
  }
</script>

<dialog
  bind:this={dialogEl}
  id="grid-modal"
  class="modal-dialog"
  closedby="any"
  aria-labelledby="grid-modal-title"
>
  <div class="modal-header">
    <h2 id="grid-modal-title" class="modal-title">{modalTitle}</h2>
    <button type="button" class="icon-btn" aria-label="Close modal" onclick={() => close()}>
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </button>
  </div>

  <form bind:this={formEl} id="grid-form" class="modal-form" onsubmit={handleSubmit} novalidate>
    <div class="field">
      <label for="grid-name-input">Grid Name <span aria-hidden="true">*</span></label>
      <span id="grid-name-hint" class="hint">
        Give your 2×2 grid a memorable name (e.g., choo-choos).
      </span>
      <input
        bind:this={nameInputEl}
        bind:value={gridName}
        type="text"
        id="grid-name-input"
        name="name"
        required
        maxlength="80"
        aria-describedby="grid-name-hint"
        data-error="grid-name-error"
        enterkeyhint="next"
      />
      <div id="grid-name-error" class="error-msg">
        <span role="img" aria-label="Error">❌</span> Please enter a name for this grid (1–80 characters).
      </div>
    </div>

    <fieldset class="feeds-fieldset" aria-describedby="feeds-group-hint">
      <legend>2×2 Stream Feed URLs</legend>
      <p id="feeds-group-hint" class="fieldset-hint">
        Paste up to four YouTube live stream or video URLs. Leave any slot blank to render an empty box in that pane.
        <span class="hint">Format: https://www.youtube.com/watch?v=... (or youtu.be / live link)</span>
      </p>

      <div class="feeds-inputs-grid">
        {#each [0, 1, 2, 3] as idx (idx)}
          <div class="field">
            <label for={`feed-url-${idx}`}>
              <span class="pane-badge" aria-hidden="true">{idx + 1}</span>
              {SLOT_LABELS[idx]} URL
            </label>
            <div class="feed-input-row">
              <input
                bind:this={urlInputEls[idx]}
                bind:value={feedUrls[idx]}
                type="text"
                id={`feed-url-${idx}`}
                name={`feed${idx}`}
                inputmode="url"
                autocorrect="off"
                autocapitalize="none"
                spellcheck="false"
                pattern={YOUTUBE_URL_INPUT_PATTERN}
                data-error={`feed-error-${idx}`}
                enterkeyhint={idx === 3 ? 'done' : 'next'}
              />
              <div class="volume-control">
                <button
                  type="button"
                  id={`feed-mute-${idx}`}
                  class="mute-btn"
                  aria-pressed={feedMuted[idx] ? 'true' : 'false'}
                  aria-label={feedMuted[idx] ? `Unmute ${SLOT_LABELS[idx]}` : `Mute ${SLOT_LABELS[idx]}`}
                  onclick={() => handleMuteToggle(idx)}
                >
                  <svg
                    class="icon-unmuted"
                    width="18"
                    height="18"
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
                    width="18"
                    height="18"
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
                <input
                  type="range"
                  id={`feed-vol-${idx}`}
                  class="volume-slider"
                  min="0"
                  max="100"
                  step="1"
                  value={feedVolumes[idx]}
                  style={`--attr-min: 0; --attr-max: 100; --control-value: ${feedVolumes[idx]};`}
                  aria-label={`${SLOT_LABELS[idx]} volume`}
                  aria-valuetext={feedMuted[idx] ? `${feedVolumes[idx]}% (Muted)` : `${feedVolumes[idx]}%`}
                  oninput={(e) => handleVolumeInput(idx, (e.currentTarget as HTMLInputElement).value)}
                />
                <span id={`feed-vol-text-${idx}`} class="volume-text" aria-hidden="true">
                  {feedMuted[idx] ? 'Muted' : `${feedVolumes[idx]}%`}
                </span>
              </div>
            </div>
            <div id={`feed-error-${idx}`} class="error-msg">
              <span role="img" aria-label="Error">❌</span> Enter a valid YouTube URL (e.g., https://www.youtube.com/watch?v=...) or leave blank.
            </div>
          </div>
        {/each}
      </div>
    </fieldset>

    {#if canPublish}
      <div class="field field-checkbox">
        <label class="checkbox-toggle" for="grid-public-checkbox">
          <input
            id="grid-public-checkbox"
            name="isPublic"
            type="checkbox"
            bind:checked={isPublic}
          />
          <span>Public grid</span>
        </label>
        <span class="hint">Display this grid on the landing page for non-logged-in visitors.</span>
      </div>
    {/if}

    {#if serverError}
      <div id="form-server-error" class="form-server-error" role="alert">
        {serverError}
      </div>
    {/if}

    <div class="modal-actions">
      <button type="button" class="btn btn-secondary" onclick={() => close()}>Cancel</button>
      <button type="submit" id="save-grid-btn" class="btn btn-primary" disabled={saving}>
        {submitLabel}
      </button>
    </div>
  </form>
</dialog>
