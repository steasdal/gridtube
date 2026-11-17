<script lang="ts">
  import '../app.css';
  import { onNavigate } from '$app/navigation';
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();

  onNavigate((navigation) => {
    if (!document.startViewTransition) return;
    if (navigation.from?.url.pathname === navigation.to?.url.pathname) return;

    return new Promise<void>((resolve) => {
      document.startViewTransition(async () => {
        resolve();
        await navigation.complete;
      });
    });
  });
</script>

<main id="app-root">
  {@render children()}
</main>
