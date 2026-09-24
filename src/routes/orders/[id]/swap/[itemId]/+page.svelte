<script lang="ts">
  import { untrack } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { searchItems, filterItems, getUniqueBrands, loadCatalogue } from '$lib/catalogue';
  import { fetchOrderItems, swapOrderItem } from '$lib/claims';
  import SearchFilter from '$lib/components/SearchFilter.svelte';
  import { safeRedirect } from '$lib/redirect';
  import {
    formatPrice,
    formatCaseSize,
    calculateCasePriceGross,
    calculateUnitPriceGross,
  } from '$lib/format';
  import type { ParsedCatalogueItem } from '$shared/csv';
  import type { EnrichedOrderItem } from '$shared/types';
  import type { LayoutData } from '../../$types';

  let { data }: { data: LayoutData } = $props();

  const ITEMS_PER_PAGE = 20;

  let searchQuery = $state('');
  let organicOnly = $state(false);
  let onOfferOnly = $state(false);
  let selectedBrand = $state('');
  let allItems = $state<ParsedCatalogueItem[]>([]);
  let orderItemsList = $state<EnrichedOrderItem[]>([]);
  let loading = $state(false);
  let error = $state('');
  let submitting = $state(false);

  let selectedTarget = $state<ParsedCatalogueItem | null>(null);

  let itemId = $derived($page.params.itemId);
  // Where to go once the swap is done or cancelled — callers such as the
  // Submission page pass `?return=` so the organiser lands back where they were.
  let returnTo = $derived(
    safeRedirect($page.url.searchParams.get('return')) ?? `/orders/${data.orderId}/catalogue`,
  );
  let sourceOrderItem = $derived(orderItemsList.find((oi) => oi.orderItem.id === itemId));
  let orderItemByCode = $derived(
    new Map(orderItemsList.map((oi) => [oi.orderItem.productCode, oi])),
  );

  let filteredItems = $derived.by(() => {
    let items = searchItems(allItems, searchQuery);
    items = filterItems(items, {
      organic: organicOnly || undefined,
      onOffer: onOfferOnly || undefined,
      brand: selectedBrand || undefined,
    });
    // Exclude the item we're swapping from
    const sourceCode = sourceOrderItem?.orderItem.productCode;
    return sourceCode ? items.filter((it) => it.productCode !== sourceCode) : items;
  });

  let brands = $derived(getUniqueBrands(allItems));

  let totalPages = $derived(Math.max(1, Math.ceil(filteredItems.length / ITEMS_PER_PAGE)));
  let currentPage = $derived.by(() => {
    const raw = parseInt($page.url.searchParams.get('page') ?? '1', 10);
    const n = Number.isFinite(raw) && raw >= 1 ? raw : 1;
    return Math.min(n, totalPages);
  });
  let paginatedItems = $derived(
    filteredItems.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE),
  );
  let firstItemIndex = $derived(
    filteredItems.length === 0 ? 0 : (currentPage - 1) * ITEMS_PER_PAGE + 1,
  );
  let lastItemIndex = $derived(Math.min(currentPage * ITEMS_PER_PAGE, filteredItems.length));

  function setPage(n: number) {
    const target = Math.min(Math.max(1, n), totalPages);
    const url = new URL($page.url);
    if (target <= 1) {
      url.searchParams.delete('page');
    } else {
      url.searchParams.set('page', String(target));
    }
    goto(url, { keepFocus: true, noScroll: true });
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  let lastFilterKey = '';
  $effect(() => {
    const key = `${searchQuery}|${organicOnly}|${onOfferOnly}|${selectedBrand}`;
    if (lastFilterKey !== '' && lastFilterKey !== key) {
      if ($page.url.searchParams.has('page')) {
        const url = new URL($page.url);
        url.searchParams.delete('page');
        goto(url, { keepFocus: true, noScroll: true, replaceState: true });
      }
    }
    lastFilterKey = key;
  });

  async function loadData() {
    loading = true;
    error = '';
    try {
      const [catalogueItems, items] = await Promise.all([
        loadCatalogue(data.orderId, data.order.catalogueKey),
        fetchOrderItems(data.orderId),
      ]);
      allItems = catalogueItems;
      orderItemsList = items;
    } catch (err: unknown) {
      error = (err as Error).message || 'Failed to load catalogue';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if ($page.params.id && $page.params.itemId) {
      untrack(() => loadData());
    }
  });

  function selectTarget(item: ParsedCatalogueItem) {
    selectedTarget = item;
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  async function confirmSwap() {
    if (!selectedTarget || !sourceOrderItem) return;
    submitting = true;
    error = '';
    try {
      await swapOrderItem(data.orderId, sourceOrderItem.orderItem.id, selectedTarget);
      await goto(returnTo);
    } catch (err: unknown) {
      error = (err as Error).message || 'Failed to swap item';
      submitting = false;
    }
  }

  function cancelSelection() {
    selectedTarget = null;
  }

  function unitPriceFor(item: ParsedCatalogueItem) {
    return calculateUnitPriceGross(
      item.casePrice,
      item.vatPerCase,
      item.unitsPerCase,
      item.packSize,
      item.unit,
    );
  }
</script>

<svelte:head>
  <title>Swap item — {data.order.name}</title>
</svelte:head>

<h1 class="animate-in">Swap item</h1>

{#if loading}
  <p aria-busy="true">Loading catalogue...</p>
{:else if !sourceOrderItem}
  <section>
    <p><mark>Item not found on this order.</mark></p>
    <a href="/orders/{data.orderId}/catalogue">Back to catalogue</a>
  </section>
{:else}
  <article class="current-item">
    <small>Swapping:</small>
    <strong>{sourceOrderItem.orderItem.description}</strong>
    <small>
      ({sourceOrderItem.orderItem.productCode}) &middot;
      {formatCaseSize(
        sourceOrderItem.orderItem.unitsPerCase,
        sourceOrderItem.orderItem.packSize,
        sourceOrderItem.orderItem.unit,
      )} &middot;
      {formatPrice(
        calculateCasePriceGross(
          sourceOrderItem.orderItem.casePrice,
          sourceOrderItem.orderItem.vatPerCase,
        ),
      )}/case
    </small>
    {#if sourceOrderItem.claims.length > 0}
      <p>
        <small>
          <strong>{sourceOrderItem.claims.length}</strong> claim{sourceOrderItem.claims.length !== 1
            ? 's'
            : ''} will move to the new item.
        </small>
      </p>
    {/if}
  </article>

  {#if selectedTarget}
    {@const mergeExisting = orderItemByCode.get(selectedTarget.productCode)}
    {@const unitChange = selectedTarget.unit !== sourceOrderItem.orderItem.unit}
    <section class="confirm">
      <h2>Confirm swap</h2>
      <div class="swap-diff">
        <article class="diff-side">
          <header><small>From</small></header>
          <strong>{sourceOrderItem.orderItem.description}</strong>
          <p>
            <small>
              {sourceOrderItem.orderItem.productCode} &middot;
              {formatCaseSize(
                sourceOrderItem.orderItem.unitsPerCase,
                sourceOrderItem.orderItem.packSize,
                sourceOrderItem.orderItem.unit,
              )} &middot;
              {formatPrice(
                calculateCasePriceGross(
                  sourceOrderItem.orderItem.casePrice,
                  sourceOrderItem.orderItem.vatPerCase,
                ),
              )}/case
            </small>
          </p>
          {#if sourceOrderItem.claims.length > 0}
            <ul>
              {#each sourceOrderItem.claims as claim}
                <li>
                  <small>
                    <strong>{claim.memberInitials ?? '??'}</strong>: {claim.amount}{sourceOrderItem
                      .orderItem.unit}
                    {#if claim.flexibility && claim.flexibility !== '*'}
                      ({claim.flexibility})
                    {/if}
                  </small>
                </li>
              {/each}
            </ul>
          {/if}
        </article>
        <article class="diff-side">
          <header><small>To</small></header>
          <strong>{selectedTarget.description}</strong>
          <p>
            <small>
              {selectedTarget.productCode} &middot;
              {formatCaseSize(
                selectedTarget.unitsPerCase,
                selectedTarget.packSize,
                selectedTarget.unit,
              )} &middot;
              {formatPrice(
                calculateCasePriceGross(selectedTarget.casePrice, selectedTarget.vatPerCase),
              )}/case
            </small>
          </p>
        </article>
      </div>

      {#if mergeExisting}
        <p>
          <mark>
            The target <strong>{selectedTarget.description}</strong> is already on this order with
            {mergeExisting.claims.length} claim{mergeExisting.claims.length !== 1 ? 's' : ''}.
            Swapping will merge both items — per-member amounts will be summed.
          </mark>
        </p>
      {/if}

      {#if unitChange}
        <p>
          <mark>
            The unit changes from <strong>{sourceOrderItem.orderItem.unit}</strong> to
            <strong>{selectedTarget.unit}</strong>. Claim amounts will be carried over as-is —
            please review the claims after the swap.
          </mark>
        </p>
      {/if}

      {#if error}
        <p><mark>{error}</mark></p>
      {/if}

      <div class="actions">
        <button onclick={confirmSwap} disabled={submitting}>
          {submitting ? 'Swapping…' : 'Confirm swap'}
        </button>
        <button class="outline secondary" onclick={cancelSelection} disabled={submitting}>
          Pick a different item
        </button>
        <a href={returnTo}>Cancel</a>
      </div>
    </section>
  {:else}
    <SearchFilter
      bind:query={searchQuery}
      bind:organicOnly
      bind:onOfferOnly
      bind:selectedBrand
      {brands}
    />

    <p>
      <small>
        {filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''} found{#if filteredItems.length > 0}
          &middot; showing {firstItemIndex}–{lastItemIndex}{/if}
      </small>
    </p>

    {#if error}
      <p><mark>{error}</mark></p>
    {/if}

    {#if filteredItems.length === 0}
      <section><p>No items match your search or filters.</p></section>
    {:else}
      <section class="picker">
        {#each paginatedItems as item (item.productCode)}
          {@const unitPrice = unitPriceFor(item)}
          {@const alreadyOnOrder = orderItemByCode.has(item.productCode)}
          <article class="picker-row">
            <div class="picker-info">
              <strong>{item.description}</strong>
              {#if item.onOffer}
                <mark class="badge-offer">On offer</mark>
              {/if}
              {#if item.organic}
                <mark class="badge-organic">Organic</mark>
              {/if}
              {#if alreadyOnOrder}
                <mark>Already on order — will merge</mark>
              {/if}
              <p>
                <small>
                  {item.productCode} &middot;
                  {formatCaseSize(item.unitsPerCase, item.packSize, item.unit)} &middot;
                  {formatPrice(calculateCasePriceGross(item.casePrice, item.vatPerCase))}/case
                  &middot;
                  {formatPrice(unitPrice.price)}/{unitPrice.perUnit}
                </small>
              </p>
            </div>
            <button class="outline" onclick={() => selectTarget(item)}> Swap to this </button>
          </article>
        {/each}
      </section>

      {#if totalPages > 1}
        <nav class="pagination" aria-label="Pagination">
          <button
            class="outline"
            onclick={() => setPage(currentPage - 1)}
            disabled={currentPage <= 1}
          >
            ← Previous
          </button>
          <span>Page {currentPage} of {totalPages}</span>
          <button
            class="outline"
            onclick={() => setPage(currentPage + 1)}
            disabled={currentPage >= totalPages}
          >
            Next →
          </button>
        </nav>
      {/if}
    {/if}

    <p>
      <a href={returnTo}>Cancel and go back</a>
    </p>
  {/if}
{/if}

<style>
  .current-item {
    padding: var(--space-3);
    margin-bottom: var(--space-4);
  }

  .picker-row {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    justify-content: space-between;
  }

  .picker-row .picker-info {
    flex: 1;
    min-width: 0;
  }

  .picker-row button {
    margin-bottom: 0;
    flex-shrink: 0;
  }

  .swap-diff {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
  }

  @media (max-width: 600px) {
    .swap-diff {
      grid-template-columns: 1fr;
    }
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }

  .actions button {
    margin-bottom: 0;
    width: auto;
  }

  .pagination {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
    margin-top: var(--space-4);
  }

  .pagination button {
    margin-bottom: 0;
    width: auto;
  }

  .pagination span {
    color: var(--text-secondary);
    font-size: var(--text-sm);
    white-space: nowrap;
  }
</style>
