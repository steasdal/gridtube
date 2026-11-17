<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { MIN_PASSWORD_LENGTH, validatePassword, validateUsername } from '$lib/auth';
  import { updateProfileApi } from '$lib/client/api';
  import PasswordInput from '$lib/components/PasswordInput.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let username = $state('');
  let usernameError = $state('');
  let usernameStatus = $state('');
  let savingUsername = $state(false);

  let currentPassword = $state('');
  let newPassword = $state('');
  let passwordError = $state('');
  let passwordStatus = $state('');
  let savingPassword = $state(false);

  $effect(() => {
    username = data.user.username;
  });

  async function handleUsernameSubmit(event: SubmitEvent) {
    event.preventDefault();
    usernameError = '';
    usernameStatus = '';

    const check = validateUsername(username);
    if (!check.ok) {
      usernameError = check.error;
      return;
    }

    savingUsername = true;
    try {
      const res = await updateProfileApi({ username: check.username });
      await invalidateAll();
      usernameStatus = `Username updated to "${res.user.username}".`;
    } catch (err) {
      usernameError = err instanceof Error ? err.message : 'Could not update username.';
    } finally {
      savingUsername = false;
    }
  }

  async function handlePasswordSubmit(event: SubmitEvent) {
    event.preventDefault();
    passwordError = '';
    passwordStatus = '';

    if (!currentPassword) {
      passwordError = 'Enter your current password.';
      return;
    }

    const check = validatePassword(newPassword, 'New password');
    if (!check.ok) {
      passwordError = check.error;
      return;
    }

    savingPassword = true;
    try {
      await updateProfileApi({
        currentPassword,
        newPassword: check.password
      });
      currentPassword = '';
      newPassword = '';
      passwordStatus = 'Password updated.';
    } catch (err) {
      passwordError = err instanceof Error ? err.message : 'Could not update password.';
    } finally {
      savingPassword = false;
    }
  }
</script>

<svelte:head>
  <title>Profile — GridTube</title>
</svelte:head>

<section class="landing-view" aria-labelledby="profile-heading">
  <header class="site-header">
    <div class="brand-group">
      <div class="brand-logo" aria-hidden="true">
        <span class="logo-pane logo-pane-1"></span>
        <span class="logo-pane logo-pane-2"></span>
        <span class="logo-pane logo-pane-3"></span>
        <span class="logo-pane logo-pane-4"></span>
      </div>
      <div>
        <h1 id="profile-heading" class="site-title">Profile</h1>
        <p class="site-subtitle">
          Signed in as <strong>{data.user.username}</strong>
          <span class={`role-badge role-badge-${data.user.role}`}>{data.user.role}</span>
        </p>
      </div>
    </div>

    <div class="header-actions">
      <a href="/" class="btn btn-secondary">Back to Grids</a>
    </div>
  </header>

  <div class="account-stack">
    <section class="panel-card" aria-labelledby="profile-username-heading">
      <h2 id="profile-username-heading" class="panel-title">Change Username</h2>
      <form method="post" onsubmit={handleUsernameSubmit} aria-labelledby="profile-username-heading">
        <div class="field">
          <label for="profile-username">Username <span aria-hidden="true">*</span></label>
          <input
            id="profile-username"
            name="username"
            type="text"
            bind:value={username}
            autocomplete="username"
            autocorrect="off"
            autocapitalize="none"
            spellcheck={false}
            enterkeyhint="done"
            required
          />
          <span class="hint">Usernames are case-insensitively unique.</span>
        </div>

        {#if usernameError}
          <div class="form-server-error" role="alert">{usernameError}</div>
        {/if}
        {#if usernameStatus}
          <div class="status-banner" role="status" aria-live="polite">{usernameStatus}</div>
        {/if}

        <div class="panel-actions">
          <button
            type="submit"
            id="save-username-btn"
            class="btn btn-primary"
            disabled={savingUsername}
          >
            {savingUsername ? 'Saving...' : 'Save Username'}
          </button>
        </div>
      </form>
    </section>

    <section class="panel-card" aria-labelledby="profile-password-heading">
      <h2 id="profile-password-heading" class="panel-title">Change Password</h2>
      <form method="post" onsubmit={handlePasswordSubmit} aria-labelledby="profile-password-heading">
        <div class="field">
          <label for="profile-current-password">Current Password <span aria-hidden="true">*</span></label>
          <PasswordInput
            id="profile-current-password"
            name="currentPassword"
            bind:value={currentPassword}
            autocomplete="current-password"
            enterkeyhint="next"
            required
          />
        </div>

        <div class="field">
          <label for="profile-new-password">New Password <span aria-hidden="true">*</span></label>
          <PasswordInput
            id="profile-new-password"
            name="newPassword"
            bind:value={newPassword}
            autocomplete="new-password"
            minlength={MIN_PASSWORD_LENGTH}
            describedBy="profile-password-hint"
            enterkeyhint="done"
            required
          />
          <span id="profile-password-hint" class="hint">
            Minimum {MIN_PASSWORD_LENGTH} characters. Any characters allowed.
          </span>
        </div>

        {#if passwordError}
          <div class="form-server-error" role="alert">{passwordError}</div>
        {/if}
        {#if passwordStatus}
          <div class="status-banner" role="status" aria-live="polite">{passwordStatus}</div>
        {/if}

        <div class="panel-actions">
          <button
            type="submit"
            id="save-password-btn"
            class="btn btn-primary"
            disabled={savingPassword}
          >
            {savingPassword ? 'Updating...' : 'Change Password'}
          </button>
        </div>
      </form>
    </section>
  </div>
</section>
