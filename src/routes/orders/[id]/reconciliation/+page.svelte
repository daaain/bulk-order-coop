<script lang="ts">
  import { untrack } from 'svelte';
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
    confirmAllMyAllocations,
  } from '$lib/reconciliation';
  import { loadInvoiceFromFile } from '$lib/invoice-loader';
  import { matchInvoiceToOrder } from '$shared/invoice-matching';
  import { formatInfinityOrderCsv } from '$shared/infinity-order';
  import type {
    InvoiceMatchResult,
    DeliveryUpdate,
    OrderItemForMatching,
  } from '$shared/invoice-matching';
  import type { ParsedInvoice } from '$shared/invoice';
  import type {
    ReconciliationSummary,
    ReconciliationItem,
    DeliveryStatus,
    MemberCostSummary,
    RoundingStatus,
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
  let parsedInvoice = $state<ParsedInvoice | null>(null);
  let invoiceResult = $state<InvoiceMatchResult | null>(null);
  let parsingInvoice = $state(false);
  let applyingInvoice = $state(false);
  let invoiceError = $state('');
  let infinityCopied = $state(false);

  const isOrganiser = $derived(
    data.order.members.some((m) => m.memberId === auth.user?.id && m.role === 'organiser'),
  );

  const isReconciling = $derived(
    data.order.status === 'reconciling' || data.order.status === 'complete',
  );

  const isReadOnly = $derived(data.order.status === 'complete');

  const hasAllocations = $derived(recon !== null && recon.memberSummaries.length > 0);

  const allDeliverySet = $derived(
    recon !== null && recon.items.length > 0 && recon.items.every((i) => i.delivery !== null),
  );

  const deliveryStatuses: { value: DeliveryStatus; label: string }[] = [
    { value: 'arrived', label: 'Arrived' },
    { value: 'missing', label: 'Missing' },
    { value: 'partial', label: 'Partial' },
    { value: 'different_price', label: 'Different price' },
  ];

  const statusColours: Record<DeliveryStatus, string> = {
    arrived: 'var(--delivery-arrived-bg)',
    missing: 'var(--delivery-missing-bg)',
    partial: 'var(--delivery-partial-bg)',
    different_price: 'var(--delivery-partial-bg)',
  };

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

  let debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  async function loadReconciliation() {
    // Only show the full-page loading state on the very first fetch.
    // Subsequent refreshes keep the existing data visible so the UI doesn't
    // flicker (and so e.g. form elements don't briefly unmount, which can
    // race with user interactions and tests).
    if (!recon) loading = true;
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
      setTimeout(() => saveDelivery(itemId, item), 500),
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
        notes: item.delivery.notes,
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
            status: 'arrived',
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

  async function handleInvoiceUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !recon) return;

    parsingInvoice = true;
    invoiceError = '';
    parsedInvoice = null;
    invoiceResult = null;

    try {
      const invoice = await loadInvoiceFromFile(file);
      const orderItems: OrderItemForMatching[] = recon.items.map((i) => ({
        orderItemId: i.orderItem.id,
        productCode: i.orderItem.productCode,
        description: i.catalogueItem.description,
        casePrice: i.orderItem.casePrice,
        unitsPerCase: i.orderItem.unitsPerCase,
        packSize: i.orderItem.packSize,
      }));
      parsedInvoice = invoice;
      invoiceResult = matchInvoiceToOrder(invoice, orderItems);
    } catch (err: unknown) {
      invoiceError = (err as Error).message || 'Failed to parse invoice';
    } finally {
      parsingInvoice = false;
      // Reset input so the same file can be re-selected after edits
      input.value = '';
    }
  }

  async function applyInvoice() {
    if (!invoiceResult) return;
    applyingInvoice = true;
    invoiceError = '';
    try {
      const updates: DeliveryUpdate[] = [...invoiceResult.matched, ...invoiceResult.missing];
      await Promise.all(
        updates.map((u) =>
          updateDeliveryStatus(data.orderId, u.orderItemId, {
            status: u.status,
            actualQuantity: u.actualQuantity,
            actualPrice: u.actualPrice,
            notes: u.notes,
          }),
        ),
      );
      invoiceResult = null;
      await loadReconciliation();
    } catch (err: unknown) {
      invoiceError = (err as Error).message || 'Failed to apply invoice';
    } finally {
      applyingInvoice = false;
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
        notes: null,
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
    if (data.orderId) {
      untrack(() => loadReconciliation());
    }
  });
