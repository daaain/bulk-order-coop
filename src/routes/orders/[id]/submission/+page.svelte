<script lang="ts">
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import type { LayoutData } from '../$types';
  import { useAuth } from '$lib/auth.svelte';
  import { formatClaimAmount, formatPrice } from '$lib/format';
  import { fetchReconciliation } from '$lib/reconciliation';
  import { formatInfinityOrderCsv } from '$shared/infinity-order';
  import type {
    ReconciliationSummary,
    ReconciliationItem,
    RoundingStatus,
  } from '$shared/types';

  let { data }: { data: LayoutData } = $props();

  const auth = useAuth();

  let recon = $state<ReconciliationSummary | null>(null);
  let loading = $state(true);
  let error = $state('');
  let infinityCopied = $state(false);

  const isOrganiser = $derived(
    data.order.members.some((m) => m.memberId === auth.user?.id && m.role === 'organiser'),
  );

  // Submission phase is editable while the order is closed (pre-reconciling) or
  // while reconciling but before the invoice has been processed (no delivery
  // rows yet — same gate the server uses to allow swaps).
  const canSwap = $derived(
    data.order.status === 'closed' ||
      (data.order.status === 'reconciling' &&
        recon !== null &&
        recon.items.every((i) => i.delivery === null)),
  );

  const ROUNDING_STATUS_ORDER: RoundingStatus[] = ['ready', 'nearly', 'needs_more', 'over'];
  const roundingStatusLabels: Record<RoundingStatus, string> = {
    ready: 'Ready to order',
    nearly: 'Nearly there',
    needs_more: 'Needs more takers',
    over: 'Over — flexible members can reduce',
  };

  function itemGross(item: ReconciliationItem): number {
    const { casePrice, vatPerCase } = item.catalogueItem;
    return (casePrice + vatPerCase) * item.rounding.casesNeeded;
  }

  type OrderSummaryGroup = {
    status: RoundingStatus;
    items: ReconciliationItem[];
    subtotal: number;
  };

  const summaryItems = $derived<ReconciliationItem[]>(
    recon ? recon.items.filter((i) => i.rounding.casesNeeded > 0) : [],
  );

  const summaryGroups = $derived.by<OrderSummaryGroup[]>(() => {
    const buckets = new Map<RoundingStatus, ReconciliationItem[]>();
    for (const item of summaryItems) {
      const arr = buckets.get(item.rounding.status) ?? [];
      arr.push(item);
      buckets.set(item.rounding.status, arr);
    }
    return ROUNDING_STATUS_ORDER.filter((s) => buckets.has(s)).map((status) => {
      const items = buckets.get(status)!;
      const subtotal = items.reduce((sum, i) => sum + itemGross(i), 0);
      return { status, items, subtotal };
    });
  });

  const summaryTotal = $derived(summaryItems.reduce((sum, i) => sum + itemGross(i), 0));

  async function copyInfinityOrder() {
    if (!recon) return;
    const lines = recon.items
      .filter((i) => i.rounding.status === 'ready')
      .map((i) => ({
        productCode: i.orderItem.productCode,
        cases: i.rounding.casesNeeded,
      }));
    const csv = formatInfinityOrderCsv(lines);
    try {
      await navigator.clipboard.writeText(csv);
      infinityCopied = true;
      setTimeout(() => (infinityCopied = false), 2000);
    } catch {
      // Clipboard API unavailable (non-secure context, etc.)
    }
  }

  async function loadReconciliation() {
    if (!recon) loading = true;
    error = '';
    try {
      recon = await fetchReconciliation(data.orderId);
    } catch (err: unknown) {
      error = (err as Error).message || 'Failed to load order data';
    } finally {
      loading = false;
    }
  }

  function handleSwap(itemId: string) {
    goto(`/orders/${data.orderId}/swap/${itemId}`);
  }

  $effect(() => {
    if (data.orderId) {
      untrack(() => loadReconciliation());
    }
  });
</script>

<svelte:head>
  <title>Submission — {data.order.name}</title>
</svelte:head>

