<script lang="ts">
	import { page } from '$app/stores';
	import { searchItems, filterItems, getUniqueBrands, loadCatalogue } from '$lib/catalogue';
	import {
		fetchOrderItems,
		addItemToOrder,
		createClaim,
		updateClaim,
		removeClaim
	} from '$lib/claims';
	import SearchFilter from '$lib/components/SearchFilter.svelte';
	import ItemCard from '$lib/components/ItemCard.svelte';
	import { useAuth } from '$lib/auth.svelte';
	import type { ParsedCatalogueItem } from '$shared/csv';
	import type { EnrichedOrderItem } from '$shared/types';
	import type { LayoutData } from '../$types';

	let { data }: { data: LayoutData } = $props();

	const auth = useAuth();

	let searchQuery = $state('');
	let organicOnly = $state(false);
	let selectedBrand = $state('');
	let allItems = $state<ParsedCatalogueItem[]>([]);
	let orderItemsList = $state<EnrichedOrderItem[]>([]);
	let loading = $state(false);
	let error = $state('');

	let orderItemMap = $derived(
		new Map(orderItemsList.map((oi) => [oi.orderItem.productCode, oi]))
	);

	let filteredItems = $derived.by(() => {
		let items = searchItems(allItems, searchQuery);
		items = filterItems(items, {
			organic: organicOnly || undefined,
			brand: selectedBrand || undefined
		});
		return items;
	});

	let brands = $derived(getUniqueBrands(allItems));
	let orderOpen = $derived(data.order.status === 'open');

	async function loadData() {
		loading = true;
		error = '';
		try {
			const [catalogueItems, items] = await Promise.all([
				loadCatalogue(data.order.catalogueKey),
				fetchOrderItems(data.orderId)
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
			loadData();
		}
	});
</script>

<svelte:head>
	<title>Catalogue — {data.order.name}</title>
</svelte:head>

<h1>Catalogue</h1>

<SearchFilter
	bind:query={searchQuery}
	bind:organicOnly
	bind:selectedBrand
	{brands}
/>

<p><small>{filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''} found</small></p>

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
		{#each filteredItems as item (item.productCode)}
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
{/if}
