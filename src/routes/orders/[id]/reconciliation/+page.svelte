<script lang="ts">
	import type { LayoutData } from '../$types';
	import { useAuth } from '$lib/auth.svelte';
	import { formatPrice, formatWeight, formatCaseSize } from '$lib/format';
	import { updateOrder } from '$lib/orders';
	import ConfirmButton from '$lib/components/ConfirmButton.svelte';
	import {
		fetchReconciliation,
		updateDeliveryStatus,
		generateAllocations,
		confirmAllocation,
		confirmAllMyAllocations
	} from '$lib/reconciliation';
	import type {
		ReconciliationSummary,
		ReconciliationItem,
		DeliveryStatus,
		MemberCostSummary
	} from '$shared/types';

	let { data }: { data: LayoutData } = $props();

	const auth = useAuth();

	let recon = $state<ReconciliationSummary | null>(null);
	let loading = $state(true);
	let error = $state('');
	let saving = $state(false);
	let allocating = $state(false);
	let confirming = $state(false);
	let completing = $state(false);

	const isOrganiser = $derived(
		data.order.members.some(
			(m) => m.memberId === auth.user?.id && m.role === 'organiser'
		)
	);

	const canView = $derived(
		data.order.status === 'reconciling' || data.order.status === 'complete'
	);

	const isReadOnly = $derived(data.order.status === 'complete');

	const hasAllocations = $derived(
		recon !== null && recon.memberSummaries.length > 0
	);

	const allDeliverySet = $derived(
		recon !== null && recon.items.length > 0 && recon.items.every((i) => i.delivery !== null)
	);

	const deliveryStatuses: { value: DeliveryStatus; label: string }[] = [
		{ value: 'arrived', label: 'Arrived' },
		{ value: 'missing', label: 'Missing' },
		{ value: 'partial', label: 'Partial' },
		{ value: 'different_price', label: 'Different price' }
	];

	const statusColours: Record<DeliveryStatus, string> = {
		arrived: '#d4edda',
		missing: '#f8d7da',
		partial: '#fff3cd',
		different_price: '#fff3cd'
	};

	let debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

	async function loadReconciliation() {
		loading = true;
		error = '';
		try {
			recon = await fetchReconciliation(data.orderId);
		} catch (err: unknown) {
			error = (err as Error).message || 'Failed to load reconciliation data';
		} finally {
			loading = false;
		}
	}

	function handleDeliveryChange(itemId: string, item: ReconciliationItem) {
		const existing = debounceTimers.get(itemId);
		if (existing) clearTimeout(existing);

		debounceTimers.set(
			itemId,
			setTimeout(() => saveDelivery(itemId, item), 500)
		);
	}

	async function saveDelivery(itemId: string, item: ReconciliationItem) {
		if (!item.delivery) return;
		saving = true;
		error = '';
		try {
			await updateDeliveryStatus(data.orderId, itemId, {
				status: item.delivery.status,
				actualQuantity: item.delivery.status === 'partial' ? item.delivery.actualQuantity : null,
				actualPrice: item.delivery.status === 'different_price' ? item.delivery.actualPrice : null,
				notes: item.delivery.notes
			});
		} catch (err: unknown) {
			error = (err as Error).message || 'Failed to save delivery status';
		} finally {
			saving = false;
		}
	}

	async function markAllArrived() {
		if (!recon) return;
		saving = true;
		error = '';
		try {
			for (const item of recon.items) {
				if (!item.delivery || item.delivery.status !== 'arrived') {
					await updateDeliveryStatus(data.orderId, item.orderItem.id, {
						status: 'arrived'
					});
				}
			}
			await loadReconciliation();
		} catch (err: unknown) {
			error = (err as Error).message || 'Failed to mark all as arrived';
		} finally {
			saving = false;
		}
	}

	async function handleGenerateAllocations() {
		allocating = true;
		error = '';
		try {
			await generateAllocations(data.orderId);
			await loadReconciliation();
		} catch (err: unknown) {
			error = (err as Error).message || 'Failed to generate allocations';
		} finally {
			allocating = false;
		}
	}

	async function handleConfirm(allocationId: string) {
		confirming = true;
		error = '';
		try {
			await confirmAllocation(data.orderId, allocationId);
			await loadReconciliation();
		} catch (err: unknown) {
			error = (err as Error).message || 'Failed to confirm allocation';
		} finally {
			confirming = false;
		}
	}

	async function handleConfirmAll() {
		confirming = true;
		error = '';
		try {
			await confirmAllMyAllocations(data.orderId);
			await loadReconciliation();
		} catch (err: unknown) {
			error = (err as Error).message || 'Failed to confirm allocations';
		} finally {
			confirming = false;
		}
	}

	async function handleMarkComplete() {
		completing = true;
		error = '';
		try {
			await updateOrder(data.orderId, { status: 'complete' });
			location.reload();
		} catch (err: unknown) {
			error = (err as Error).message || 'Failed to mark order complete';
		} finally {
			completing = false;
		}
	}

	function setDeliveryStatus(item: ReconciliationItem, status: DeliveryStatus) {
		if (!item.delivery) {
			item.delivery = {
				orderItemId: item.orderItem.id,
				status,
				actualPrice: null,
				actualQuantity: null,
				notes: null
			};
		} else {
			item.delivery.status = status;
		}
		handleDeliveryChange(item.orderItem.id, item);
	}

	function myAllocations(summary: MemberCostSummary): boolean {
		return summary.memberId === auth.user?.id;
	}

	$effect(() => {
		if (data.orderId && canView) {
			loadReconciliation();
		}
	});
