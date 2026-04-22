<script lang="ts">
  import {
    fetchMyClaims,
    fetchOrderItems,
    createClaim,
    updateClaim,
    removeClaim,
    removeItemFromOrder,
  } from '$lib/claims';
  import { formatPrice, getCaseIncrement } from '$lib/format';
  import { loadCatalogue } from '$lib/catalogue';
  import ClaimForm from '$lib/components/ClaimForm.svelte';
  import ItemCard from '$lib/components/ItemCard.svelte';
  import ConfirmButton from '$lib/components/ConfirmButton.svelte';
  import type { MyClaim, EnrichedOrderItem, RoundingStatus } from '$shared/types';
  import type { LayoutData } from '../$types';
  import { useAuth } from '$lib/auth.svelte';
  import { untrack } from 'svelte';

  let { data }: { data: LayoutData } = $props();

  const auth = useAuth();

  let claims = $state<MyClaim[]>([]);
  let orderItems = $state<EnrichedOrderItem[]>([]);
  let onOfferCodes = $state<Set<string>>(new Set());
  let totals = $state({ net: 0, vat: 0, gross: 0 });
  let loading = $state(true);
  let error = $state('');
  let editingItemId = $state<string | null>(null);
  let saving = $state(false);
  let incompleteOnly = $state(false);

  let visibleOrderItems = $derived(
    incompleteOnly ? orderItems.filter((oi) => oi.rounding.status !== 'ready') : orderItems,
  );

  let currentMemberId = $derived(auth.user?.id ?? '');
  let isOrganiser = $derived(
    data.order.members.some((m) => m.memberId === auth.user?.id && m.role === 'organiser'),
  );
  // Organisers can edit in all states except 'complete'; members only when 'open'
  let canEdit = $derived(
    isOrganiser ? data.order.status !== 'complete' : data.order.status === 'open',
  );

  const flexLabels: Record<string, string> = {
    '*': 'Exact',
    '+': 'Can take more',
    '-': 'Can take less',
    '+-': 'Flexible',
  };

  const STATUS_ORDER: RoundingStatus[] = ['ready', 'nearly', 'needs_more', 'over'];
  const statusLabels: Record<RoundingStatus, string> = {
    ready: 'Ready to order',
    nearly: 'Nearly there',
    needs_more: 'Needs more takers',
    over: 'Over — flexible members can reduce',
  };

  type ClaimGroup = { status: RoundingStatus; claims: MyClaim[]; subtotal: number };

  let statusByOrderItem = $derived(
    new Map(orderItems.map((oi) => [oi.orderItem.id, oi.rounding.status])),
  );

  let groupedClaims = $derived.by<ClaimGroup[]>(() => {
    const buckets = new Map<RoundingStatus, MyClaim[]>();
    for (const mc of claims) {
      const status = statusByOrderItem.get(mc.claim.orderItemId) ?? 'needs_more';
      const arr = buckets.get(status) ?? [];
      arr.push(mc);
      buckets.set(status, arr);
    }
    return STATUS_ORDER.filter((s) => buckets.has(s)).map((status) => {
      const groupClaims = buckets.get(status)!;
      const subtotal = groupClaims.reduce((sum, mc) => sum + mc.estimatedCost.gross, 0);
      return { status, claims: groupClaims, subtotal };
    });
  });

  function isPackaged(unitsPerCase: number | null): boolean {
    return unitsPerCase != null && unitsPerCase > 0;
  }

  function toPacks(amount: number, packSize: number): number {
    return packSize > 0 ? Math.round(amount / packSize) : amount;
  }

  function toNatural(packs: number, packSize: number): number {
    return packs * packSize;
  }

  function formatClaimAmount(
    amount: number,
    unitsPerCase: number | null,
    packSize: number,
    unit: string,
  ): string {
    if (isPackaged(unitsPerCase)) {
      const packs = toPacks(amount, packSize);
      return `${packs} pack${packs !== 1 ? 's' : ''}`;
    }
    return `${amount}${unit}`;
  }

  async function loadData() {
    const isInitialLoad = orderItems.length === 0 && claims.length === 0;
    if (isInitialLoad) loading = true;
    error = '';
    try {
      const [claimsResult, items, catalogue] = await Promise.all([
        fetchMyClaims(data.orderId),
        fetchOrderItems(data.orderId),
        loadCatalogue(data.orderId, data.order.catalogueKey).catch(() => []),
      ]);
      claims = claimsResult.claims;
      totals = claimsResult.totals;
      orderItems = items;
      onOfferCodes = new Set(catalogue.filter((c) => c.onOffer).map((c) => c.productCode));
    } catch (err: unknown) {
      error = (err as Error).message || 'Failed to load claims';
    } finally {
      loading = false;
    }
  }

  async function handleCreateClaim(
    itemId: string,
    amount: number,
    flexibility: string,
    memberId?: string,
  ) {
    try {
      await createClaim(data.orderId, itemId, amount, flexibility, memberId);
      await loadData();
    } catch (err: unknown) {
      error = (err as Error).message || 'Failed to save claim';
    }
  }

  async function handleUpdateOrderItemClaim(
    itemId: string,
    amount: number,
    flexibility: string,
    memberId?: string,
  ) {
    try {
      await updateClaim(data.orderId, itemId, amount, flexibility, memberId);
      await loadData();
    } catch (err: unknown) {
      error = (err as Error).message || 'Failed to save claim';
    }
  }

  async function handleRemoveOrderItemClaim(itemId: string, memberId?: string) {
    try {
      await removeClaim(data.orderId, itemId, memberId);
      await loadData();
    } catch (err: unknown) {
      error = (err as Error).message || 'Failed to remove claim';
    }
  }

  async function handleRemoveItem(itemId: string) {
    try {
      await removeItemFromOrder(data.orderId, itemId);
      await loadData();
    } catch (err: unknown) {
      error = (err as Error).message || 'Failed to remove item';
    }
  }

  async function handleMyClaimUpdate(mc: MyClaim, amount: number, flexibility: string) {
    saving = true;
    try {
      const apiAmount = isPackaged(mc.catalogueItem.unitsPerCase)
        ? toNatural(amount, mc.catalogueItem.packSize)
        : amount;
      await updateClaim(data.orderId, mc.claim.orderItemId, apiAmount, flexibility);
      editingItemId = null;
      await loadData();
    } catch (err: unknown) {
      error = (err as Error).message || 'Failed to update claim';
    } finally {
      saving = false;
    }
  }

  async function handleMyClaimRemove(itemId: string) {
    try {
      await removeClaim(data.orderId, itemId);
      await loadData();
    } catch (err: unknown) {
      error = (err as Error).message || 'Failed to remove claim';
    }
  }

  $effect(() => {
    if (data.orderId) {
      untrack(() => loadData());
    }
  });
