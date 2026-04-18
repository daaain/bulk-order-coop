<script lang="ts">
  import {
    fetchMyClaims,
    fetchOrderItems,
    createClaim,
    updateClaim,
    removeClaim,
    removeItemFromOrder,
  } from '$lib/claims';
  import { formatPrice, formatCaseSize, calculateCasePriceGross, calculateUnitPriceGross, getCaseIncrement } from '$lib/format';
  import ClaimForm from '$lib/components/ClaimForm.svelte';
  import RoundingBar from '$lib/components/RoundingBar.svelte';
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
  let claimingItemId = $state<string | null>(null);
  let saving = $state(false);

  // Organiser claim editing state
  let editingClaimKey = $state<string | null>(null); // "itemId:memberId"
  let claimingForItemId = $state<string | null>(null); // item where organiser is adding claim for another member
  let selectedMemberId = $state('');

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

  async function handleRemoveItem(itemId: string) {
    try {
      await removeItemFromOrder(data.orderId, itemId);
      await loadData();
    } catch (err: unknown) {
      error = (err as Error).message || 'Failed to remove item';
    }
  }

  async function handleOrderItemClaim(
    oi: EnrichedOrderItem,
    amount: number,
    flexibility: string,
    memberId?: string,
  ) {
    saving = true;
    try {
      const packaged = isPackaged(oi.catalogueItem.unitsPerCase);
      const apiAmount = packaged ? toNatural(amount, oi.catalogueItem.packSize) : amount;
      const targetId = memberId ?? currentMemberId;
      const existingClaim = oi.claims.find((c) => c.memberId === targetId);
      if (existingClaim) {
        await updateClaim(data.orderId, oi.orderItem.id, apiAmount, flexibility, memberId);
      } else {
        await createClaim(data.orderId, oi.orderItem.id, apiAmount, flexibility, memberId);
      }
      claimingItemId = null;
      editingClaimKey = null;
      claimingForItemId = null;
      selectedMemberId = '';
      await loadData();
    } catch (err: unknown) {
      error = (err as Error).message || 'Failed to save claim';
    } finally {
      saving = false;
    }
  }

  async function handleOrderItemRemoveClaim(itemId: string, memberId?: string) {
    try {
      await removeClaim(data.orderId, itemId, memberId);
      editingClaimKey = null;
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
          &middot; {formatPrice(calculateCasePriceGross(oi.catalogueItem.casePrice, oi.catalogueItem.vatPerCase))}/case &middot; {formatPrice(
            unitPrice.price,
          )}/{unitPrice.perUnit}
        </p>
        {#if oi.claims.length > 0}
          <p>
            <small>
              {#each oi.claims as claim, i}
                {#if i > 0},
                {/if}
                {#if isOrganiser && canEdit}
                  <button
                    class="claim-chip"
                    onclick={() => {
                      editingClaimKey = editingClaimKey === `${oi.orderItem.id}:${claim.memberId}`
                        ? null
                        : `${oi.orderItem.id}:${claim.memberId}`;
                      claimingItemId = null;
                      claimingForItemId = null;
                    }}
                  >
                    <strong>{claim.memberInitials ?? '??'}</strong>: {formatClaimAmount(
                      claim.amount,
                      oi.catalogueItem.unitsPerCase,
                      oi.catalogueItem.packSize,
                      oi.catalogueItem.unit,
                    )}{#if claim.flexibility && claim.flexibility !== '*'}{flexShortLabels[
                        claim.flexibility
                      ]}{/if}
                  </button>
                {:else}
                  <strong>{claim.memberInitials ?? '??'}</strong>: {formatClaimAmount(
                    claim.amount,
                    oi.catalogueItem.unitsPerCase,
                    oi.catalogueItem.packSize,
                    oi.catalogueItem.unit,
                  )}{#if claim.flexibility && claim.flexibility !== '*'}{flexShortLabels[
                      claim.flexibility
                    ]}{/if}
                {/if}
              {/each}
            </small>
          </p>

          <!-- Organiser editing another member's claim -->
          {#each oi.claims as claim}
            {#if editingClaimKey === `${oi.orderItem.id}:${claim.memberId}`}
              <div class="organiser-edit">
                <small><strong>Editing {claim.memberName ?? claim.memberInitials ?? 'member'}'s claim</strong></small>
                <ClaimForm
                  unit={oi.catalogueItem.unit}
                  {packaged}
                  caseIncrement={getCaseIncrement(oi.catalogueItem.unitsPerCase, oi.catalogueItem.packSize)}
                  initialAmount={packaged
                    ? toPacks(claim.amount, oi.catalogueItem.packSize)
                    : claim.amount}
                  initialFlexibility={claim.flexibility ?? '*'}
                  loading={saving}
                  onsubmit={(amount, flexibility) =>
                    handleOrderItemClaim(oi, amount, flexibility, claim.memberId)}
                  oncancel={() => (editingClaimKey = null)}
                />
                <ConfirmButton
                  label="Remove this claim"
                  onclick={() => handleOrderItemRemoveClaim(oi.orderItem.id, claim.memberId)}
                  class="outline secondary"
                />
              </div>
            {/if}
          {/each}
        {:else}
          <p><small>No claims yet</small></p>
        {/if}
        <RoundingBar
          rounding={oi.rounding}
          packSize={packaged ? oi.catalogueItem.packSize : undefined}
          isPackaged={packaged}
        />

        {#if canEdit}
          {#if claimingItemId === oi.orderItem.id}
            <ClaimForm
              unit={oi.catalogueItem.unit}
              {packaged}
              caseIncrement={getCaseIncrement(oi.catalogueItem.unitsPerCase, oi.catalogueItem.packSize)}
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
            <div role="group">
              <button class="outline" onclick={() => (claimingItemId = oi.orderItem.id)}>
                Add claim
              </button>
              {#if oi.claims.length === 0}
                <ConfirmButton
                  label="✕"
                  confirmLabel="Remove item?"
                  onclick={() => handleRemoveItem(oi.orderItem.id)}
                  class="outline secondary"
                />
              {/if}
            </div>
          {/if}

          <!-- Organiser: claim on behalf of another member -->
          {#if isOrganiser}
            {#if claimingForItemId === oi.orderItem.id}
              {@const claimedMemberIds = new Set(oi.claims.map((c) => c.memberId))}
              {@const availableMembers = data.order.members.filter(
                (m) => !claimedMemberIds.has(m.memberId),
              )}
              {#if availableMembers.length === 0}
                <p class="claim-for-member"><small>All members have claims on this item.</small></p>
                <button class="outline secondary" onclick={() => (claimingForItemId = null)}>
                  Cancel
                </button>
              {:else}
                <div class="organiser-edit claim-for-member">
                  <label>
                    Claim for member
                    <select bind:value={selectedMemberId}>
                      <option value="" disabled>Select member...</option>
                      {#each availableMembers as m}
                        <option value={m.memberId}>{m.name ?? m.initials ?? m.memberId}</option>
                      {/each}
                    </select>
                  </label>
                  {#if selectedMemberId}
                    <ClaimForm
                      unit={oi.catalogueItem.unit}
                      {packaged}
                      caseIncrement={getCaseIncrement(oi.catalogueItem.unitsPerCase, oi.catalogueItem.packSize)}
                      initialAmount={0}
                      initialFlexibility="*"
                      loading={saving}
                      onsubmit={(amount, flexibility) =>
                        handleOrderItemClaim(oi, amount, flexibility, selectedMemberId)}
                      oncancel={() => {
                        claimingForItemId = null;
                        selectedMemberId = '';
                      }}
                    />
                  {:else}
                    <button
                      class="outline secondary"
                      onclick={() => {
                        claimingForItemId = null;
                        selectedMemberId = '';
                      }}
                    >
                      Cancel
                    </button>
                  {/if}
                </div>
              {/if}
            {:else}
              <button
                class="outline secondary small claim-for-member"
                onclick={() => {
                  claimingForItemId = oi.orderItem.id;
                  editingClaimKey = null;
                  claimingItemId = null;
                  selectedMemberId = '';
                }}
              >
                Claim for member
              </button>
            {/if}
          {/if}
        {/if}
      </article>
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
                      caseIncrement={getCaseIncrement(mc.catalogueItem.unitsPerCase, mc.catalogueItem.packSize)}
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

  .items-grid article {
    margin-bottom: 0;
  }

  .claim-for-member {
    margin-top: var(--space-3);
  }

  .claim-chip {
    all: unset;
    cursor: pointer;
    padding: 0.1em 0.3em;
    border-radius: 4px;
    display: inline;
  }

  .claim-chip:hover {
    background: var(--pico-primary-background);
    color: var(--pico-primary-inverse);
  }

  .organiser-edit {
    margin-top: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--pico-muted-border-color);
    border-radius: var(--pico-border-radius);
  }
</style>
