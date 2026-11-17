<script lang="ts">
  import DeleteUserModal from '$lib/components/DeleteUserModal.svelte';
  import UserFormModal from '$lib/components/UserFormModal.svelte';
  import type { AuthUser } from '$lib/types';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let users = $state<AuthUser[]>([]);
  let statusMessage = $state('');
  let statusTimer: ReturnType<typeof setTimeout> | null = null;
  let userFormModal: UserFormModal | undefined = $state();
  let deleteUserModal: DeleteUserModal | undefined = $state();

  $effect(() => {
    users = data.users;
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

  function handleSaved(saved: AuthUser, isEdit: boolean) {
    if (isEdit) {
      users = users.map((u) => (u.id === saved.id ? saved : u));
      showStatusBanner(`Updated user "${saved.username}".`);
    } else {
      users = [...users, saved];
      showStatusBanner(`Created user "${saved.username}".`);
    }
  }

  function handleDeleted(removed: AuthUser) {
    users = users.filter((u) => u.id !== removed.id);
    showStatusBanner(`Deleted user "${removed.username}".`);
  }
</script>

<svelte:head>
  <title>Administration — GridTube</title>
</svelte:head>

<section class="landing-view" aria-labelledby="admin-heading">
  <header class="site-header">
    <div class="brand-group">
      <div class="brand-logo" aria-hidden="true">
        <span class="logo-pane logo-pane-1"></span>
        <span class="logo-pane logo-pane-2"></span>
        <span class="logo-pane logo-pane-3"></span>
        <span class="logo-pane logo-pane-4"></span>
      </div>
      <div>
        <h1 id="admin-heading" class="site-title">Administration</h1>
        <p class="site-subtitle">Manage user accounts and roles</p>
      </div>
    </div>

    <div class="header-actions">
      <a href="/" class="btn btn-secondary">Back to Grids</a>
      <button
        type="button"
        id="add-user-btn"
        class="btn btn-primary"
        onclick={() => userFormModal?.openCreate()}
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
        <span>Add User</span>
      </button>
    </div>
  </header>

  {#if statusMessage}
    <div class="status-banner" role="status" aria-live="polite">
      {statusMessage}
    </div>
  {/if}

  <section aria-label="User directory">
    {#if users.length > 0}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div tabindex="0" role="region" aria-labelledby="users-table-caption" class="table-wrapper panel-card table-panel">
        <table class="users-table">
          <caption id="users-table-caption" class="visually-hidden">
            Users list excluding your own account
          </caption>
          <thead>
            <tr>
              <th scope="col">Username</th>
              <th scope="col">Role</th>
              <th scope="col" class="actions-col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {#each users as managedUser (managedUser.id)}
              <tr>
                <th scope="row" class="user-name-cell">{managedUser.username}</th>
                <td class="user-role-cell">
                  <span class={`role-badge role-badge-${managedUser.role}`}>{managedUser.role}</span>
                </td>
                <td class="user-actions-cell">
                  <div class="card-actions">
                    <button
                      type="button"
                      class="icon-btn"
                      aria-label={`Edit ${managedUser.username}`}
                      onclick={() => userFormModal?.openEdit(managedUser)}
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
                      aria-label={`Delete ${managedUser.username}`}
                      onclick={() => deleteUserModal?.open(managedUser)}
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
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <div class="empty-state">
        <h2>No other users yet</h2>
        <p>Add user accounts so others can manage their own private stream grids.</p>
        <button
          type="button"
          class="btn btn-primary"
          onclick={() => userFormModal?.openCreate()}
        >
          Add First User
        </button>
      </div>
    {/if}
  </section>
</section>

<UserFormModal bind:this={userFormModal} onSaved={handleSaved} />
<DeleteUserModal bind:this={deleteUserModal} onDeleted={handleDeleted} />