<h1 class="animate-in">Submission</h1>
<p>The full order to place with Infinity. Only complete-case items are copied.</p>

{#if loading}
  <p aria-busy="true">Loading order data...</p>
{:else if error && !recon}
  <p><mark>{error}</mark></p>
{:else if recon}
  {#if error}
    <p><mark>{error}</mark></p>
  {/if}

  <section>
    <div class="action-bar">
      <button onclick={copyInfinityOrder} data-testid="copy-infinity">
        {infinityCopied ? 'Copied!' : 'Copy for Infinity'}
      </button>
    </div>

    {#if summaryItems.length === 0}
      <p>Nothing to order yet — no items have reached a full case.</p>
    {:else}
      <figure>
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Cases</th>
              <th>Claimed / case total</th>
              <th>Est. cost</th>
              {#if isOrganiser && canSwap}
                <th></th>
              {/if}
            </tr>
          </thead>
          {#each summaryGroups as group (group.status)}
            <tbody class="summary-group status-{group.status}">
              <tr class="group-header">
                <th colspan={isOrganiser && canSwap ? 5 : 4}>
                  {roundingStatusLabels[group.status]}
                </th>
              </tr>
              {#each group.items as i (i.orderItem.id)}
                <tr class="summary-row">
                  <td>{i.catalogueItem.description}</td>
                  <td>{i.rounding.casesNeeded}</td>
                  <td>
                    {formatClaimAmount(
                      i.rounding.totalClaimed,
                      i.catalogueItem.unitsPerCase,
                      i.catalogueItem.packSize,
                      i.catalogueItem.unit,
                    )}
                    / {formatClaimAmount(
                      i.rounding.casesNeeded * i.rounding.caseSize,
                      i.catalogueItem.unitsPerCase,
                      i.catalogueItem.packSize,
                      i.catalogueItem.unit,
                    )}
                  </td>
                  <td>{formatPrice(itemGross(i))}</td>
                  {#if isOrganiser && canSwap}
                    <td>
                      <button
                        class="outline small swap-btn"
                        onclick={() => handleSwap(i.orderItem.id)}
                      >
                        Swap
                      </button>
                    </td>
                  {/if}
                </tr>
              {/each}
              <tr class="group-subtotal">
                <td colspan={isOrganiser && canSwap ? 3 : 2}></td>
                <td><strong>Subtotal</strong></td>
                <td>{formatPrice(group.subtotal)}</td>
              </tr>
            </tbody>
          {/each}
          <tfoot>
            <tr>
              <td colspan={isOrganiser && canSwap ? 3 : 2}></td>
              <td><strong>Total</strong></td>
              <td><strong>{formatPrice(summaryTotal)}</strong></td>
            </tr>
          </tfoot>
        </table>
      </figure>
    {/if}
  </section>

  {#if isOrganiser && canSwap}
    <p>
      <small>
        Use <strong>Swap</strong> if Infinity tells you an item is out of stock — pick a replacement
        and any existing claims merge across automatically.
      </small>
    </p>
  {/if}
{/if}

<style>
  .action-bar {
    margin-bottom: 1rem;
  }

  .swap-btn {
    padding: 0.2em 0.7em;
    font-size: 0.85em;
    width: auto;
    margin: 0;
  }

  .summary-group {
    --bar-colour: var(--text-muted);
  }
  .summary-group.status-ready {
    --bar-colour: var(--rounding-ready);
  }
  .summary-group.status-nearly {
    --bar-colour: var(--rounding-nearly);
  }
  .summary-group.status-needs_more {
    --bar-colour: var(--rounding-needs-more);
  }
  .summary-group.status-over {
    --bar-colour: var(--rounding-over);
  }

  .summary-group .group-header th {
    color: var(--bar-colour);
    border-bottom: 2px solid var(--bar-colour);
    padding-top: var(--space-3);
  }

  .summary-group .summary-row td:first-child {
    border-left: 3px solid var(--bar-colour);
  }

  .summary-group .group-subtotal td {
    border-top: 1px solid var(--bar-colour);
    color: var(--bar-colour);
  }
</style>
