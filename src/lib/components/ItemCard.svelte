<script lang="ts">
  import type { CatalogueItem, EnrichedOrderItem, OrderMember } from '$shared/types';
  import {
    formatPrice,
    formatCaseSize,
    calculateCasePriceGross,
    calculateUnitPriceGross,
    getCaseIncrement,
  } from '$lib/format';
  import RoundingBar from './RoundingBar.svelte';
  import ClaimForm from './ClaimForm.svelte';
  import ConfirmButton from './ConfirmButton.svelte';

  let {
    item,
    orderItem,
    currentMemberId = '',
    canEdit = true,
    isOrganiser = false,
    members = [],
    onaddtoorder,
    onclaim,
    onupdateclaim,
    onremoveclaim,
    onremoveitem,
  }: {
    item: CatalogueItem;
    orderItem?: EnrichedOrderItem;
    currentMemberId?: string;
    canEdit?: boolean;
    isOrganiser?: boolean;
    members?: OrderMember[];
    onaddtoorder?: () => void;
    onclaim?: (itemId: string, amount: number, flexibility: string, memberId?: string) => void;
    onupdateclaim?: (
      itemId: string,
      amount: number,
      flexibility: string,
      memberId?: string,
    ) => void;
    onremoveclaim?: (itemId: string, memberId?: string) => void;
    onremoveitem?: (itemId: string) => void;
  } = $props();

  let showClaimForm = $state(false);
  let loading = $state(false);
  // Organiser-mode state
  let editingOtherMemberId = $state<string | null>(null);
  let claimingForMember = $state(false);
  let selectedMemberId = $state('');

  const flexShortLabels: Record<string, string> = {
    '*': '',
    '+': '+',
    '-': '-',
    '+-': '±',
  };

  let myClaim = $derived(orderItem?.claims.find((c) => c.memberId === currentMemberId));

  let isOnOrder = $derived(!!orderItem);
  let isPackaged = $derived(item.unitsPerCase != null && item.unitsPerCase > 0);
  let caseIncrement = $derived(getCaseIncrement(item.unitsPerCase, item.packSize));

  let unitPrice = $derived(
    calculateUnitPriceGross(
      item.casePrice,
      item.vatPerCase,
      item.unitsPerCase,
      item.packSize,
      item.unit,
    ),
  );

  function toPacks(amount: number): number {
    return item.packSize > 0 ? Math.round(amount / item.packSize) : amount;
  }

  function toNatural(packs: number): number {
    return packs * item.packSize;
  }

  function formatClaimAmount(amount: number): string {
    if (isPackaged) {
      const packs = toPacks(amount);
      return `${packs} pack${packs !== 1 ? 's' : ''}`;
    }
    return `${amount}${item.unit}`;
  }

  function handleAddToOrder() {
    onaddtoorder?.();
  }

  async function handleClaimSubmit(amount: number, flexibility: string, memberId?: string) {
    if (!orderItem) return;
    loading = true;
    try {
      const apiAmount = isPackaged ? toNatural(amount) : amount;
      const targetId = memberId ?? currentMemberId;
      const hasExisting = orderItem.claims.some((c) => c.memberId === targetId);
      if (hasExisting) {
        await onupdateclaim?.(orderItem.orderItem.id, apiAmount, flexibility, memberId);
      } else {
        await onclaim?.(orderItem.orderItem.id, apiAmount, flexibility, memberId);
      }
      showClaimForm = false;
      editingOtherMemberId = null;
      claimingForMember = false;
      selectedMemberId = '';
    } finally {
      loading = false;
    }
  }

  function handleRemoveClaim(memberId?: string) {
    if (!orderItem) return;
    onremoveclaim?.(orderItem.orderItem.id, memberId);
    editingOtherMemberId = null;
  }

  function handleRemoveItem() {
    if (!orderItem) return;
    onremoveitem?.(orderItem.orderItem.id);
  }

  function toggleEditOther(memberId: string) {
    editingOtherMemberId = editingOtherMemberId === memberId ? null : memberId;
    showClaimForm = false;
    claimingForMember = false;
  }
</script>

