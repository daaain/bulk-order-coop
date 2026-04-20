<script lang="ts">
  import type { CatalogueItem, EnrichedOrderItem } from '$shared/types';
  import { formatPrice, formatCaseSize, calculateCasePriceGross, calculateUnitPriceGross, getCaseIncrement } from '$lib/format';
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
    onremoveclaim,
  }: {
    item: CatalogueItem;
    orderItem?: EnrichedOrderItem;
    currentMemberId?: string;
    orderId?: string;
    orderOpen?: boolean;
    onaddtoorder?: () => void;
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

  async function handleClaimSubmit(amount: number, flexibility: string) {
    if (!orderItem) return;
    loading = true;
    try {
      const apiAmount = isPackaged ? toNatural(amount) : amount;
      if (myClaim) {
        await onupdateclaim?.(orderItem.orderItem.id, apiAmount, flexibility);
      } else {
        await onclaim?.(orderItem.orderItem.id, apiAmount, flexibility);
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
    {#if item.onOffer}
      <span class="badge-offer">On offer</span>
    {/if}
    {#if item.organic}
      <span class="badge-organic">Organic</span>
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
            <strong>{claim.memberInitials ?? '??'}</strong>: {formatClaimAmount(
              claim.amount,
            )}{#if claim.flexibility && claim.flexibility !== '*'}{flexLabels[
                claim.flexibility
              ]}{/if}
          {/each}
        </small>
      </p>
    {/if}

    <RoundingBar
      rounding={orderItem.rounding}
      packSize={isPackaged ? item.packSize : undefined}
      {isPackaged}
    />

    {#if orderOpen}
      {#if showClaimForm}
        <ClaimForm
          unit={item.unit}
          packaged={isPackaged}
          {caseIncrement}
          initialAmount={isPackaged ? toPacks(myClaim?.amount ?? 0) : (myClaim?.amount ?? 0)}
          initialFlexibility={myClaim?.flexibility ?? '*'}
          {loading}
          onsubmit={handleClaimSubmit}
          oncancel={() => (showClaimForm = false)}
        />
      {:else if myClaim}
        <div role="group">
          <button class="outline" onclick={() => (showClaimForm = true)}>
            Edit my claim ({formatClaimAmount(myClaim.amount)})
          </button>
          <ConfirmButton label="Remove" onclick={handleRemoveClaim} class="outline secondary" />
        </div>
      {:else}
        <button class="outline" onclick={() => (showClaimForm = true)}> Add claim </button>
      {/if}
    {/if}
  {:else if orderOpen}
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
