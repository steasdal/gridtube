<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { deleteGridApi } from '$lib/client/api';
  import { closeTopLayer, wireDialogBehavior } from '$lib/client/dialog-helpers';
  import type { Grid } from '$lib/types';

  interface Props {
    onDeleted: (grid: Grid) => Promise<void> | void;
  }

  let { onDeleted }: Props = $props();

  let dialogEl: HTMLDialogElement | undefined = $state();
  let cancelBtnEl: HTMLButtonElement | undefined = $state();
  let targetGrid: Grid | null = $state(null);
  let deleting = $state(false);
  let errorMsg = $state('');
  let unbindDialog: (() => void) | null = null;

  export async function open(grid: Grid): Promise<void> {
    if (!dialogEl) return;
    targetGrid = grid;
    errorMsg = '';
    dialogEl.showModal();
    await tick();
    cancelBtnEl?.focus();
  }

  export function close(): Promise<void> {
    return closeTopLayer(dialogEl ?? null);
  }

  async function handleConfirm() {
    if (!targetGrid) return;
    const gridToDelete = targetGrid;
    deleting = true;
    errorMsg = '';
    try {
      await deleteGridApi(gridToDelete.id);
      targetGrid = null;
      await close();
      await onDeleted(gridToDelete);
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : 'Failed to delete grid.';
    } finally {
      deleting = false;
    }
  }

  onMount(() => {
    if (dialogEl) {
      unbindDialog = wireDialogBehavior(dialogEl);
    }
    return () => {
      unbindDialog?.();
    };
  });
</script>

<dialog
  bind:this={dialogEl}
  id="delete-modal"
  class="modal-dialog modal-dialog-compact"
  closedby="any"
  aria-labelledby="delete-modal-title"
>
  <div class="modal-header">
    <h2 id="delete-modal-title" class="modal-title">Delete Named Grid?</h2>
    <button
      type="button"
      class="icon-btn"
      aria-label="Close confirmation modal"
      onclick={() => close()}
    >
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

  <div class="modal-body">
    <p class="delete-confirm-text">
      Are you sure you want to delete <strong>{targetGrid ? `"${targetGrid.name}"` : ''}</strong>? This action cannot be undone.
    </p>
    {#if errorMsg}
      <div class="form-server-error" role="alert">{errorMsg}</div>
    {/if}
  </div>

  <div class="modal-actions">
    <button
      bind:this={cancelBtnEl}
      type="button"
      class="btn btn-secondary"
      onclick={() => close()}
    >
      Cancel
    </button>
    <button
      type="button"
      id="confirm-delete-btn"
      class="btn btn-danger"
      disabled={deleting}
      onclick={handleConfirm}
    >
      Delete Grid
    </button>
  </div>
</dialog>
