<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Grid } from '$lib/types';
  import { buildThumbnailUrl } from '$lib/youtube';

  interface Props {
    grid: Grid;
    subtitle: string;
    onOpen: (gridId: string) => void;
    footerRight?: Snippet;
  }

  let { grid, subtitle, onOpen, footerRight }: Props = $props();
</script>

<li class="grid-card">
  <button
    type="button"
    class="card-launch-btn"
    aria-label={`Open ${grid.name} stream grid`}
    onclick={() => onOpen(grid.id)}
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
      <button type="button" class="card-title-btn" onclick={() => onOpen(grid.id)}>
        {grid.name}
      </button>
      <span class="card-count">{subtitle}</span>
    </div>

    {#if footerRight}
      {@render footerRight()}
    {/if}
  </div>
</li>