<article>
  <header>
    <strong>{item.description}</strong>
    {#if item.onOffer}
      <mark class="badge-offer">On offer</mark>
    {/if}
    {#if item.organic}
      <mark class="badge-organic">Organic</mark>
    {/if}
    {#if !item.active}
      <small><em>(inactive)</em></small>
    {/if}
  </header>

  {#if item.brand}
    <p><small>{item.brand}</small></p>
  {/if}

  <p>
    {formatCaseSize(item.unitsPerCase, item.packSize, item.unit)} {#if unitPrice.secondary}
      ({formatPrice(unitPrice.secondary.price)}/{unitPrice.secondary.perUnit})
    {/if}
    &middot; {formatPrice(calculateCasePriceGross(item.casePrice, item.vatPerCase))}/case &middot; {formatPrice(
      unitPrice.price,
    )}/{unitPrice.perUnit}
  </p>

  {#if isOnOrder && orderItem}
    {#if orderItem.claims.length > 0}
      <p>
        <small>
          {#each orderItem.claims as claim, i}
            {#if i > 0},
            {/if}
            {#if isOrganiser && canEdit}
              <button class="claim-chip" onclick={() => toggleEditOther(claim.memberId)}>
                <strong>{claim.memberInitials ?? '??'}</strong>: {formatClaimAmount(
                  claim.amount,
                )}{#if claim.flexibility && claim.flexibility !== '*'}{flexShortLabels[
                    claim.flexibility
                  ]}{/if}
              </button>
            {:else}
              <strong>{claim.memberInitials ?? '??'}</strong>: {formatClaimAmount(
                claim.amount,
              )}{#if claim.flexibility && claim.flexibility !== '*'}{flexShortLabels[
                  claim.flexibility
                ]}{/if}
            {/if}
          {/each}
        </small>
      </p>

      {#if isOrganiser && canEdit}
        {#each orderItem.claims as claim}
          {#if editingOtherMemberId === claim.memberId}
            <div class="organiser-edit">
              <small
                ><strong
                  >Editing {claim.memberName ?? claim.memberInitials ?? 'member'}'s claim</strong
                ></small
              >
              <ClaimForm
                unit={item.unit}
                packaged={isPackaged}
                {caseIncrement}
                initialAmount={isPackaged ? toPacks(claim.amount) : claim.amount}
                initialFlexibility={claim.flexibility ?? '*'}
                {loading}
                onsubmit={(amount, flexibility) =>
                  handleClaimSubmit(amount, flexibility, claim.memberId)}
                oncancel={() => (editingOtherMemberId = null)}
              />
              <ConfirmButton
                label="Remove this claim"
                onclick={() => handleRemoveClaim(claim.memberId)}
                class="outline secondary"
              />
            </div>
          {/if}
        {/each}
      {/if}
    {/if}

    <RoundingBar
      rounding={orderItem.rounding}
      packSize={isPackaged ? item.packSize : undefined}
      {isPackaged}
    />

    {#if canEdit}
      {#if showClaimForm}
        <ClaimForm
          unit={item.unit}
          packaged={isPackaged}
          {caseIncrement}
          initialAmount={isPackaged ? toPacks(myClaim?.amount ?? 0) : (myClaim?.amount ?? 0)}
          initialFlexibility={myClaim?.flexibility ?? '*'}
          {loading}
          onsubmit={(amount, flexibility) => handleClaimSubmit(amount, flexibility)}
          oncancel={() => (showClaimForm = false)}
        />
      {:else if claimingForMember}
        {@const claimedMemberIds = new Set(orderItem.claims.map((c) => c.memberId))}
        {@const availableMembers = members.filter((m) => !claimedMemberIds.has(m.memberId))}
        <div class="organiser-edit">
          {#if availableMembers.length === 0}
            <p><small>All members have claims on this item.</small></p>
            <button
              class="outline secondary"
              onclick={() => {
                claimingForMember = false;
                selectedMemberId = '';
              }}
            >
              Cancel
            </button>
          {:else}
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
                unit={item.unit}
                packaged={isPackaged}
                {caseIncrement}
                initialAmount={0}
                initialFlexibility="*"
                {loading}
                onsubmit={(amount, flexibility) =>
                  handleClaimSubmit(amount, flexibility, selectedMemberId)}
                oncancel={() => {
                  claimingForMember = false;
                  selectedMemberId = '';
                }}
              />
            {:else}
              <button
                class="outline secondary"
                onclick={() => {
                  claimingForMember = false;
                  selectedMemberId = '';
                }}
              >
                Cancel
              </button>
            {/if}
          {/if}
        </div>
      {:else}
        <div class="actions">
          {#if myClaim}
            <button class="outline" onclick={() => (showClaimForm = true)}>
              Edit my claim ({formatClaimAmount(myClaim.amount)})
            </button>
            <ConfirmButton
              label="Remove"
              onclick={() => handleRemoveClaim()}
              class="outline secondary"
            />
          {:else}
            <button class="outline" onclick={() => (showClaimForm = true)}> Add claim </button>
            {#if orderItem.claims.length === 0 && onremoveitem}
              <ConfirmButton
                label="✕"
                confirmLabel="Remove item?"
                onclick={handleRemoveItem}
                class="outline secondary"
              />
            {/if}
          {/if}
          {#if isOrganiser}
            <button
              class="outline secondary"
              onclick={() => {
                claimingForMember = true;
                showClaimForm = false;
                editingOtherMemberId = null;
                selectedMemberId = '';
              }}
            >
              Claim for member
            </button>
          {/if}
        </div>
      {/if}
    {/if}
  {:else if canEdit}
    <button class="outline" onclick={handleAddToOrder}> Add to order </button>
  {/if}

  {#if item.productCode}
    <footer>
      <small>
        Code: {item.productCode} &middot;
        <a
          href="https://www.infinityfoodswholesale.coop/product/{btoa(item.productCode)}/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Open product page
        </a>
      </small>
    </footer>
  {/if}
</article>

<style>
  header {
    display: block;
  }

  header :global(.badge-offer),
  header :global(.badge-organic) {
    margin-left: var(--space-2);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }

  .actions :global(button),
  .actions :global(.confirm-prompt) {
    margin-bottom: 0;
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
