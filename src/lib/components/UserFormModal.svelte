<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { MIN_PASSWORD_LENGTH, validatePassword, validateUsername } from '$lib/auth';
  import { createUserApi, updateUserApi } from '$lib/client/api';
  import { closeTopLayer, wireDialogBehavior } from '$lib/client/dialog-helpers';
  import PasswordInput from '$lib/components/PasswordInput.svelte';
  import type { AuthUser, UserRole } from '$lib/types';

  interface Props {
    onSaved: (user: AuthUser, isEdit: boolean) => Promise<void> | void;
  }

  let { onSaved }: Props = $props();

  let dialogEl: HTMLDialogElement | undefined = $state();
  let usernameInputEl: HTMLInputElement | undefined = $state();

  let editingUser: AuthUser | null = $state(null);
  let username = $state('');
  let role = $state<UserRole>('user');
  let password = $state('');
  let errorMsg = $state('');
  let saving = $state(false);
  let unbindDialog: (() => void) | null = null;

  export async function openCreate(): Promise<void> {
    if (!dialogEl) return;
    editingUser = null;
    username = '';
    role = 'user';
    password = '';
    errorMsg = '';
    dialogEl.showModal();
    await tick();
    usernameInputEl?.focus();
  }

  export async function openEdit(user: AuthUser): Promise<void> {
    if (!dialogEl) return;
    editingUser = user;
    username = user.username;
    role = user.role;
    password = '';
    errorMsg = '';
    dialogEl.showModal();
    await tick();
    usernameInputEl?.focus();
  }

  export function close(): Promise<void> {
    return closeTopLayer(dialogEl ?? null);
  }

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    errorMsg = '';

    const usernameCheck = validateUsername(username);
    if (!usernameCheck.ok) {
      errorMsg = usernameCheck.error;
      usernameInputEl?.focus();
      return;
    }

    const isEdit = Boolean(editingUser);
    if (!isEdit || password.length > 0) {
      const passwordCheck = validatePassword(password, 'Password');
      if (!passwordCheck.ok) {
        errorMsg = passwordCheck.error;
        return;
      }
    }

    saving = true;
    try {
      const result = editingUser
        ? await updateUserApi(editingUser.id, {
            username: usernameCheck.username,
            role,
            ...(password.length > 0 ? { password } : {})
          })
        : await createUserApi({
            username: usernameCheck.username,
            password,
            role
          });

      await close();
      await onSaved(result.user, isEdit);
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : 'Unable to save user.';
    } finally {
      saving = false;
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
  id="user-form-modal"
  class="modal-dialog modal-dialog-compact"
  closedby="any"
  aria-labelledby="user-modal-title"
>
  <div class="modal-header">
    <h2 id="user-modal-title" class="modal-title">
      {editingUser ? `Edit User "${editingUser.username}"` : 'Add New User'}
    </h2>
    <button
      type="button"
      class="icon-btn"
      aria-label="Close user dialog"
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

  <form class="modal-form" method="post" onsubmit={handleSubmit}>
    <div class="field">
      <label for="managed-username">Username <span aria-hidden="true">*</span></label>
      <input
        bind:this={usernameInputEl}
        id="managed-username"
        name="username"
        type="text"
        bind:value={username}
        autocomplete="off"
        autocorrect="off"
        autocapitalize="none"
        spellcheck={false}
        enterkeyhint="next"
        required
      />
    </div>

    <fieldset class="role-fieldset">
      <legend>Role</legend>
      <div class="role-options">
        <label class="role-option">
          <input type="radio" name="role" value="user" bind:group={role} />
          <span>User</span>
        </label>
        <label class="role-option">
          <input type="radio" name="role" value="admin" bind:group={role} />
          <span>Admin</span>
        </label>
      </div>
    </fieldset>

    <div class="field">
      <label for="managed-password">
        {editingUser ? 'New Password' : 'Password'}
        {#if !editingUser}<span aria-hidden="true">*</span>{/if}
      </label>
      <PasswordInput
        id="managed-password"
        name="password"
        bind:value={password}
        autocomplete="new-password"
        required={!editingUser}
        minlength={!editingUser || password.length > 0 ? MIN_PASSWORD_LENGTH : undefined}
        describedBy="managed-password-hint"
        enterkeyhint="done"
      />
      <span id="managed-password-hint" class="hint">
        {#if editingUser}
          Leave blank to keep existing password. Minimum {MIN_PASSWORD_LENGTH} characters if changing.
        {:else}
          Minimum {MIN_PASSWORD_LENGTH} characters. Any characters allowed.
        {/if}
      </span>
    </div>

    {#if errorMsg}
      <div class="form-server-error" role="alert">{errorMsg}</div>
    {/if}

    <div class="modal-actions">
      <button type="button" class="btn btn-secondary" onclick={() => close()}>Cancel</button>
      <button type="submit" id="save-user-btn" class="btn btn-primary" disabled={saving}>
        {saving ? 'Saving...' : editingUser ? 'Save Changes' : 'Create User'}
      </button>
    </div>
  </form>
</dialog>
