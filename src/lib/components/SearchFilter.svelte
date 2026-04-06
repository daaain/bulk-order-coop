<script lang="ts">
  let {
    query = $bindable(''),
    organicOnly = $bindable(false),
    onOfferOnly = $bindable(false),
    selectedBrand = $bindable(''),
    brands = [],
  }: {
    query: string;
    organicOnly: boolean;
    onOfferOnly: boolean;
    selectedBrand: string;
    brands: string[];
  } = $props();
</script>

<div class="search-filter" role="search">
  <input
    type="search"
    bind:value={query}
    placeholder="Search products..."
    aria-label="Search products"
  />
  <fieldset>
    <label>
      <input type="checkbox" bind:checked={organicOnly} />
      Organic only
    </label>
    <label>
      <input type="checkbox" bind:checked={onOfferOnly} />
      On offer only
    </label>
    <select bind:value={selectedBrand} aria-label="Filter by brand">
      <option value="">All brands</option>
      {#each brands as brand}
        <option value={brand}>{brand}</option>
      {/each}
    </select>
  </fieldset>
</div>

<style>
  .search-filter {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
    margin-bottom: var(--space-4);
  }

  .search-filter input[type='search'] {
    flex: 1 1 200px;
    margin-bottom: 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
    color: var(--text-primary);
    font-size: var(--text-base);
  }

  .search-filter input[type='search']::placeholder {
    color: var(--text-tertiary);
  }

  fieldset {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
    align-items: center;
    border: none;
    padding: 0;
    margin: 0;
  }

  fieldset label {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: 0;
    white-space: nowrap;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  fieldset label input[type='checkbox'] {
    margin: 0;
    accent-color: var(--color-sage);
  }

  fieldset select {
    margin-bottom: 0;
    width: auto;
    min-width: 10rem;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
    color: var(--text-primary);
    font-size: var(--text-sm);
  }
</style>
