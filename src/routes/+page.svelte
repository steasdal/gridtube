<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { onMount } from 'svelte';
  import { logoutApi } from '$lib/client/api';
  import DeleteConfirmModal from '$lib/components/DeleteConfirmModal.svelte';
  import GridFormModal from '$lib/components/GridFormModal.svelte';
  import LoginView from '$lib/components/LoginView.svelte';
  import type { Grid } from '$lib/types';
  import { buildThumbnailUrl } from '$lib/youtube';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let grids = $state<Grid[]>([]);
  let statusMessage = $state('');
  let statusTimer: ReturnType<typeof setTimeout> | null = null;
  let loggingOut = $state(false);
  let formModal: GridFormModal | undefined = $state();
  let deleteModal: DeleteConfirmModal | undefined = $state();

  async function handleLogout() {
    loggingOut = true;
    try {
      await logoutApi();
      await invalidateAll();
    } catch (err) {
      showStatusBanner(err instanceof Error ? err.message : 'Unable to log out.');
    } finally {
      loggingOut = false;
    }
  }

  $effect(() => {
    grids = data.grids;
  });

  function showStatusBanner(message: string) {
    statusMessage = message;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      if (statusMessage === message) {
        statusMessage = '';
      }
    }, 4000);
  }

  function countActiveFeeds(grid: Grid): number {
    const feeds = Array.isArray(grid.feeds) ? grid.feeds : [];
    let count = 0;
    for (let i = 0; i < 4; i++) {
      if (buildThumbnailUrl(feeds[i])) count++;
    }
    return count;
  }

  function openGrid(gridId: string) {
    goto(`/grid/${encodeURIComponent(gridId)}`);
  }

  function handleSaved(saved: Grid, isEdit: boolean) {
    if (isEdit) {
      grids = grids.map((g) => (g.id === saved.id ? saved : g));
      showStatusBanner(`Updated grid "${saved.name}".`);
    } else {
      grids = [...grids, saved];
      showStatusBanner(`Created grid "${saved.name}".`);
    }
  }

  function handleDeleted(removed: Grid) {
    grids = grids.filter((g) => g.id !== removed.id);
    showStatusBanner(`Deleted grid "${removed.name}".`);
  }

  onMount(() => {
    // Support bookmarks using the legacy #/grid/<id> hash format
    if (window.location.hash.startsWith('#/grid/')) {
      const id = decodeURIComponent(window.location.hash.slice('#/grid/'.length));
      if (id) {
        goto(`/grid/${encodeURIComponent(id)}`, { replaceState: true });
      }
    }
  });
</script>

<svelte:head>
  <title>GridTube — 2×2 YouTube Live Stream Wall</title>
</svelte:head>

{#if !data.user}
  <LoginView redirectTo={data.redirectTo} version={data.version} />
{:else}
<section id="landing-view" class="landing-view" aria-labelledby="landing-heading">
  <header class="site-header">
    <div class="brand-group">
      <div class="brand-logo" aria-hidden="true">
        <span class="logo-pane logo-pane-1"></span>
        <span class="logo-pane logo-pane-2"></span>
        <span class="logo-pane logo-pane-3"></span>
        <span class="logo-pane logo-pane-4"></span>
      </div>
      <div>
        <h1 id="landing-heading" class="site-title" tabindex="-1">GridTube</h1>
        <p class="site-subtitle">
          2x2 YouTube live stream grid utilizing maximum browser real estate
        </p>
      </div>
    </div>

    <div class="header-actions">
      <button
        type="button"
        id="new-grid-btn"
        class="btn btn-primary"
        onclick={() => formModal?.openCreate()}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.25"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
        <span>New Grid</span>
      </button>
      <a href="/profile" id="nav-profile-link" class="btn btn-secondary">Profile</a>
      {#if data.user.role === 'admin'}
        <a href="/admin" id="nav-admin-link" class="btn btn-secondary">Administration</a>
      {/if}
      <button
        type="button"
        id="logout-btn"
        class="btn btn-secondary"
        disabled={loggingOut}
        onclick={handleLogout}
      >
        {loggingOut ? 'Logging out...' : 'Log Out'}
      </button>
    </div>
  </header>

  {#if statusMessage}
    <div id="status-banner" class="status-banner" role="status" aria-live="polite">
      {statusMessage}
    </div>
  {/if}

  <section aria-label="Saved stream grids" class="grids-section">
    {#if grids.length > 0}
      <ul id="grids-list" class="grids-list">
        {#each grids as grid (grid.id)}
          {@const activeCount = countActiveFeeds(grid)}
          <li class="grid-card">
            <button
              type="button"
              class="card-launch-btn"
              aria-label={`Open ${grid.name} stream grid`}
              onclick={() => openGrid(grid.id)}
            >
              <div class="card-preview-matrix">
                {#each [0, 1, 2, 3] as i (i)}
                  {@const thumbUrl = buildThumbnailUrl(grid.feeds?.[i])}
                  <div class:preview-slot={true} class:preview-slot-empty={!thumbUrl}>
                    {#if thumbUrl}
                      <img src={thumbUrl} alt="" width="320" height="180" loading="lazy" />
                    {:else}
                      <span>Empty</span>
                    {/if}
                    <span class="preview-slot-badge" aria-hidden="true">{i + 1}</span>
                  </div>
                {/each}
              </div>
            </button>

            <div class="card-footer">
              <div class="card-meta">
                <button
                  type="button"
                  class="card-title-btn"
                  onclick={() => openGrid(grid.id)}
                >
                  {grid.name}
                </button>
                <span class="card-count">{activeCount} of 4 feeds configured</span>
              </div>

              <div class="card-actions">
                <button
                  type="button"
                  class="icon-btn"
                  aria-label={`Edit ${grid.name}`}
                  onclick={() => formModal?.openEdit(grid)}
                >
                  <svg
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
                    <path d="M12 20h9"></path>
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                  </svg>
                </button>
                <button
                  type="button"
                  class="icon-btn icon-btn-danger"
                  aria-label={`Delete ${grid.name}`}
                  onclick={() => deleteModal?.open(grid)}
                >
                  <svg
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
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path
                      d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                    ></path>
                    <line x1="10" y1="11" x2="10" y2="17"></line>
                    <line x1="14" y1="11" x2="14" y2="17"></line>
                  </svg>
                </button>
              </div>
            </div>
          </li>
        {/each}
      </ul>
    {:else}
      <div id="empty-state" class="empty-state">
        <div class="empty-state-icon" aria-hidden="true">
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="3" y="3" width="7" height="7" rx="1"></rect>
            <rect x="14" y="3" width="7" height="7" rx="1"></rect>
            <rect x="14" y="14" width="7" height="7" rx="1"></rect>
            <rect x="3" y="14" width="7" height="7" rx="1"></rect>
          </svg>
        </div>
        <h2>No stream grids yet</h2>
        <p>Create a named 2×2 grid with up to four YouTube live stream URLs to start watching.</p>
        <button
          type="button"
          id="empty-new-grid-btn"
          class="btn btn-primary"
          onclick={() => formModal?.openCreate()}
        >
          Create Your First Grid
        </button>
      </div>
    {/if}
  </section>

  {#if data.version}
    <footer class="landing-footer">
      <a
        id="app-version"
        class="landing-version"
        href="https://github.com/steasdal/gridtube"
        target="_blank"
        rel="noopener noreferrer"
      >
        Version {data.version}
      </a>
    </footer>
  {/if}
</section>

<GridFormModal bind:this={formModal} onSaved={handleSaved} />
<DeleteConfirmModal bind:this={deleteModal} onDeleted={handleDeleted} />
{/if}