</script>

<svelte:head>
  <title>Reconciliation — {data.order.name}</title>
</svelte:head>

<h1 class="animate-in">Reconciliation</h1>

{#if loading}
  <p aria-busy="true">Loading reconciliation data...</p>
{:else if error && !recon}
  <p><mark>{error}</mark></p>
{:else if recon}
  {#if error}
    <p><mark>{error}</mark></p>
  {/if}

  {#if !isReadOnly}
    <!-- Order summary (pre-finalisation) -->
    <section>
      <hgroup>
        <h2>Order summary</h2>
        <p>The full order to place with Infinity. Only complete-case items are copied.</p>
      </hgroup>

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
              </tr>
            </thead>
            {#each summaryGroups as group (group.status)}
              <tbody class="summary-group status-{group.status}">
                <tr class="group-header">
                  <th colspan="4">{roundingStatusLabels[group.status]}</th>
                </tr>
                {#each group.items as i (i.orderItem.id)}
                  <tr class="summary-row">
                    <td>{i.catalogueItem.description}</td>
                    <td>{i.rounding.casesNeeded}</td>
                    <td>
                      {i.rounding.totalClaimed}{i.catalogueItem.unit}
                      / {i.rounding.casesNeeded * i.rounding.caseSize}{i.catalogueItem.unit}
                    </td>
                    <td>{formatPrice(itemGross(i))}</td>
                  </tr>
                {/each}
                <tr class="group-subtotal">
                  <td colspan="2"></td>
                  <td><strong>Subtotal</strong></td>
                  <td>{formatPrice(group.subtotal)}</td>
                </tr>
              </tbody>
            {/each}
            <tfoot>
              <tr>
                <td colspan="2"></td>
                <td><strong>Total</strong></td>
                <td><strong>{formatPrice(summaryTotal)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </figure>
      {/if}
    </section>
  {/if}

  {#if isReconciling}
  <!-- Delivery status table -->
  <section>
    <hgroup>
      <h2>Delivery status</h2>
      <p>Record what actually arrived for each item</p>
    </hgroup>

    {#if !isReadOnly}
      <div class="action-bar">
        <button class="outline" onclick={markAllArrived} disabled={saving} aria-busy={saving}>
          Mark all as arrived
        </button>

        {#if isOrganiser}
          <div class="invoice-upload">
            <label for="invoice-pdf"><strong>Upload invoice PDF</strong></label>
            <input
              id="invoice-pdf"
              type="file"
              accept="application/pdf,.pdf"
              onchange={handleInvoiceUpload}
              disabled={parsingInvoice || applyingInvoice}
            />
            {#if parsingInvoice}
              <small aria-busy="true">Parsing invoice...</small>
            {/if}
            {#if invoiceError}
              <small><mark>{invoiceError}</mark></small>
            {/if}
          </div>

          {#if invoiceResult && parsedInvoice}
            <article class="invoice-result">
              <header>
                <strong>Invoice {parsedInvoice.invoiceNumber}</strong> — {parsedInvoice.date}
              </header>
              <p>
                <span data-testid="invoice-matched">{invoiceResult.matched.length} matched</span>,
                <span data-testid="invoice-missing">{invoiceResult.missing.length} missing</span>,
                <span data-testid="invoice-only"
                  >{invoiceResult.invoiceOnly.length} invoice-only</span
                >
              </p>
              {#if invoiceResult.invoiceOnly.length > 0}
                <details>
                  <summary>Invoice items not on order</summary>
                  <ul>
                    {#each invoiceResult.invoiceOnly as line (line.productCode)}
                      <li>
                        {line.productCode} — {line.description} ({line.invoiced} ×
                        {formatPrice(line.unitPrice ?? line.cost)})
                      </li>
                    {/each}
                  </ul>
                </details>
              {/if}
              <button onclick={applyInvoice} disabled={applyingInvoice} aria-busy={applyingInvoice}>
                Apply invoice
              </button>
            </article>
          {/if}
        {/if}
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
              <td
                >{formatCaseSize(
                  item.catalogueItem.unitsPerCase,
                  item.catalogueItem.packSize,
                  item.catalogueItem.unit,
                )}</td
              >
              <td>{item.rounding.totalClaimed}{item.catalogueItem.unit}</td>
              <td>
                {#if isReadOnly}
                  {item.delivery?.status ?? '–'}
                {:else}
                  <select
                    value={item.delivery?.status ?? ''}
                    onchange={(e) =>
                      setDeliveryStatus(
                        item,
                        (e.target as HTMLSelectElement).value as DeliveryStatus,
                      )}
                    class="table-input table-input--wide"
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
                      class="table-input table-input--narrow"
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
                      class="table-input table-input--narrow"
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
                    class="table-input table-input--wide"
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
      <button onclick={handleGenerateAllocations} disabled={allocating} aria-busy={allocating}>
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
              <mark class="badge-open" style="margin-left: 0.5rem;">Confirmed</mark>
            {/if}
          </summary>

          <figure>
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Claimed</th>
                  <th>Allocated</th>
                  <th>Amount</th>
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
                        <small style="color: var(--color-terracotta);">
                          ({alloc.allocated > alloc.claimed ? '+' : ''}{(
                            alloc.allocated - alloc.claimed
                          ).toFixed(1)})
                        </small>
                      {/if}
                    </td>
                    <td>{formatPrice(alloc.gross)}</td>
                    <td>
                      {#if alloc.confirmed}
                        Confirmed
                      {:else if isMine && !isReadOnly}
                        {@const reconItem = recon?.items.find(
                          (i) => i.orderItem.id === alloc.orderItemId,
                        )}
                        {@const allocation = reconItem?.allocations.find(
                          (a) => a.memberId === summary.memberId,
                        )}
                        {#if allocation}
                          <button
                            class="outline confirm-btn"
                            onclick={() => handleConfirm(allocation.id)}
                            disabled={confirming}
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
                  <td><strong>{formatPrice(summary.totals.gross)}</strong></td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </figure>

          {#if isMine && !isReadOnly && !summary.allConfirmed}
            <button
              class="confirm-all-btn"
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
                    <mark class="badge-open">Confirmed</mark>
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
            {#if parsedInvoice}
              <tr>
                <td><em>Invoice {parsedInvoice.invoiceNumber}</em></td>
                <td>{formatPrice(parsedInvoice.totals.nettGoodsValue)}</td>
                <td>{formatPrice(parsedInvoice.totals.vat)}</td>
                <td>{formatPrice(parsedInvoice.totals.totalPayable)}</td>
                <td></td>
              </tr>
            {/if}
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
{/if}

<style>
  .action-bar {
    margin-bottom: 1rem;
  }

  .table-input {
    margin-bottom: 0;
  }

  .table-input--wide {
    min-width: 8rem;
  }

  .table-input--narrow {
    width: 6rem;
  }

  .confirm-btn {
    padding: 0.2em 0.6em;
    font-size: 0.85em;
  }

  .confirm-all-btn {
    width: auto;
    margin: 1rem var(--pico-spacing, 1rem);
  }

  .invoice-upload {
    margin-top: 1rem;
  }

  .invoice-upload input[type='file'] {
    margin-bottom: 0.5rem;
  }

  .invoice-result {
    margin-top: 1rem;
    padding: 1rem;
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