</script>

<svelte:head>
	<title>Reconciliation — {data.order.name}</title>
</svelte:head>

<h1>Reconciliation</h1>

{#if !canView}
	<section>
		<p>This order is not yet in reconciliation. The organiser needs to advance the order status to "Reconciling" first.</p>
	</section>
{:else if loading}
	<p aria-busy="true">Loading reconciliation data...</p>
{:else if error}
	<p><mark>{error}</mark></p>
{:else if recon}
	<!-- Delivery status table -->
	<section>
		<hgroup>
			<h2>Delivery status</h2>
			<p>Record what actually arrived for each item</p>
		</hgroup>

		{#if !isReadOnly}
			<div style="margin-bottom: 1rem;">
				<button
					class="outline"
					onclick={markAllArrived}
					disabled={saving}
					aria-busy={saving}
				>
					Mark all as arrived
				</button>
			</div>
		{/if}

		<figure>
			<table>
				<thead>
					<tr>
						<th>Item</th>
						<th>Case size</th>
						<th>Claimed</th>
						<th>Status</th>
						<th>Actual qty</th>
						<th>Actual price</th>
						<th>Notes</th>
					</tr>
				</thead>
				<tbody>
					{#each recon.items as item (item.orderItem.id)}
						{@const bgColour = item.delivery ? statusColours[item.delivery.status] : 'transparent'}
						<tr style="background: {bgColour};">
							<td>{item.catalogueItem.description}</td>
							<td>{formatCaseSize(item.catalogueItem.unitsPerCase, item.catalogueItem.packSize, item.catalogueItem.unit)}</td>
							<td>{item.rounding.totalClaimed}{item.catalogueItem.unit}</td>
							<td>
								{#if isReadOnly}
									{item.delivery?.status ?? '–'}
								{:else}
									<select
										value={item.delivery?.status ?? ''}
										onchange={(e) => setDeliveryStatus(item, (e.target as HTMLSelectElement).value as DeliveryStatus)}
										style="margin-bottom: 0; min-width: 8rem;"
									>
										<option value="" disabled>Select...</option>
										{#each deliveryStatuses as ds (ds.value)}
											<option value={ds.value}>{ds.label}</option>
										{/each}
									</select>
								{/if}
							</td>
							<td>
								{#if item.delivery?.status === 'partial'}
									{#if isReadOnly}
										{item.delivery.actualQuantity ?? '–'}
									{:else}
										<input
											type="number"
											min="0.1"
											step="any"
											bind:value={item.delivery.actualQuantity}
											onchange={() => handleDeliveryChange(item.orderItem.id, item)}
											style="margin-bottom: 0; width: 6rem;"
										/>
									{/if}
								{:else}
									–
								{/if}
							</td>
							<td>
								{#if item.delivery?.status === 'different_price'}
									{#if isReadOnly}
										{item.delivery.actualPrice ? formatPrice(item.delivery.actualPrice) : '–'}
									{:else}
										<input
											type="number"
											min="0.01"
											step="0.01"
											bind:value={item.delivery.actualPrice}
											onchange={() => handleDeliveryChange(item.orderItem.id, item)}
											style="margin-bottom: 0; width: 6rem;"
										/>
									{/if}
								{:else}
									–
								{/if}
							</td>
							<td>
								{#if isReadOnly}
									{item.delivery?.notes ?? ''}
								{:else}
									<input
										type="text"
										value={item.delivery?.notes ?? ''}
										oninput={(e) => {
											if (item.delivery) {
												item.delivery.notes = (e.target as HTMLInputElement).value || null;
												handleDeliveryChange(item.orderItem.id, item);
											}
										}}
										placeholder="Optional notes"
										style="margin-bottom: 0; min-width: 8rem;"
									/>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</figure>

		{#if saving}
			<small aria-busy="true">Saving...</small>
		{/if}
	</section>

	<!-- Generate allocations button -->
	{#if !isReadOnly && isOrganiser && allDeliverySet && !hasAllocations}
		<section>
			<button
				onclick={handleGenerateAllocations}
				disabled={allocating}
				aria-busy={allocating}
			>
				Generate allocations
			</button>
		</section>
	{/if}

	{#if !isReadOnly && isOrganiser && allDeliverySet && hasAllocations}
		<section>
			<button
				class="outline"
				onclick={handleGenerateAllocations}
				disabled={allocating}
				aria-busy={allocating}
			>
				Regenerate allocations
			</button>
			<small>This will recalculate all allocations based on current delivery statuses.</small>
		</section>
	{/if}

	<!-- Allocations per member -->
	{#if hasAllocations}
		<section>
			<h2>Allocations</h2>

			{#each recon.memberSummaries as summary (summary.memberId)}
				{@const isMine = myAllocations(summary)}
				<details open={isMine}>
					<summary>
						<strong>{summary.memberName ?? summary.memberInitials ?? 'Unknown'}</strong>
						— {formatPrice(summary.totals.gross)}
						{#if summary.allConfirmed}
							<mark style="background: #2ecc40; color: white; padding: 0.1em 0.4em; border-radius: 4px; margin-left: 0.5rem;">
								Confirmed
							</mark>
						{/if}
					</summary>

					<figure>
						<table>
							<thead>
								<tr>
									<th>Item</th>
									<th>Claimed</th>
									<th>Allocated</th>
									<th>Net</th>
									<th>VAT</th>
									<th>Gross</th>
									<th>Status</th>
								</tr>
							</thead>
							<tbody>
								{#each summary.items as alloc (alloc.orderItemId)}
									<tr>
										<td>{alloc.description}</td>
										<td>{alloc.claimed}</td>
										<td>
											{alloc.allocated}
											{#if alloc.allocated !== alloc.claimed}
												<small style="color: var(--pico-del-color);">
													({alloc.allocated > alloc.claimed ? '+' : ''}{(alloc.allocated - alloc.claimed).toFixed(1)})
												</small>
											{/if}
										</td>
										<td>{formatPrice(alloc.net)}</td>
										<td>{formatPrice(alloc.vat)}</td>
										<td>{formatPrice(alloc.gross)}</td>
										<td>
											{#if alloc.confirmed}
												Confirmed
											{:else if isMine && !isReadOnly}
												{@const reconItem = recon?.items.find((i) => i.orderItem.id === alloc.orderItemId)}
												{@const allocation = reconItem?.allocations.find((a) => a.memberId === summary.memberId)}
												{#if allocation}
													<button
														class="outline"
														onclick={() => handleConfirm(allocation.id)}
														disabled={confirming}
														style="padding: 0.2em 0.6em; font-size: 0.85em;"
													>
														Confirm
													</button>
												{/if}
											{:else}
												Pending
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
							<tfoot>
								<tr>
									<td colspan="3"></td>
									<td><strong>{formatPrice(summary.totals.net)}</strong></td>
									<td><strong>{formatPrice(summary.totals.vat)}</strong></td>
									<td><strong>{formatPrice(summary.totals.gross)}</strong></td>
									<td></td>
								</tr>
							</tfoot>
						</table>
					</figure>

					{#if isMine && !isReadOnly && !summary.allConfirmed}
						<button
							onclick={handleConfirmAll}
							disabled={confirming}
							aria-busy={confirming}
						>
							Confirm all my allocations
						</button>
					{/if}
				</details>
			{/each}
		</section>

		<!-- Summary footer -->
		<section>
			<h2>Order totals</h2>
			<figure>
				<table>
					<thead>
						<tr>
							<th>Member</th>
							<th>Net</th>
							<th>VAT</th>
							<th>Gross</th>
							<th>Status</th>
						</tr>
					</thead>
					<tbody>
						{#each recon.memberSummaries as summary (summary.memberId)}
							<tr>
								<td>{summary.memberName ?? summary.memberInitials ?? 'Unknown'}</td>
								<td>{formatPrice(summary.totals.net)}</td>
								<td>{formatPrice(summary.totals.vat)}</td>
								<td>{formatPrice(summary.totals.gross)}</td>
								<td>
									{#if summary.allConfirmed}
										<mark style="background: #2ecc40; color: white; padding: 0.1em 0.4em; border-radius: 4px;">
											Confirmed
										</mark>
									{:else}
										Pending
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
					<tfoot>
						<tr>
							<td><strong>Total</strong></td>
							<td><strong>{formatPrice(recon.orderTotals.net)}</strong></td>
							<td><strong>{formatPrice(recon.orderTotals.vat)}</strong></td>
							<td><strong>{formatPrice(recon.orderTotals.gross)}</strong></td>
							<td></td>
						</tr>
					</tfoot>
				</table>
			</figure>
		</section>

		{#if isOrganiser && !isReadOnly && recon.allConfirmed}
			<section>
				<ConfirmButton
					label="Mark order complete"
					onclick={handleMarkComplete}
					disabled={completing}
				/>
			</section>
		{/if}
	{/if}
{/if}
