<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { deleteUserApi } from '$lib/client/api';
  import { closeTopLayer, wireDialogBehavior } from '$lib/client/dialog-helpers';
  import type { AuthUser } from '$lib/types';

  interface Props {
    onDeleted: (user: AuthUser) => Promise<void> | void;
  }

  let { onDeleted }: Props = $props();

  let dialogEl: HTMLDialogElement | undefined = $state();
  let cancelBtnEl: HTMLButtonElement | undefined = $state();
  let targetUser: AuthUser | null = $state(null);
  let deleting = $state(false);
  let errorMsg = $state('');
  let unbindDialog: (() => void) | null = null;

  export async function open(user: AuthUser): Promise<void> {
    if (!dialogEl) return;
    targetUser = user;
    errorMsg = '';
    dialogEl.showModal();
    await tick();
    cancelBtnEl?.focus();
  }

  export function close(): Promise<void> {
    return closeTopLayer(dialogEl ?? null);
  }

  async function handleConfirm() {
    if (!targetUser) return;
    const userToDelete = targetUser;
    deleting = true;
    errorMsg = '';
    try {
      await deleteUserApi(userToDelete.id);
      targetUser = null;
      await close();
      await onDeleted(userToDelete);
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : 'Failed to delete user.';
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
  id="delete-user-modal"
  class="modal-dialog modal-dialog-compact"
  closedby="any"
  aria-labelledby="delete-user-modal-title"
>
  <div class="modal-header">
    <h2 id="delete-user-modal-title" class="modal-title">Delete User?</h2>
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
      Are you sure you want to delete <strong>{targetUser ? targetUser.username : ''}</strong>? All grids belonging to this user will also be deleted.
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
      id="confirm-delete-user-btn"
      class="btn btn-danger"
      disabled={deleting}
      onclick={handleConfirm}
    >
      {deleting ? 'Deleting...' : 'Delete User'}
    </button>
  </div>
</dialog>
