<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { formatDisplayUsername } from '$lib/auth';
  import { loginApi } from '$lib/client/api';
  import GridCard from '$lib/components/GridCard.svelte';
  import PasswordInput from '$lib/components/PasswordInput.svelte';
  import type { PublicGrid } from '$lib/types';

  interface Props {
    redirectTo?: string;
    version?: string | null;
    publicGrids?: PublicGrid[];
  }

  let { redirectTo = '/', version = null, publicGrids = [] }: Props = $props();

  let username = $state('');
  let password = $state('');
  let errorMsg = $state('');
  let submitting = $state(false);
  let usernameInputEl: HTMLInputElement | undefined = $state();

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    const cleanUsername = username.trim();
    if (!cleanUsername || !password) {
      errorMsg = 'Enter both your username and password.';
      usernameInputEl?.focus();
      return;
    }

    submitting = true;
    errorMsg = '';
    try {
      await loginApi({ username: cleanUsername, password });
      if (redirectTo && redirectTo !== '/') {
        await goto(redirectTo, { invalidateAll: true });
      } else {
        await invalidateAll();
      }
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : 'Unable to sign in.';
    } finally {
      submitting = false;
    }
  }

  function openPublicGrid(gridId: string) {
    goto(`/grid/${encodeURIComponent(gridId)}`);
  }
</script>

{#snippet loginCard()}
  <div class="auth-card">
    <div class="auth-brand">
      <div class="brand-logo" aria-hidden="true">
        <span class="logo-pane logo-pane-1"></span>
        <span class="logo-pane logo-pane-2"></span>
        <span class="logo-pane logo-pane-3"></span>
        <span class="logo-pane logo-pane-4"></span>
      </div>
      <div>
        <h1 id="login-heading" class="site-title">GridTube</h1>
        <p class="site-subtitle">Sign in to view your live stream grids</p>
      </div>
    </div>

    <form id="login-form" method="post" onsubmit={handleSubmit} class="auth-form">
      <div class="field">
        <label for="login-username">Username</label>
        <input
          bind:this={usernameInputEl}
          id="login-username"
          name="username"
          type="text"
          bind:value={username}
          autocomplete="username"
          autocorrect="off"
          autocapitalize="none"
          spellcheck={false}
          enterkeyhint="next"
          required
        />
      </div>

      <div class="field">
        <label for="login-password">Password</label>
        <PasswordInput
          id="login-password"
          name="password"
          bind:value={password}
          autocomplete="current-password"
          enterkeyhint="done"
          required
        />
      </div>

      {#if errorMsg}
        <div id="login-error" class="form-server-error" role="alert">{errorMsg}</div>
      {/if}

      <button type="submit" id="login-submit-btn" class="btn btn-primary auth-submit-btn" disabled={submitting}>
        {submitting ? 'Signing in...' : 'Sign In'}
      </button>
    </form>
  </div>
{/snippet}

{#if publicGrids.length > 0}
  <section class="landing-view auth-landing-with-public" aria-labelledby="login-heading">
    <div class="auth-top-panel">
      {@render loginCard()}
    </div>

    <hr class="landing-divider" />

    <section id="public-grids-section" class="grids-section" aria-labelledby="public-grids-heading">
      <h2 id="public-grids-heading" class="public-grids-heading">Public Grids</h2>
      <ul id="public-grids-list" class="grids-list">
        {#each publicGrids as grid (grid.id)}
          <GridCard
            {grid}
            subtitle={`provided by ${formatDisplayUsername(grid.ownerUsername)}`}
            onOpen={openPublicGrid}
          />
        {/each}
      </ul>
    </section>

    {#if version}
      <footer class="landing-footer">
        <a
          id="app-version"
          class="landing-version"
          href="https://github.com/steasdal/gridtube"
          target="_blank"
          rel="noopener noreferrer"
        >
          Version {version}
        </a>
      </footer>
    {/if}
  </section>
{:else}
  <section class="auth-shell" aria-labelledby="login-heading">
    {@render loginCard()}

    {#if version}
      <footer class="landing-footer">
        <a
          id="app-version"
          class="landing-version"
          href="https://github.com/steasdal/gridtube"
          target="_blank"
          rel="noopener noreferrer"
        >
          Version {version}
        </a>
      </footer>
    {/if}
  </section>
{/if}
