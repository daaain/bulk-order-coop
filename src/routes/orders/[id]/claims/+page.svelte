<script lang="ts">
	import { fetchMyClaims, updateClaim, removeClaim } from '$lib/claims';
	import { formatPrice } from '$lib/format';
	import ClaimForm from '$lib/components/ClaimForm.svelte';
	import ConfirmButton from '$lib/components/ConfirmButton.svelte';
	import type { MyClaim } from '$shared/types';
	import type { LayoutData } from '../$types';

	let { data }: { data: LayoutData } = $props();

	let claims = $state<MyClaim[]>([]);
	let totals = $state({ net: 0, vat: 0, gross: 0 });
	let loading = $state(true);
	let error = $state('');
	let editingItemId = $state<string | null>(null);
	let saving = $state(false);

	let orderOpen = $derived(data.order.status === 'open');

	const flexLabels: Record<string, string> = {
		'*': 'Exact',
		'+': 'Can take more',
		'-': 'Can take less',
		'+-': 'Flexible'
	};

	async function loadClaims() {
		loading = true;
		error = '';
		try {
			const result = await fetchMyClaims(data.orderId);
			claims = result.claims;
			totals = result.totals;
		} catch (err: unknown) {
			error = (err as Error).message || 'Failed to load claims';
		} finally {
			loading = false;
		}
	}

	async function handleUpdate(itemId: string, amount: number, flexibility: string) {
		saving = true;
		try {
			await updateClaim(data.orderId, itemId, amount, flexibility);
			editingItemId = null;
			await loadClaims();
		} catch (err: unknown) {
			error = (err as Error).message || 'Failed to update claim';
		} finally {
			saving = false;
		}
	}

	async function handleRemove(itemId: string) {
		try {
			await removeClaim(data.orderId, itemId);
			await loadClaims();
		} catch (err: unknown) {
			error = (err as Error).message || 'Failed to remove claim';
		}
	}

	$effect(() => {
		if (data.orderId) {
			loadClaims();
		}
	});
</script>

<svelte:head>
	<title>My Claims — {data.order.name}</title>
</svelte:head>

<h1>My Claims</h1>

{#if loading}
	<p aria-busy="true">Loading your claims...</p>
{:else if error}
	<p><mark>{error}</mark></p>
{:else if claims.length === 0}
	<section>
		<p>You haven't claimed any items yet.</p>
		<p><a href="/orders/{data.orderId}/catalogue" role="button" class="outline">Browse catalogue</a></p>
	</section>
{:else}
	<figure>
		<table>
			<thead>
				<tr>
					<th>Item</th>
					<th>Amount</th>
					<th>Flexibility</th>
					<th>Est. cost</th>
					{#if orderOpen}
						<th></th>
					{/if}
				</tr>
			</thead>
			<tbody>
				{#each claims as mc (mc.claim.id)}
					<tr>
						<td>{mc.catalogueItem.description}</td>
						<td>
							{mc.claim.amount}{mc.catalogueItem.unit}
						</td>
						<td>{flexLabels[mc.claim.flexibility ?? '*'] ?? mc.claim.flexibility}</td>
						<td>{formatPrice(mc.estimatedCost.gross)}</td>
						{#if orderOpen}
							<td>
								{#if editingItemId === mc.claim.orderItemId}
									<ClaimForm
										unit={mc.catalogueItem.unit}
										initialAmount={mc.claim.amount}
										initialFlexibility={mc.claim.flexibility ?? '*'}
										loading={saving}
										onsubmit={(amount, flexibility) =>
											handleUpdate(mc.claim.orderItemId, amount, flexibility)}
										oncancel={() => (editingItemId = null)}
									/>
								{:else}
									<div role="group">
										<button
											class="outline"
											onclick={() => (editingItemId = mc.claim.orderItemId)}
										>
											Edit
										</button>
										<ConfirmButton
											label="Remove"
											onclick={() => handleRemove(mc.claim.orderItemId)}
											class="outline secondary"
										/>
									</div>
								{/if}
							</td>
						{/if}
					</tr>
				{/each}
			</tbody>
			<tfoot>
				<tr>
					<td colspan="2"></td>
					<td><strong>Net</strong></td>
					<td>{formatPrice(totals.net)}</td>
					{#if orderOpen}<td></td>{/if}
				</tr>
				<tr>
					<td colspan="2"></td>
					<td><strong>VAT</strong></td>
					<td>{formatPrice(totals.vat)}</td>
					{#if orderOpen}<td></td>{/if}
				</tr>
				<tr>
					<td colspan="2"></td>
					<td><strong>Total</strong></td>
					<td><strong>{formatPrice(totals.gross)}</strong></td>
					{#if orderOpen}<td></td>{/if}
				</tr>
			</tfoot>
		</table>
	</figure>
{/if}
