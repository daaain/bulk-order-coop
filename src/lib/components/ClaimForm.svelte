<script lang="ts">
  let {
    unit = '',
    packaged = false,
    initialAmount = 0,
    initialFlexibility = '*',
    loading = false,
    onsubmit,
    oncancel,
  }: {
    unit?: string;
    packaged?: boolean;
    initialAmount?: number;
    initialFlexibility?: string;
    loading?: boolean;
    onsubmit: (amount: number, flexibility: string) => void;
    oncancel?: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let amount = $state(initialAmount);
  // svelte-ignore state_referenced_locally
  let flexibility = $state(initialFlexibility);

  let step = $derived(
    packaged ? 1 : unit === 'kg' || unit === 'l' || unit === 'g' || unit === 'ml' ? 0.1 : 1,
  );
  let amountLabel = $derived(packaged ? 'Packs' : `Amount${unit ? ` (${unit})` : ''}`);
</script>

<form
  onsubmit={(e) => {
    e.preventDefault();
    onsubmit(amount, flexibility);
  }}
>
  <label>
    {amountLabel}
    <input
      type="number"
      bind:value={amount}
      min={packaged ? 1 : step}
      {step}
      required
      disabled={loading}
    />
  </label>

  <fieldset>
    <legend>Flexibility</legend>
    <label>
      <input type="radio" bind:group={flexibility} value="*" disabled={loading} />
      Exact only
    </label>
    <label>
      <input type="radio" bind:group={flexibility} value="+" disabled={loading} />
      Can take more
    </label>
    <label>
      <input type="radio" bind:group={flexibility} value="-" disabled={loading} />
      Can take less
    </label>
    <label>
      <input type="radio" bind:group={flexibility} value="+-" disabled={loading} />
      Flexible either way
    </label>
  </fieldset>

  <div role="group">
    <button type="submit" disabled={loading} aria-busy={loading}> Save claim </button>
    {#if oncancel}
      <button type="button" class="secondary" onclick={oncancel} disabled={loading}>
        Cancel
      </button>
    {/if}
  </div>
</form>

<style>
  form {
    margin-top: var(--space-2);
  }

  fieldset {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-4);
    margin-bottom: var(--space-2);
  }

  fieldset label {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    margin-bottom: 0;
  }

  fieldset legend {
    margin-bottom: var(--space-1);
  }
</style>
