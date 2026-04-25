<script lang="ts">
  import { untrack } from 'svelte';
  import type { LayoutData } from '../$types';
  import { useAuth } from '$lib/auth.svelte';
  import { formatClaimAmount, formatPrice, formatCaseSize } from '$lib/format';
  import { updateOrder } from '$lib/orders';
  import {
    fetchReconciliation,
    updateDeliveryStatus,
    generateAllocations,
  } from '$lib/reconciliation';
  import { loadInvoiceFromFile } from '$lib/invoice-loader';
  import { matchInvoiceToOrder } from '$shared/invoice-matching';
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
  } from '$shared/types';

  let { data }: { data: LayoutData } = $props();

  const auth = useAuth();

  let recon = $state<ReconciliationSummary | null>(null);
  let loading = $state(true);
  let error = $state('');
  let saving = $state(false);
  let allocating = $state(false);
  let parsedInvoice = $state<ParsedInvoice | null>(null);
  let invoiceResult = $state<InvoiceMatchResult | null>(null);
  let parsingInvoice = $state(false);
  let applyingInvoice = $state(false);
  let invoiceError = $state('');

  let applyDiscountChecked = $state(true);
  let adminFeeInput = $state(2);
  let adminFeeEdit = $state<number | null>(null);
  let savingDiscount = $state(false);
  let bulkMarking = $state(false);

  const isOrganiser = $derived(
    data.order.members.some((m) => m.memberId === auth.user?.id && m.role === 'organiser'),
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

  let debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  async function loadReconciliation() {
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
    bulkMarking = true;
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
      bulkMarking = false;
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
      applyDiscountChecked = invoice.totals.discountPercentage > 0;
      adminFeeInput = data.order.adminFeePercentage ?? 2;
    } catch (err: unknown) {
      invoiceError = (err as Error).message || 'Failed to parse invoice';
    } finally {
      parsingInvoice = false;
      input.value = '';
    }
  }

  async function applyInvoice() {
    if (!invoiceResult || !parsedInvoice) return;
    applyingInvoice = true;
    invoiceError = '';
    try {
      const updates: DeliveryUpdate[] = [...invoiceResult.matched, ...invoiceResult.missing];
      const discountPct = parsedInvoice.totals.discountPercentage;
      const shouldApplyDiscount = applyDiscountChecked && discountPct > 0;

      const tasks: Promise<unknown>[] = updates.map((u) =>
        updateDeliveryStatus(data.orderId, u.orderItemId, {
          status: u.status,
          actualQuantity: u.actualQuantity,
          actualPrice: u.actualPrice,
          notes: u.notes,
        }),
      );

      if (shouldApplyDiscount) {
        const updated = await updateOrder(data.orderId, {
          discountPercentage: discountPct,
          adminFeePercentage: adminFeeInput,
        });
        data.order = { ...data.order, ...updated };
      }

      await Promise.all(tasks);
      invoiceResult = null;
      parsedInvoice = null;
      await loadReconciliation();
    } catch (err: unknown) {
      invoiceError = (err as Error).message || 'Failed to apply invoice';
    } finally {
      applyingInvoice = false;
    }
  }

  async function saveAdminFee() {
    if (adminFeeEdit === null) return;
    savingDiscount = true;
    error = '';
    try {
      const updated = await updateOrder(data.orderId, {
        adminFeePercentage: adminFeeEdit,
      });
      data.order = { ...data.order, ...updated };
      adminFeeEdit = null;
      await loadReconciliation();
    } catch (err: unknown) {
      error = (err as Error).message || 'Failed to update admin fee';
    } finally {
      savingDiscount = false;
    }
  }

  async function clearDiscount() {
    savingDiscount = true;
    error = '';
    try {
      const updated = await updateOrder(data.orderId, {
        discountPercentage: null,
      });
      data.order = { ...data.order, ...updated };
      await loadReconciliation();
    } catch (err: unknown) {
      error = (err as Error).message || 'Failed to clear discount';
    } finally {
      savingDiscount = false;
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

  $effect(() => {
    if (data.orderId) {
      untrack(() => loadReconciliation());
    }
  });
</script>

<svelte:head>
  <title>Invoice — {data.order.name}</title>
</svelte:head>

<h1 class="animate-in">Invoice & payment</h1>
<p>
  Infinity has picked the order at the warehouse. Upload the final invoice to record what's being
  delivered, apply any wholesale discount, then generate allocations so members can pay.
</p>

{#if loading}
  <p aria-busy="true">Loading invoice data...</p>
{:else if error && !recon}
  <p><mark>{error}</mark></p>
{:else if recon}
  {#if error}
    <p><mark>{error}</mark></p>
  {/if}

  {#if !isReadOnly && isOrganiser}
    <section>
      <hgroup>
        <h2>Invoice upload</h2>
        <p>Auto-populates the items table from the supplier's PDF invoice.</p>
      </hgroup>

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
        {@const invoiceDiscountPct = parsedInvoice.totals.discountPercentage}
        {@const memberPct = Math.max(0, invoiceDiscountPct - adminFeeInput)}
        <article class="invoice-result">
          <header>
            <strong>Invoice {parsedInvoice.invoiceNumber}</strong> — {parsedInvoice.date}
          </header>
          <p>
            <span data-testid="invoice-matched">{invoiceResult.matched.length} matched</span>,
            <span data-testid="invoice-missing">{invoiceResult.missing.length} missing</span>,
            <span data-testid="invoice-only">{invoiceResult.invoiceOnly.length} invoice-only</span>
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

          {#if invoiceDiscountPct > 0}
            <div class="invoice-discount" data-testid="invoice-discount">
              <label>
                <input type="checkbox" bind:checked={applyDiscountChecked} role="switch" />
                Apply <strong>{invoiceDiscountPct}% discount</strong>
                ({formatPrice(parsedInvoice.totals.discountAmount)}) to this order
              </label>
              {#if applyDiscountChecked}
                <label class="admin-fee-label">
                  Admin fee (%)
                  <input
                    type="number"
                    min="0"
                    max={invoiceDiscountPct}
                    step="0.1"
                    bind:value={adminFeeInput}
                    class="table-input table-input--narrow"
                  />
                </label>
                <small>
                  Members receive <strong>{memberPct.toFixed(memberPct % 1 === 0 ? 0 : 1)}%</strong>
                  off each line; the Ltd retains the equivalent of {adminFeeInput}%.
                </small>
              {/if}
            </div>
          {/if}

          <button onclick={applyInvoice} disabled={applyingInvoice} aria-busy={applyingInvoice}>
            Apply invoice
          </button>
        </article>
      {/if}
    </section>
  {/if}

  <section>
    <hgroup>
      <h2>Items being delivered</h2>
      <p>
        Review what Infinity is sending. Adjust any rows where the invoice match needs correcting.
      </p>
    </hgroup>

    {#if !isReadOnly && isOrganiser}
      <div class="action-bar">
        <button
          class="outline"
          onclick={markAllArrived}
          disabled={bulkMarking}
          aria-busy={bulkMarking}
        >
          Mark all as arrived
        </button>
        <small>Use this if you trust Infinity to send everything as ordered (no PDF invoice).</small>
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
              <td>
                {formatCaseSize(
                  item.catalogueItem.unitsPerCase,
                  item.catalogueItem.packSize,
                  item.catalogueItem.unit,
                )}
              </td>
              <td>
                {formatClaimAmount(
                  item.rounding.totalClaimed,
                  item.catalogueItem.unitsPerCase,
                  item.catalogueItem.packSize,
                  item.catalogueItem.unit,
                )}
              </td>
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

  {#if hasAllocations}
    <section>
      <h2>Order totals</h2>

      {#if recon.discount && isOrganiser && !isReadOnly}
        <article class="discount-admin" data-testid="discount-admin">
          <p>
            <strong>{recon.discount.discountPercentage}% wholesale discount</strong> applied
            ({formatPrice(recon.discount.discountAmount)}). Members see <strong
              >{recon.discount.memberDiscountPercentage.toFixed(
                recon.discount.memberDiscountPercentage % 1 === 0 ? 0 : 1,
              )}%</strong
            >
            off each line; Ltd retains {formatPrice(recon.discount.adminFeeAmount)} for admin.
          </p>
          <div class="discount-admin__controls">
            {#if adminFeeEdit === null}
              <button
                class="outline"
                onclick={() => (adminFeeEdit = recon?.discount?.adminFeePercentage ?? 2)}
                disabled={savingDiscount}
              >
                Change admin fee
              </button>
              <button
                class="outline secondary"
                onclick={clearDiscount}
                disabled={savingDiscount}
                aria-busy={savingDiscount}
              >
                Clear discount
              </button>
            {:else}
              <label class="admin-fee-label">
                Admin fee (%)
                <input
                  type="number"
                  min="0"
                  max={recon.discount.discountPercentage}
                  step="0.1"
                  bind:value={adminFeeEdit}
                  class="table-input table-input--narrow"
                />
              </label>
              <button onclick={saveAdminFee} disabled={savingDiscount} aria-busy={savingDiscount}>
                Save
              </button>
              <button
                class="outline"
                onclick={() => (adminFeeEdit = null)}
                disabled={savingDiscount}
              >
                Cancel
              </button>
            {/if}
          </div>
        </article>
      {/if}

      <figure>
        <table>
          <thead>
            <tr>
              <th>Member</th>
              <th>Net</th>
              <th>VAT</th>
              <th>Gross</th>
            </tr>
          </thead>
          <tbody>
            {#each recon.memberSummaries as summary (summary.memberId)}
              <tr>
                <td>{summary.memberName ?? summary.memberInitials ?? 'Unknown'}</td>
                <td>{formatPrice(summary.totals.net)}</td>
                <td>{formatPrice(summary.totals.vat)}</td>
                <td>{formatPrice(summary.totals.gross)}</td>
              </tr>
            {/each}
          </tbody>
          <tfoot>
            {#if recon.discount}
              <tr>
                <td><strong>Subtotal</strong></td>
                <td><strong>{formatPrice(recon.discount.subtotalBeforeDiscount)}</strong></td>
                <td></td>
                <td></td>
              </tr>
              <tr class="discount-row">
                <td><em>{recon.discount.discountPercentage}% discount</em></td>
                <td>−{formatPrice(recon.discount.discountAmount)}</td>
                <td></td>
                <td></td>
              </tr>
              <tr class="discount-row discount-row--indent">
                <td>
                  <small>{recon.discount.adminFeePercentage}% admin (retained by Ltd)</small>
                </td>
                <td><small>{formatPrice(recon.discount.adminFeeAmount)}</small></td>
                <td></td>
                <td></td>
              </tr>
              <tr class="discount-row discount-row--indent">
                <td>
                  <small>
                    {recon.discount.memberDiscountPercentage.toFixed(
                      recon.discount.memberDiscountPercentage % 1 === 0 ? 0 : 1,
                    )}% to members
                  </small>
                </td>
                <td><small>−{formatPrice(recon.discount.memberDiscountAmount)}</small></td>
                <td></td>
                <td></td>
              </tr>
              <tr>
                <td><strong>Nett goods value</strong></td>
                <td><strong>{formatPrice(recon.orderTotals.net)}</strong></td>
                <td><strong>{formatPrice(recon.orderTotals.vat)}</strong></td>
                <td><strong>{formatPrice(recon.orderTotals.gross)}</strong></td>
              </tr>
            {:else}
              <tr>
                <td><strong>Total</strong></td>
                <td><strong>{formatPrice(recon.orderTotals.net)}</strong></td>
                <td><strong>{formatPrice(recon.orderTotals.vat)}</strong></td>
                <td><strong>{formatPrice(recon.orderTotals.gross)}</strong></td>
              </tr>
            {/if}
            {#if parsedInvoice}
              <tr>
                <td><em>Invoice {parsedInvoice.invoiceNumber}</em></td>
                <td>{formatPrice(parsedInvoice.totals.nettGoodsValue)}</td>
                <td>{formatPrice(parsedInvoice.totals.vat)}</td>
                <td>{formatPrice(parsedInvoice.totals.totalPayable)}</td>
              </tr>
            {/if}
          </tfoot>
        </table>
      </figure>

      <p>
        <small>
          Once members have paid, head to the <a href="/orders/{data.orderId}/delivery">delivery</a>
          phase to tick items off as they're collected.
        </small>
      </p>
    </section>
  {/if}
{/if}

<style>
  .action-bar {
    margin-bottom: 1rem;
    display: flex;
    gap: 0.75rem;
    align-items: center;
    flex-wrap: wrap;
  }

  .action-bar button {
    width: auto;
    margin: 0;
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

  .invoice-discount {
    margin: 1rem 0;
    padding: 0.75rem;
    border-left: 3px solid var(--pico-primary, currentColor);
  }

  .invoice-discount label {
    display: block;
    margin-bottom: 0.5rem;
  }

  .invoice-discount .admin-fee-label {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }

  .admin-fee-label input {
    margin-bottom: 0;
  }

  .discount-admin {
    margin-bottom: 1rem;
    padding: 0.75rem 1rem;
  }

  .discount-admin p {
    margin: 0 0 0.5rem 0;
  }

  .discount-admin__controls {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    align-items: center;
  }

  .discount-admin__controls button {
    width: auto;
    margin: 0;
  }

  .discount-row td {
    border-top: 0;
    color: var(--text-muted);
  }

  .discount-row--indent td:first-child {
    padding-left: 2rem;
  }
</style>
