<script lang="ts">
  interface Props {
    id: string;
    name: string;
    value?: string;
    autocomplete: 'current-password' | 'new-password';
    required?: boolean;
    minlength?: number;
    maxlength?: number;
    describedBy?: string;
    enterkeyhint?: 'done' | 'next' | 'go';
  }

  let {
    id,
    name,
    value = $bindable(''),
    autocomplete,
    required = false,
    minlength,
    maxlength,
    describedBy,
    enterkeyhint = 'done'
  }: Props = $props();

  let visible = $state(false);
</script>

<div class="password-input-wrap">
  <input
    {id}
    {name}
    type={visible ? 'text' : 'password'}
    bind:value
    {autocomplete}
    {required}
    {minlength}
    {maxlength}
    {enterkeyhint}
    autocorrect="off"
    autocapitalize="none"
    spellcheck={false}
    aria-describedby={describedBy}
  />
  <button
    type="button"
    class="password-toggle-btn"
    aria-pressed={visible}
    aria-label={visible ? 'Hide password' : 'Show password'}
    aria-describedby={`${id}-toggle-warning`}
    onclick={() => (visible = !visible)}
  >
    {#if visible}
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
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"></path>
        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"></path>
        <line x1="1" y1="1" x2="23" y2="23"></line>
      </svg>
    {:else}
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
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
        <circle cx="12" cy="12" r="3"></circle>
      </svg>
    {/if}
  </button>
  <span id={`${id}-toggle-warning`} class="visually-hidden">
    Warning: this will display your password on the screen.
  </span>
</div>
