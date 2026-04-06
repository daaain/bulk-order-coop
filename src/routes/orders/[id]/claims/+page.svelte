<script lang="ts">
  import {
    fetchMyClaims,
    fetchOrderItems,
    createClaim,
    updateClaim,
    removeClaim,
  } from '$lib/claims';
  import { formatPrice, formatCaseSize, calculateUnitPriceGross } from '$lib/format';
  import ClaimForm from '$lib/components/ClaimForm.svelte';
  import RoundingBar from '$lib/components/RoundingBar.svelte';
  import ConfirmButton from '$lib/components/ConfirmButton.svelte';
  import type { MyClaim, EnrichedOrderItem } from '$shared/types';
  import type { LayoutData } from '../$types';
  import { useAuth } from '$lib/auth.svelte';

  let { data }: { data: LayoutData } = $props();

  const auth = useAuth();

  let claims = $state<MyClaim[]>([]);
  let orderItems = $state<EnrichedOrderItem[]>([]);
  let totals = $state({ net: 0, vat: 0, gross: 0 });
  let loading = $state(true);
  let error = $state('');
  let editingItemId = $state<string | null>(null);
  let claimingItemId = $state<string | null>(null);
  let saving = $state(false);

  let orderOpen = $derived(data.order.status === 'open');
  let currentMemberId = $derived(auth.user?.id ?? '');

  const flexLabels: Record<string, string> = {
    '*': 'Exact',
    '+': 'Can take more',
    '-': 'Can take less',
    '+-': 'Flexible',
  };

  const flexShortLabels: Record<string, string> = {
    '*': '',
    '+': '+',
    '-': '-',
    '+-': '±',
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
    loading = true;
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

  async function handleOrderItemClaim(oi: EnrichedOrderItem, amount: number, flexibility: string) {
    saving = true;
    try {
      const packaged = isPackaged(oi.catalogueItem.unitsPerCase);
      const apiAmount = packaged ? toNatural(amount, oi.catalogueItem.packSize) : amount;
      const myClaim = oi.claims.find((c) => c.memberId === currentMemberId);
      if (myClaim) {
        await updateClaim(data.orderId, oi.orderItem.id, apiAmount, flexibility);
      } else {
        await createClaim(data.orderId, oi.orderItem.id, apiAmount, flexibility);
      }
      claimingItemId = null;
      await loadData();
    } catch (err: unknown) {
      error = (err as Error).message || 'Failed to save claim';
    } finally {
      saving = false;
    }
  }

  async function handleOrderItemRemoveClaim(itemId: string) {
    try {
      await removeClaim(data.orderId, itemId);
      await loadData();
    } catch (err: unknown) {
      error = (err as Error).message || 'Failed to remove claim';
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
      loadData();
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
    {#each orderItems as oi (oi.orderItem.id)}
      {@const packaged = isPackaged(oi.catalogueItem.unitsPerCase)}
      {@const unitPrice = calculateUnitPriceGross(
        oi.catalogueItem.casePrice,
        oi.catalogueItem.vatPerCase,
        oi.catalogueItem.unitsPerCase,
        oi.catalogueItem.packSize,
        oi.catalogueItem.unit,
      )}
      {@const myClaim = oi.claims.find((c) => c.memberId === currentMemberId)}
      <article>
        <header>
          <strong>{oi.catalogueItem.description}</strong>
          {#if oi.catalogueItem.brand}
            <small> — {oi.catalogueItem.brand}</small>
          {/if}
        </header>
        <p>
          {formatCaseSize(
            oi.catalogueItem.unitsPerCase,
            oi.catalogueItem.packSize,
            oi.catalogueItem.unit,
          )}
          &middot; {formatPrice(oi.catalogueItem.casePrice)}/case &middot; {formatPrice(
            unitPrice.price,
          )}/{unitPrice.perUnit}
        </p>
        {#if oi.claims.length > 0}
          <p>
            <small>
              {#each oi.claims as claim, i}
                {#if i > 0},
                {/if}
                <strong>{claim.memberInitials ?? '??'}</strong>: {formatClaimAmount(
                  claim.amount,
                  oi.catalogueItem.unitsPerCase,
                  oi.catalogueItem.packSize,
                  oi.catalogueItem.unit,
                )}{#if claim.flexibility && claim.flexibility !== '*'}{flexShortLabels[
                    claim.flexibility
                  ]}{/if}
              {/each}
            </small>
          </p>
        {:else}
          <p><small>No claims yet</small></p>
        {/if}
        <RoundingBar
          rounding={oi.rounding}
          packSize={packaged ? oi.catalogueItem.packSize : undefined}
          isPackaged={packaged}
        />

        {#if orderOpen}
          {#if claimingItemId === oi.orderItem.id}
            <ClaimForm
              unit={oi.catalogueItem.unit}
              {packaged}
              initialAmount={myClaim
                ? packaged
                  ? toPacks(myClaim.amount, oi.catalogueItem.packSize)
                  : myClaim.amount
                : 0}
              initialFlexibility={myClaim?.flexibility ?? '*'}
              loading={saving}
              onsubmit={(amount, flexibility) => handleOrderItemClaim(oi, amount, flexibility)}
              oncancel={() => (claimingItemId = null)}
            />
          {:else if myClaim}
            <div role="group">
              <button class="outline" onclick={() => (claimingItemId = oi.orderItem.id)}>
                Edit my claim ({formatClaimAmount(
                  myClaim.amount,
                  oi.catalogueItem.unitsPerCase,
                  oi.catalogueItem.packSize,
                  oi.catalogueItem.unit,
                )})
              </button>
              <ConfirmButton
                label="Remove"
                onclick={() => handleOrderItemRemoveClaim(oi.orderItem.id)}
                class="outline secondary"
              />
            </div>
          {:else}
            <button class="outline" onclick={() => (claimingItemId = oi.orderItem.id)}>
              Add claim
            </button>
          {/if}
        {/if}
      </article>
    {/each}
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
            {#if orderOpen}
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
              {#if orderOpen}
                <td>
                  {#if editingItemId === mc.claim.orderItemId}
                    <ClaimForm
                      unit={mc.catalogueItem.unit}
                      {packaged}
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
{/if}
