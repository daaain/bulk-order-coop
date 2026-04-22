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
  import ClaimForm from '$lib/components/ClaimForm.svelte';
  import ItemCard from '$lib/components/ItemCard.svelte';
  import ConfirmButton from '$lib/components/ConfirmButton.svelte';
  import type { MyClaim, EnrichedOrderItem } from '$shared/types';
  import type { LayoutData } from '../$types';
  import { useAuth } from '$lib/auth.svelte';
  import { untrack } from 'svelte';

  let { data }: { data: LayoutData } = $props();

  const auth = useAuth();

  let claims = $state<MyClaim[]>([]);
  let orderItems = $state<EnrichedOrderItem[]>([]);
  let totals = $state({ net: 0, vat: 0, gross: 0 });
  let loading = $state(true);
  let error = $state('');
  let editingItemId = $state<string | null>(null);
  let saving = $state(false);

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
      const [claimsResult, items] = await Promise.all([
        fetchMyClaims(data.orderId),
        fetchOrderItems(data.orderId),
      ]);
      claims = claimsResult.claims;
      totals = claimsResult.totals;
      orderItems = items;
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
  <h2>Order Items</h2>

  {#if orderItems.length === 0}
    <p>No items have been added to this order yet.</p>
  {:else}
    <div class="items-grid">
      {#each orderItems as oi (oi.orderItem.id)}
        <ItemCard
          item={oi.catalogueItem}
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
        <tbody>
          {#each claims as mc (mc.claim.id)}
            {@const packaged = isPackaged(mc.catalogueItem.unitsPerCase)}
            <tr>
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
        </tbody>
        <tfoot>
          <tr>
            <td colspan="2"></td>
            <td><strong>Net</strong></td>
            <td>{formatPrice(totals.net)}</td>
            {#if canEdit}<td></td>{/if}
          </tr>
          <tr>
            <td colspan="2"></td>
            <td><strong>VAT</strong></td>
            <td>{formatPrice(totals.vat)}</td>
            {#if canEdit}<td></td>{/if}
          </tr>
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
</style>
