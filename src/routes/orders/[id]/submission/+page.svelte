<script lang="ts">
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import type { LayoutData } from '../$types';
  import { useAuth } from '$lib/auth.svelte';
  import { formatClaimAmount, formatPrice } from '$lib/format';
  import { fetchReconciliation } from '$lib/reconciliation';
  import { decodeCsvBytes } from '$shared/csv';
  import { formatInfinityOrderCsv, selectInfinityOrderLines } from '$shared/infinity-order';
  import {
    compareWithProvisional,
    parseProvisionalOrderCsv,
    type ProvisionalCheck,
    type SubmittedLine,
  } from '$shared/provisional-order';
  import type { ReconciliationSummary, ReconciliationItem, RoundingStatus } from '$shared/types';

  let { data }: { data: LayoutData } = $props();

  const auth = useAuth();

  let recon = $state<ReconciliationSummary | null>(null);
  let loading = $state(true);
  let error = $state('');
  let infinityCopied = $state(false);

  // "Needs more takers" items the organiser has ticked for export because the
  // shortfall was agreed on the group chat but not yet claimed. Remembered per
  // order in this browser so a reload doesn't lose the selection.
  const includedStorageKey = $derived(`submission-include-needs-more:${data.orderId}`);
  let includedNeedsMore = $state<Set<string>>(new Set());

  function loadIncluded(key: string): Set<string> {
    try {
      const raw = localStorage.getItem(key);
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set();
    }
  }

  function toggleIncluded(itemId: string, checked: boolean) {
    const next = new Set(includedNeedsMore);
    if (checked) next.add(itemId);
    else next.delete(itemId);
    includedNeedsMore = next;
    try {
      localStorage.setItem(includedStorageKey, JSON.stringify([...next]));
    } catch {
      // Storage unavailable (private mode etc.) — selection just won't persist
    }
  }

  $effect(() => {
    const key = includedStorageKey;
    includedNeedsMore = untrack(() => loadIncluded(key));
  });

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

  const exportLines = $derived(
    recon ? selectInfinityOrderLines(recon.items, includedNeedsMore) : [],
  );

  async function copyInfinityOrder() {
    if (!recon) return;
    const csv = formatInfinityOrderCsv(exportLines);
    try {
      await navigator.clipboard.writeText(csv);
      infinityCopied = true;
      setTimeout(() => (infinityCopied = false), 2000);
    } catch {
      // Clipboard API unavailable (non-secure context, etc.)
    }
  }

  // Provisional invoice check: Infinity send back a CSV of what they can
  // actually supply. We snapshot it alongside what was submitted so the
  // organiser can see what's missing, swap it, and then see which replacement
  // lines still need adding. Remembered per order in this browser so the
  // result survives the round trip through the Swap page.
  const checkStorageKey = $derived(`submission-provisional-check:${data.orderId}`);
  let provisionalCheck = $state<ProvisionalCheck | null>(null);
  let checkError = $state('');
  let checkDialog = $state<HTMLDialogElement>();
  let provisionalInput = $state<HTMLInputElement>();
  let additionsCopied = $state(false);

  function loadCheck(key: string): ProvisionalCheck | null {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as ProvisionalCheck) : null;
    } catch {
      return null;
    }
  }

  function saveCheck(check: ProvisionalCheck | null) {
    provisionalCheck = check;
    try {
      if (check) localStorage.setItem(checkStorageKey, JSON.stringify(check));
      else localStorage.removeItem(checkStorageKey);
    } catch {
      // Storage unavailable — the check just won't survive a reload
    }
  }

  $effect(() => {
    const key = checkStorageKey;
    provisionalCheck = untrack(() => loadCheck(key));
  });

  const orderItemByCode = $derived(
    new Map((recon?.items ?? []).map((i) => [i.orderItem.productCode, i])),
  );

  const submittedLines = $derived<SubmittedLine[]>(
    exportLines.map((l) => ({
      ...l,
      description: orderItemByCode.get(l.productCode)?.catalogueItem.description ?? l.productCode,
    })),
  );

  const comparison = $derived(
    provisionalCheck ? compareWithProvisional(provisionalCheck, submittedLines) : null,
  );
  const outstandingCount = $derived(
    comparison ? comparison.missing.filter((m) => m.stillOnOrder).length : 0,
  );
  const swappedCount = $derived(
    comparison ? comparison.missing.filter((m) => !m.stillOnOrder).length : 0,
  );

  async function handleProvisionalUpload(e: Event & { currentTarget: HTMLInputElement }) {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    checkError = '';
    try {
      const text = decodeCsvBytes(new Uint8Array(await file.arrayBuffer()));
      const provisional = parseProvisionalOrderCsv(text);
      if (provisional.length === 0) {
        checkError = `Couldn't find any order lines in ${file.name} — is it the CSV export of the provisional invoice?`;
        return;
      }
      saveCheck({
        fileName: file.name,
        checkedAt: new Date().toISOString(),
        submitted: $state.snapshot(submittedLines),
        provisional,
      });
      checkDialog?.showModal();
    } catch {
      checkError = `Couldn't read ${file.name}.`;
    }
  }

  function clearCheck() {
    saveCheck(null);
    checkDialog?.close();
  }

  async function copyAdditions() {
    if (!comparison) return;
    try {
      await navigator.clipboard.writeText(formatInfinityOrderCsv(comparison.additions));
      additionsCopied = true;
      setTimeout(() => (additionsCopied = false), 2000);
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
    const back = encodeURIComponent(`/orders/${data.orderId}/submission`);
    goto(`/orders/${data.orderId}/swap/${itemId}?return=${back}`);
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
<p>
  The full order to place with Infinity. Complete-case items are always copied; tick any
  <em>Needs more takers</em> items that have been agreed on the group chat to include them too. Once Infinity
  send the provisional invoice, upload its CSV to see what they can't supply.
</p>

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
        {infinityCopied
          ? 'Copied!'
          : `Copy for Infinity (${exportLines.length} ${exportLines.length === 1 ? 'line' : 'lines'})`}
      </button>
      <button
        class="outline"
        onclick={() => provisionalInput?.click()}
        data-testid="upload-provisional"
      >
        Check provisional invoice
      </button>
      <input
        type="file"
        accept=".csv,text/csv"
        hidden
        bind:this={provisionalInput}
        onchange={handleProvisionalUpload}
        data-testid="provisional-input"
      />
    </div>

    {#if checkError}
      <p><mark>{checkError}</mark></p>
    {/if}

    {#if provisionalCheck && comparison}
      <p class="check-summary" data-testid="provisional-summary">
        <small>
          Provisional invoice <strong>{provisionalCheck.fileName}</strong>:
          {#if comparison.missing.length === 0}
            everything submitted is confirmed.
          {:else}
            {outstandingCount} missing{#if swappedCount > 0}, {swappedCount} swapped{/if}{#if comparison.additions.length > 0},
              {comparison.additions.length} to add{/if}.
          {/if}
        </small>
        <button class="outline small" onclick={() => checkDialog?.showModal()}>Review</button>
      </p>
    {/if}

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
                  <td>
                    {#if group.status === 'needs_more'}
                      <label class="include-toggle">
                        <input
                          type="checkbox"
                          checked={includedNeedsMore.has(i.orderItem.id)}
                          onchange={(e) => toggleIncluded(i.orderItem.id, e.currentTarget.checked)}
                          data-testid="include-needs-more"
                        />
                        {i.catalogueItem.description}
                      </label>
                    {:else}
                      {i.catalogueItem.description}
                    {/if}
                  </td>
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

  <dialog
    bind:this={checkDialog}
    class="check-dialog"
    aria-labelledby="check-dialog-title"
    onclick={(e) => {
      if (e.target === checkDialog) checkDialog?.close();
    }}
  >
    {#if provisionalCheck && comparison}
      <article>
        <header>
          <h3 id="check-dialog-title">Provisional invoice check</h3>
          <small>{provisionalCheck.fileName}</small>
        </header>

        {#if comparison.missing.length === 0}
          <p>Everything you submitted is on the provisional invoice.</p>
        {:else}
          <p>
            These items aren't (fully) on the provisional invoice.
            {#if isOrganiser && canSwap}
              Swap them for an alternative, then add the replacements to the Infinity order.
            {/if}
          </p>
          <table class="check-table" data-testid="missing-items">
            <thead>
              <tr>
                <th>Item</th>
                <th>Confirmed</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {#each comparison.missing as m (m.productCode)}
                {@const item = orderItemByCode.get(m.productCode)}
                <tr class:resolved={!m.stillOnOrder}>
                  <td>
                    {m.description}
                    <br /><small>{m.productCode}</small>
                  </td>
                  <td>{m.confirmed} of {m.ordered}</td>
                  <td>
                    {#if !m.stillOnOrder}
                      <mark class="badge-swapped">Swapped</mark>
                    {:else if item && isOrganiser && canSwap}
                      <button
                        class="outline small swap-btn"
                        onclick={() => handleSwap(item.orderItem.id)}
                      >
                        Swap
                      </button>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}

        {#if comparison.additions.length > 0}
          <h4>Add to the Infinity order</h4>
          <ul data-testid="additions">
            {#each comparison.additions as a (a.productCode)}
              <li>
                {a.cases} × {a.description} <small>({a.productCode})</small>
              </li>
            {/each}
          </ul>
          <button class="outline small" onclick={copyAdditions}>
            {additionsCopied ? 'Copied!' : 'Copy additions for Infinity'}
          </button>
        {/if}

        {#if comparison.unexpected.length > 0}
          <h4>On the invoice but not submitted</h4>
          <ul>
            {#each comparison.unexpected as u (u.productCode)}
              <li>
                {u.cases} × {u.description || u.productCode} <small>({u.productCode})</small>
              </li>
            {/each}
          </ul>
        {/if}

        <footer>
          <button class="outline secondary" onclick={clearCheck}>Clear check</button>
          <button onclick={() => checkDialog?.close()}>Close</button>
        </footer>
      </article>
    {/if}
  </dialog>

  {#if isOrganiser && canSwap}
    <p>
      <small>
        Use <strong>Swap</strong> if Infinity tells you an item is out of stock — pick a replacement and
        any existing claims merge across automatically.
      </small>
    </p>
  {/if}
{/if}

<style>
  .action-bar {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-bottom: 1rem;
  }

  .action-bar button {
    width: auto;
    margin: 0;
  }

  .check-summary {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .check-summary button,
  .check-dialog button.small {
    padding: 0.2em 0.7em;
    font-size: 0.85em;
    width: auto;
    margin: 0;
  }

  .check-dialog {
    border: none;
    padding: 0;
    margin: auto;
    width: min(640px, calc(100vw - 2rem));
    max-height: calc(100vh - 2rem);
    background: transparent;
    color: inherit;
  }

  .check-dialog::backdrop {
    background: rgba(0, 0, 0, 0.45);
  }

  .check-dialog article {
    margin: 0;
    box-shadow: var(--shadow-lg);
  }

  .check-dialog h4 {
    margin-top: var(--space-4);
  }

  .check-dialog footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-4);
  }

  .check-dialog footer button {
    width: auto;
    margin: 0;
  }

  .check-table tr.resolved td {
    color: var(--text-tertiary);
  }

  .check-table tr.resolved td:first-child {
    text-decoration: line-through;
  }

  .badge-swapped {
    white-space: nowrap;
  }

  .include-toggle {
    display: flex;
    align-items: center;
    gap: 0.5em;
    margin: 0;
  }

  .include-toggle input {
    margin: 0;
    flex-shrink: 0;
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