</script>

<svelte:head>
  <title>Claims — {data.order.name}</title>
</svelte:head>

<h1 class="animate-in">Claims</h1>

{#if loading}
  <p aria-busy="true">Loading claims...</p>
{:else if error}
  <p><mark>{error}</mark></p>
{:else}
  <!-- Order Items section -->
  <div class="section-header">
    <h2>Order Items</h2>
    {#if orderItems.length > 0}
      <label class="filter-toggle">
        <input type="checkbox" role="switch" bind:checked={incompleteOnly} />
        Incomplete only
      </label>
    {/if}
  </div>

  {#if orderItems.length === 0}
    <p>No items have been added to this order yet.</p>
  {:else if visibleOrderItems.length === 0}
    <p>All items are ready to order.</p>
  {:else}
    <div class="items-grid">
      {#each visibleOrderItems as oi (oi.orderItem.id)}
        <ItemCard
          item={{ ...oi.catalogueItem, onOffer: onOfferCodes.has(oi.catalogueItem.productCode) }}
          orderItem={oi}
          {currentMemberId}
          {canEdit}
          {isOrganiser}
          members={data.order.members}
          onclaim={handleCreateClaim}
          onupdateclaim={handleUpdateOrderItemClaim}
          onremoveclaim={handleRemoveOrderItemClaim}
          onremoveitem={handleRemoveItem}
        />
      {/each}
    </div>
  {/if}

  <!-- My Claims section -->
  <h2>My Claims</h2>

  {#if claims.length === 0}
    <section>
      <p>You haven't claimed any items yet.</p>
      <p>
        <a href="/orders/{data.orderId}/catalogue" role="button" class="outline">Browse catalogue</a
        >
      </p>
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
            {#if canEdit}
              <th></th>
            {/if}
          </tr>
        </thead>
        {#each groupedClaims as group (group.status)}
          <tbody class="claims-group status-{group.status}">
            <tr class="group-header">
              <th colspan={canEdit ? 5 : 4}>{statusLabels[group.status]}</th>
            </tr>
            {#each group.claims as mc (mc.claim.id)}
              {@const packaged = isPackaged(mc.catalogueItem.unitsPerCase)}
              <tr class="claim-row">
                <td>{mc.catalogueItem.description}</td>
                <td>
                  {formatClaimAmount(
                    mc.claim.amount,
                    mc.catalogueItem.unitsPerCase,
                    mc.catalogueItem.packSize,
                    mc.catalogueItem.unit,
                  )}
                </td>
                <td>{flexLabels[mc.claim.flexibility ?? '*'] ?? mc.claim.flexibility}</td>
                <td>{formatPrice(mc.estimatedCost.gross)}</td>
                {#if canEdit}
                  <td>
                    {#if editingItemId === mc.claim.orderItemId}
                      <ClaimForm
                        unit={mc.catalogueItem.unit}
                        {packaged}
                        caseIncrement={getCaseIncrement(
                          mc.catalogueItem.unitsPerCase,
                          mc.catalogueItem.packSize,
                        )}
                        initialAmount={packaged
                          ? toPacks(mc.claim.amount, mc.catalogueItem.packSize)
                          : mc.claim.amount}
                        initialFlexibility={mc.claim.flexibility ?? '*'}
                        loading={saving}
                        onsubmit={(amount, flexibility) =>
                          handleMyClaimUpdate(mc, amount, flexibility)}
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
                          onclick={() => handleMyClaimRemove(mc.claim.orderItemId)}
                          class="outline secondary"
                        />
                      </div>
                    {/if}
                  </td>
                {/if}
              </tr>
            {/each}
            <tr class="group-subtotal">
              <td colspan="2"></td>
              <td><strong>Subtotal</strong></td>
              <td>{formatPrice(group.subtotal)}</td>
              {#if canEdit}<td></td>{/if}
            </tr>
          </tbody>
        {/each}
        <tfoot>
          <tr>
            <td colspan="2"></td>
            <td><strong>Total</strong></td>
            <td><strong>{formatPrice(totals.gross)}</strong></td>
            {#if canEdit}<td></td>{/if}
          </tr>
        </tfoot>
      </table>
    </figure>
  {/if}
{/if}

<style>
  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .filter-toggle {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    font-size: 0.9em;
  }

  .filter-toggle input {
    margin: 0;
  }

  .items-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
    margin-bottom: var(--space-4);
  }

  @media (min-width: 768px) {
    .items-grid {
      grid-template-columns: 1fr 1fr;
    }
  }

  .items-grid :global(article) {
    margin-bottom: 0;
  }

  .claims-group {
    --bar-colour: var(--text-muted);
  }
  .claims-group.status-ready {
    --bar-colour: var(--rounding-ready);
  }
  .claims-group.status-nearly {
    --bar-colour: var(--rounding-nearly);
  }
  .claims-group.status-needs_more {
    --bar-colour: var(--rounding-needs-more);
  }
  .claims-group.status-over {
    --bar-colour: var(--rounding-over);
  }

  .claims-group .group-header th {
    color: var(--bar-colour);
    border-bottom: 2px solid var(--bar-colour);
    padding-top: var(--space-3);
  }

  .claims-group .claim-row td:first-child {
    border-left: 3px solid var(--bar-colour);
  }

  .claims-group .group-subtotal td {
    border-top: 1px solid var(--bar-colour);
    color: var(--bar-colour);
  }
</style>
