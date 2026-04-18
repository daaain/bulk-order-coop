<script lang="ts">
  import { untrack } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { searchItems, filterItems, getUniqueBrands, loadCatalogue } from '$lib/catalogue';
  import {
    fetchOrderItems,
    addItemToOrder,
    createClaim,
    updateClaim,
    removeClaim,
  } from '$lib/claims';
  import SearchFilter from '$lib/components/SearchFilter.svelte';
  import ItemCard from '$lib/components/ItemCard.svelte';
  import { useAuth } from '$lib/auth.svelte';
  import type { ParsedCatalogueItem } from '$shared/csv';
  import type { EnrichedOrderItem } from '$shared/types';
  import type { LayoutData } from '../$types';

  let { data }: { data: LayoutData } = $props();

  const auth = useAuth();

  const ITEMS_PER_PAGE = 20;

  let searchQuery = $state('');
  let organicOnly = $state(false);
  let onOfferOnly = $state(false);
  let selectedBrand = $state('');
  let allItems = $state<ParsedCatalogueItem[]>([]);
  let orderItemsList = $state<EnrichedOrderItem[]>([]);
  let loading = $state(false);
  let error = $state('');

  let orderItemMap = $derived(new Map(orderItemsList.map((oi) => [oi.orderItem.productCode, oi])));

  let filteredItems = $derived.by(() => {
    let items = searchItems(allItems, searchQuery);
    items = filterItems(items, {
      organic: organicOnly || undefined,
      onOffer: onOfferOnly || undefined,
      brand: selectedBrand || undefined,
    });
    return items;
  });

  let brands = $derived(getUniqueBrands(allItems));
  let orderOpen = $derived(data.order.status === 'open');

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

  // Reset to page 1 whenever search/filter inputs change.
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

  async function refreshOrderItems() {
    try {
      orderItemsList = await fetchOrderItems(data.orderId);
    } catch {
      // silently fail — user will see stale data
    }
  }

  async function handleAddToOrder(item: ParsedCatalogueItem) {
    try {
      await addItemToOrder(data.orderId, item);
      await refreshOrderItems();
    } catch (err: unknown) {
      error = (err as Error).message || 'Failed to add item';
    }
  }

  async function handleClaim(itemId: string, amount: number, flexibility: string) {
    await createClaim(data.orderId, itemId, amount, flexibility);
    await refreshOrderItems();
  }

  async function handleUpdateClaim(itemId: string, amount: number, flexibility: string) {
    await updateClaim(data.orderId, itemId, amount, flexibility);
    await refreshOrderItems();
  }

  async function handleRemoveClaim(itemId: string) {
    await removeClaim(data.orderId, itemId);
    await refreshOrderItems();
  }

  $effect(() => {
    if ($page.params.id) {
      untrack(() => loadData());
    }
  });
</script>

<svelte:head>
  <title>Catalogue — {data.order.name}</title>
</svelte:head>

<h1 class="animate-in">Catalogue</h1>

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

{#if loading}
  <p aria-busy="true">Loading catalogue...</p>
{:else if error}
  <p><mark>{error}</mark></p>
{:else if allItems.length === 0}
  <section>
    <p>No catalogue loaded. This order may not have a catalogue assigned yet.</p>
  </section>
{:else if filteredItems.length === 0}
  <section>
    <p>No items match your search or filters.</p>
  </section>
{:else}
  <section>
    {#each paginatedItems as item (item.productCode)}
      <ItemCard
        {item}
        orderItem={orderItemMap.get(item.productCode)}
        currentMemberId={auth.user?.id ?? ''}
        orderId={data.orderId}
        {orderOpen}
        onaddtoorder={() => handleAddToOrder(item)}
        onclaim={handleClaim}
        onupdateclaim={handleUpdateClaim}
        onremoveclaim={handleRemoveClaim}
      />
    {/each}
  </section>

  {#if totalPages > 1}
    <nav class="pagination" aria-label="Catalogue pagination">
      <button
        class="outline"
        onclick={() => setPage(currentPage - 1)}
        disabled={currentPage <= 1}
        aria-label="Previous page"
      >
        ← Previous
      </button>
      <span aria-live="polite">
        Page {currentPage} of {totalPages}
      </span>
      <button
        class="outline"
        onclick={() => setPage(currentPage + 1)}
        disabled={currentPage >= totalPages}
        aria-label="Next page"
      >
        Next →
      </button>
    </nav>
  {/if}
{/if}

<style>
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
