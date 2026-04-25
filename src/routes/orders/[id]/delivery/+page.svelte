<script lang="ts">
  import { untrack } from 'svelte';
  import type { LayoutData } from '../$types';
  import { useAuth } from '$lib/auth.svelte';
  import { formatClaimAmount, formatClaimDelta, formatPrice } from '$lib/format';
  import { updateOrder } from '$lib/orders';
  import ConfirmButton from '$lib/components/ConfirmButton.svelte';
  import {
    fetchReconciliation,
    confirmAllMyAllocations,
    updateAllocationChecks,
  } from '$lib/reconciliation';
  import type {
    ReconciliationSummary,
    ReconciliationItem,
    MemberCostSummary,
    DeliveryStatus,
    CatalogueItem,
  } from '$shared/types';

  let { data }: { data: LayoutData } = $props();

  const auth = useAuth();

  let recon = $state<ReconciliationSummary | null>(null);
  let loading = $state(true);
  let error = $state('');
  let confirming = $state(false);
  let completing = $state(false);
  // Track which allocations are mid-flight to avoid double-clicks bouncing the
  // checkbox state.
  let pending = $state(new Set<string>());

  const isOrganiser = $derived(
    data.order.members.some((m) => m.memberId === auth.user?.id && m.role === 'organiser'),
  );

  const isReadOnly = $derived(data.order.status === 'complete');

  const hasAllocations = $derived(recon !== null && recon.memberSummaries.length > 0);

  const exceptionLabels: Record<DeliveryStatus, string> = {
    arrived: 'Arrived',
    missing: 'Missing',
    partial: 'Partial',
    different_price: 'Price changed',
  };

  const exceptions = $derived<ReconciliationItem[]>(
    recon ? recon.items.filter((i) => i.delivery && i.delivery.status !== 'arrived') : [],
  );

  const collectedCount = $derived(
    recon ? recon.memberSummaries.filter((s) => s.allConfirmed).length : 0,
  );

  const splitCount = $derived(
    recon ? recon.memberSummaries.filter((s) => s.allSplit).length : 0,
  );

  async function loadReconciliation() {
    if (!recon) loading = true;
    error = '';
    try {
      recon = await fetchReconciliation(data.orderId);
    } catch (err: unknown) {
      error = (err as Error).message || 'Failed to load delivery data';
    } finally {
      loading = false;
    }
  }

  async function toggleCheck(
    allocationId: string,
    field: 'split' | 'pickedUp',
    next: boolean,
  ) {
    if (pending.has(allocationId)) return;
    pending = new Set(pending).add(allocationId);
    error = '';
    try {
      await updateAllocationChecks(data.orderId, allocationId, { [field]: next });
      await loadReconciliation();
    } catch (err: unknown) {
      error = (err as Error).message || 'Failed to update';
    } finally {
      const copy = new Set(pending);
      copy.delete(allocationId);
      pending = copy;
    }
  }

  async function handleConfirmAllPickups() {
    confirming = true;
    error = '';
    try {
      await confirmAllMyAllocations(data.orderId);
      await loadReconciliation();
    } catch (err: unknown) {
      error = (err as Error).message || 'Failed to confirm pickups';
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

  function isMine(summary: MemberCostSummary): boolean {
    return summary.memberId === auth.user?.id;
  }

  function findAllocationId(orderItemId: string, memberId: string): string | null {
    if (!recon) return null;
    const reconItem = recon.items.find((i) => i.orderItem.id === orderItemId);
    return reconItem?.allocations.find((a) => a.memberId === memberId)?.id ?? null;
  }

  function findCatalogueItem(orderItemId: string): CatalogueItem | null {
    return recon?.items.find((i) => i.orderItem.id === orderItemId)?.catalogueItem ?? null;
  }

  $effect(() => {
    if (data.orderId) {
      untrack(() => loadReconciliation());
    }
  });
</script>

<svelte:head>
  <title>Delivery — {data.order.name}</title>
</svelte:head>

<h1 class="animate-in">Delivery & receipt</h1>
<p>
  Two checks per item: <strong>Split</strong> when the portion has been measured out at the
  distribution point, then <strong>Picked up</strong> when each member collects theirs.
</p>

{#if loading}
  <p aria-busy="true">Loading delivery data...</p>
{:else if error && !recon}
  <p><mark>{error}</mark></p>
{:else if recon}
  {#if error}
    <p><mark>{error}</mark></p>
  {/if}

  {#if !hasAllocations}
    <p>
      Allocations haven't been generated yet. Head to the
      <a href="/orders/{data.orderId}/invoice">invoice</a>
      phase first.
    </p>
  {:else}
    {#if exceptions.length > 0}
      <section>
        <hgroup>
          <h2>What's not in this delivery</h2>
          <p>Items Infinity flagged on the invoice — they'll either follow up or refund.</p>
        </hgroup>
        <figure>
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Status</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {#each exceptions as item (item.orderItem.id)}
                <tr>
                  <td>{item.catalogueItem.description}</td>
                  <td>{item.delivery ? exceptionLabels[item.delivery.status] : '–'}</td>
                  <td>{item.delivery?.notes ?? ''}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </figure>
      </section>
    {/if}

    <section>
      <hgroup>
        <h2>Picking list</h2>
        <p>
          Split: <strong>{splitCount}</strong>/{recon.memberSummaries.length} •
          Picked up: <strong>{collectedCount}</strong>/{recon.memberSummaries.length}
        </p>
      </hgroup>

      {#each recon.memberSummaries as summary (summary.memberId)}
        {@const mine = isMine(summary)}
        <details open={mine}>
          <summary>
            <strong>{summary.memberName ?? summary.memberInitials ?? 'Unknown'}</strong>
            — {formatPrice(summary.totals.gross)}
            {#if summary.allSplit}
              <mark class="badge-split" style="margin-left: 0.5rem;">Split</mark>
            {/if}
            {#if summary.allConfirmed}
              <mark class="badge-open" style="margin-left: 0.5rem;">Collected</mark>
            {/if}
          </summary>

          <figure>
            <table class="picking-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Allocated</th>
                  <th class="check-col">Split</th>
                  <th class="check-col">Picked up</th>
                </tr>
              </thead>
              <tbody>
                {#each summary.items as alloc (alloc.orderItemId)}
                  {@const allocationId = findAllocationId(alloc.orderItemId, summary.memberId)}
                  {@const isPending = allocationId !== null && pending.has(allocationId)}
                  {@const ci = findCatalogueItem(alloc.orderItemId)}
                  <tr>
                    <td>{alloc.description}</td>
                    <td>
                      {ci
                        ? formatClaimAmount(alloc.allocated, ci.unitsPerCase, ci.packSize, ci.unit)
                        : alloc.allocated}
                      {#if alloc.allocated !== alloc.claimed && ci}
                        <small style="color: var(--color-terracotta);">
                          ({formatClaimDelta(
                            alloc.allocated - alloc.claimed,
                            ci.unitsPerCase,
                            ci.packSize,
                            ci.unit,
                          )})
                        </small>
                      {/if}
                    </td>
                    <td class="check-col">
                      {#if isReadOnly || allocationId === null}
                        <input
                          type="checkbox"
                          checked={alloc.splitConfirmed}
                          disabled
                          aria-label="Split"
                        />
                      {:else}
                        <input
                          type="checkbox"
                          checked={alloc.splitConfirmed}
                          disabled={isPending}
                          onchange={(e) =>
                            toggleCheck(
                              allocationId,
                              'split',
                              (e.target as HTMLInputElement).checked,
                            )}
                          aria-label="Split"
                        />
                      {/if}
                    </td>
                    <td class="check-col">
                      {#if isReadOnly || allocationId === null || !mine}
                        <input
                          type="checkbox"
                          checked={alloc.confirmed}
                          disabled
                          aria-label="Picked up"
                        />
                      {:else}
                        <input
                          type="checkbox"
                          checked={alloc.confirmed}
                          disabled={isPending}
                          onchange={(e) =>
                            toggleCheck(
                              allocationId,
                              'pickedUp',
                              (e.target as HTMLInputElement).checked,
                            )}
                          aria-label="Picked up"
                        />
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </figure>

          {#if mine && !isReadOnly && !summary.allConfirmed}
            <button
              class="confirm-all-btn"
              onclick={handleConfirmAllPickups}
              disabled={confirming}
              aria-busy={confirming}
            >
              I've collected everything
            </button>
          {/if}
        </details>
      {/each}
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

<style>
  .picking-table .check-col {
    width: 6rem;
    text-align: center;
  }

  .picking-table .check-col input[type='checkbox'] {
    margin: 0;
    transform: scale(1.3);
  }

  .badge-split {
    background: var(--rounding-nearly, var(--pico-muted-color));
  }

  .confirm-all-btn {
    width: auto;
    margin: 1rem var(--pico-spacing, 1rem);
  }
</style>
