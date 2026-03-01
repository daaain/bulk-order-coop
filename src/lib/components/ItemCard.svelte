<script lang="ts">
	import type { CatalogueItem, EnrichedOrderItem } from '$shared/types';
	import { formatPrice, formatCaseSize } from '$lib/format';
	import RoundingBar from './RoundingBar.svelte';
	import ClaimForm from './ClaimForm.svelte';
	import ConfirmButton from './ConfirmButton.svelte';

	let {
		item,
		orderItem,
		currentMemberId = '',
		orderId = '',
		orderOpen = true,
		onaddtoorder,
		onclaim,
		onupdateclaim,
		onremoveclaim
	}: {
		item: CatalogueItem;
		orderItem?: EnrichedOrderItem;
		currentMemberId?: string;
		orderId?: string;
		orderOpen?: boolean;
		onaddtoorder?: (productCode: string) => void;
		onclaim?: (itemId: string, amount: number, flexibility: string) => void;
		onupdateclaim?: (itemId: string, amount: number, flexibility: string) => void;
		onremoveclaim?: (itemId: string) => void;
	} = $props();

	let showClaimForm = $state(false);
	let loading = $state(false);

	const flexLabels: Record<string, string> = {
		'*': '',
		'+': '+',
		'-': '-',
		'+-': '±'
	};

	let myClaim = $derived(
		orderItem?.claims.find((c) => c.memberId === currentMemberId)
	);

	let isOnOrder = $derived(!!orderItem);

	function handleAddToOrder() {
		onaddtoorder?.(item.productCode);
	}

	async function handleClaimSubmit(amount: number, flexibility: string) {
		if (!orderItem) return;
		loading = true;
		try {
			if (myClaim) {
				await onupdateclaim?.(orderItem.orderItem.id, amount, flexibility);
			} else {
				await onclaim?.(orderItem.orderItem.id, amount, flexibility);
			}
			showClaimForm = false;
		} finally {
			loading = false;
		}
	}

	function handleRemoveClaim() {
		if (!orderItem) return;
		onremoveclaim?.(orderItem.orderItem.id);
	}
</script>

<article>
	<header>
		<strong>{item.description}</strong>
		{#if item.organic}
			<mark>Organic</mark>
		{/if}
		{#if !item.active}
			<small><em>(inactive)</em></small>
		{/if}
	</header>

	{#if item.brand}
		<p><small>{item.brand}</small></p>
	{/if}

	<p>
		{formatCaseSize(item.unitsPerCase, item.packSize, item.unit)}
		&middot; {formatPrice(item.casePrice)}/case
		{#if item.rrp}
			&middot; RRP {formatPrice(item.rrp)}
		{/if}
	</p>

	{#if isOnOrder && orderItem}
		<!-- Claims summary -->
		{#if orderItem.claims.length > 0}
			<p>
				<small>
					{#each orderItem.claims as claim, i}
						{#if i > 0}, {/if}
						<strong>{claim.memberInitials ?? '??'}</strong>: {claim.amount}{item.unit}{#if claim.flexibility && claim.flexibility !== '*'}{flexLabels[claim.flexibility]}{/if}
					{/each}
				</small>
			</p>
		{/if}

		<RoundingBar rounding={orderItem.rounding} />

		{#if orderOpen}
			{#if showClaimForm}
				<ClaimForm
					unit={item.unit}
					initialAmount={myClaim?.amount ?? 0}
					initialFlexibility={myClaim?.flexibility ?? '*'}
					{loading}
					onsubmit={handleClaimSubmit}
					oncancel={() => (showClaimForm = false)}
				/>
			{:else if myClaim}
				<div role="group">
					<button class="outline" onclick={() => (showClaimForm = true)}>
						Edit my claim ({myClaim.amount}{item.unit})
					</button>
					<ConfirmButton
						label="Remove"
						onclick={handleRemoveClaim}
						class="outline secondary"
					/>
				</div>
			{:else}
				<button class="outline" onclick={() => (showClaimForm = true)}>
					Add claim
				</button>
			{/if}
		{/if}
	{:else if orderOpen}
		<button class="outline" onclick={handleAddToOrder}>
			Add to order
		</button>
	{/if}

	{#if item.productCode}
		<footer>
			<small>Code: {item.productCode}</small>
		</footer>
	{/if}
</article>
