<script lang="ts">
  import type { PageData } from './$types';
  import { useAuth } from '$lib/auth.svelte';
  import { updateOrder, updateMemberRole } from '$lib/orders';
  import { addItemToOrder, createClaim } from '$lib/claims';
  import { loadCatalogue } from '$lib/catalogue';
  import { parseInfinityOrderCsv, splitAmountRandomly } from '$shared/infinity-order';
  import ConfirmButton from '$lib/components/ConfirmButton.svelte';

  let { data }: { data: PageData } = $props();

  const auth = useAuth();

  let copied = $state(false);
  let statusLoading = $state(false);
  let statusError = $state('');

  let roleLoading = $state(false);
  let roleError = $state('');

  let editingDeadline = $state(false);
  let deadlineInput = $state('');
  let deadlineLoading = $state(false);
  let deadlineError = $state('');

  // Order deadlines are stored as 23:00 Europe/London (GMT/BST) on the chosen
  // day. Infinity Foods' actual cut-off is 23:50, but organisers need time to
  // file the order — so 23:00 London time is the real deadline we expose.
  const LONDON_TZ = 'Europe/London';

  function londonDateParts(timestamp: number): {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
  } {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: LONDON_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(timestamp * 1000));
    const get = (type: string) =>
      Number(parts.find((p) => p.type === type)?.value ?? 0);
    return {
      year: get('year'),
      month: get('month'),
      day: get('day'),
      // '24' can appear at midnight in some locales; normalise to 0
      hour: get('hour') % 24,
      minute: get('minute'),
    };
  }

  function toDateInputValue(timestamp: number | null): string {
    if (!timestamp) return '';
    const { year, month, day } = londonDateParts(timestamp);
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  // Convert a YYYY-MM-DD string to the Unix timestamp for 23:00 on that date
  // in Europe/London, accounting for BST/GMT automatically.
  function londonDeadlineTimestamp(dateStr: string): number {
    const [y, m, d] = dateStr.split('-').map(Number);
    // Start with 23:00 "naive UTC" as a guess, then measure how far Europe/London
    // is from UTC at that instant and subtract that offset.
    const guess = Date.UTC(y, m - 1, d, 23, 0, 0);
    const london = londonDateParts(Math.floor(guess / 1000));
    const asIfUtc = Date.UTC(
      london.year,
      london.month - 1,
      london.day,
      london.hour,
      london.minute,
    );
    const offsetMs = asIfUtc - guess;
    return Math.floor((guess - offsetMs) / 1000);
  }

  function startEditDeadline() {
    deadlineInput = toDateInputValue(data.order.deadline);
    deadlineError = '';
    editingDeadline = true;
  }

  function cancelEditDeadline() {
    editingDeadline = false;
    deadlineError = '';
  }

  async function saveDeadline() {
    deadlineLoading = true;
    deadlineError = '';
    try {
      const deadline = deadlineInput ? londonDeadlineTimestamp(deadlineInput) : null;
      await updateOrder(data.orderId, { deadline });
      location.reload();
    } catch (e: unknown) {
      deadlineError = e instanceof Error ? e.message : 'Failed to update deadline';
      deadlineLoading = false;
    }
  }

  const isOrganiser = $derived(
    data.order.members.some((m) => m.memberId === auth.user?.id && m.role === 'organiser'),
  );

  const deadlineText = $derived.by(() => {
    if (!data.order.deadline) return null;
    const now = Math.floor(Date.now() / 1000);
    const diff = data.order.deadline - now;
    const days = Math.ceil(diff / 86400);
    if (days > 1) return `${days} days left`;
    if (days === 1) return '1 day left';
    if (days === 0) return 'Deadline is today';
    return 'Deadline has passed';
  });

  const inviteUrl = $derived(
    typeof window !== 'undefined' ? `${window.location.origin}/join/${data.order.inviteCode}` : '',
  );

  async function copyInviteLink() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      // Clipboard API not available
    }
  }

  const nextStatus: Record<string, string | null> = {
    open: 'closed',
    closed: 'reconciling',
    reconciling: 'complete',
    complete: null,
  };
  const nextStatusLabel: Record<string, string> = {
    closed: 'Close order',
    reconciling: 'Start reconciliation',
    complete: 'Mark complete',
  };

  function formatDate(timestamp: number): string {
    return new Date(timestamp * 1000).toLocaleDateString('en-GB', {
      dateStyle: 'long',
    });
  }

  function formatDeadline(timestamp: number): string {
    return new Date(timestamp * 1000).toLocaleDateString('en-GB', {
      dateStyle: 'long',
      timeZone: LONDON_TZ,
    });
  }

  async function handleRoleChange(memberId: string, role: 'organiser' | 'member') {
    roleLoading = true;
    roleError = '';
    try {
      await updateMemberRole(data.orderId, memberId, role);
      location.reload();
    } catch (e: unknown) {
      roleError = e instanceof Error ? e.message : 'Failed to update role';
    } finally {
      roleLoading = false;
    }
  }

  // --- Infinity CSV import (testing tool, organiser-only, open orders) ---
  let importCsv = $state('');
  let importing = $state(false);
  let importReport = $state<{
    added: number;
    claimsCreated: number;
    skipped: { productCode: string; reason: string }[];
  } | null>(null);
  let importError = $state('');

  async function handleImportInfinityCsv() {
    importing = true;
    importError = '';
    importReport = null;
    try {
      const lines = parseInfinityOrderCsv(importCsv);
      if (lines.length === 0) {
        importError = 'No valid rows found — expected `productCode,cases` pairs.';
        return;
      }

      const catalogue = await loadCatalogue(data.orderId, data.order.catalogueKey);
      const byCode = new Map(catalogue.map((i) => [i.productCode, i]));
      const memberIds = data.order.members.map((m) => m.memberId);

      let added = 0;
      let claimsCreated = 0;
      const skipped: { productCode: string; reason: string }[] = [];

      for (const line of lines) {
        const item = byCode.get(line.productCode);
        if (!item) {
          skipped.push({ productCode: line.productCode, reason: 'not in catalogue' });
          continue;
        }

        let orderItemId: string;
        try {
          const created = await addItemToOrder(data.orderId, item);
          orderItemId = created.id;
          added++;
        } catch (err: unknown) {
          skipped.push({
            productCode: line.productCode,
            reason: (err as Error).message || 'add failed',
          });
          continue;
        }

        const caseSize = (item.unitsPerCase ?? 1) * item.packSize;
        const targetAmount = line.cases * caseSize;
        const claimantCount = Math.min(
          memberIds.length,
          1 + Math.floor(Math.random() * Math.min(3, memberIds.length)),
        );
        const shuffled = [...memberIds].sort(() => Math.random() - 0.5);
        const chosen = shuffled.slice(0, claimantCount);
        const amounts = splitAmountRandomly(targetAmount, claimantCount);

        for (let i = 0; i < chosen.length; i++) {
          const amt = amounts[i];
          if (amt <= 0) continue;
          try {
            await createClaim(data.orderId, orderItemId, amt, undefined, chosen[i]);
            claimsCreated++;
          } catch (err: unknown) {
            skipped.push({
              productCode: line.productCode,
              reason: `claim for ${chosen[i]}: ${(err as Error).message || 'failed'}`,
            });
          }
        }
      }

      importReport = { added, claimsCreated, skipped };
      if (added > 0) importCsv = '';
    } catch (err: unknown) {
      importError = err instanceof Error ? err.message : 'Import failed';
    } finally {
      importing = false;
    }
  }

  async function advanceStatus() {
    const next = nextStatus[data.order.status];
    if (!next) return;
    statusLoading = true;
    statusError = '';
    try {
      await updateOrder(data.orderId, { status: next });
      location.reload();
    } catch (e: unknown) {
      statusError = e instanceof Error ? e.message : 'Failed to update status';
    } finally {
      statusLoading = false;
    }
  }
</script>

{#if data.order.deadline || isOrganiser}
  <section>
    <h3>Deadline</h3>
    {#if editingDeadline}
      {#if deadlineError}
        <p style="color: var(--color-terracotta);">{deadlineError}</p>
      {/if}
      <div class="flex items-end gap-2">
        <input type="date" bind:value={deadlineInput} disabled={deadlineLoading} />
        <button onclick={saveDeadline} disabled={deadlineLoading}>
          {deadlineLoading ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          class="outline"
          onclick={cancelEditDeadline}
          disabled={deadlineLoading}
        >
          Cancel
        </button>
      </div>
    {:else}
      <p>
        {#if data.order.deadline}
          {formatDeadline(data.order.deadline)}, 11pm
          {#if deadlineText}
            <small> — {deadlineText}</small>
          {/if}
        {:else}
          <small>No deadline set</small>
        {/if}
      </p>
      {#if isOrganiser}
        <button type="button" class="outline" onclick={startEditDeadline}>
          {data.order.deadline ? 'Change deadline' : 'Set deadline'}
        </button>
      {/if}
    {/if}
  </section>
{/if}

<section>
  <h3>Members</h3>
  {#if roleError}
    <p style="color: var(--color-terracotta);">{roleError}</p>
  {/if}
  <figure>
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Initials</th>
          <th>Role</th>
          <th>Joined</th>
          {#if isOrganiser}
            <th></th>
          {/if}
        </tr>
      </thead>
      <tbody>
        {#each data.order.members as member (member.memberId)}
          <tr>
            <td>{member.name ?? '(no name)'}</td>
            <td>{member.initials ?? '–'}</td>
            <td>
              {#if member.role === 'organiser'}
                <mark class="badge-organiser"> Organiser </mark>
              {:else}
                Member
              {/if}
            </td>
            <td>{formatDate(member.joinedAt)}</td>
            {#if isOrganiser}
              <td>
                {#if member.role === 'member'}
                  <ConfirmButton
                    label="Make organiser"
                    onclick={() => handleRoleChange(member.memberId, 'organiser')}
                    disabled={roleLoading}
                    class="outline small"
                  />
                {:else if member.memberId !== auth.user?.id}
                  <ConfirmButton
                    label="Make member"
                    onclick={() => handleRoleChange(member.memberId, 'member')}
                    disabled={roleLoading}
                    class="outline small"
                  />
                {/if}
              </td>
            {/if}
          </tr>
        {/each}
      </tbody>
    </table>
  </figure>
</section>

<section>
  <h3>Invite link</h3>
  <div class="flex items-end gap-2">
    <input type="text" value={inviteUrl} readonly />
    <button onclick={copyInviteLink}>
      {copied ? 'Copied!' : 'Copy link'}
    </button>
  </div>
</section>

{#if isOrganiser && nextStatus[data.order.status]}
  <section>
    <h3>Organiser controls</h3>
    {#if statusError}
      <p style="color: var(--color-terracotta);">{statusError}</p>
    {/if}
    <ConfirmButton
      label={nextStatusLabel[nextStatus[data.order.status] ?? ''] ?? 'Advance status'}
      onclick={advanceStatus}
      disabled={statusLoading}
      class="outline"
    />
  </section>
{/if}

{#if isOrganiser && data.order.status === 'open'}
  <section>
    <details>
      <summary><strong>Import order from Infinity CSV</strong> <small>(testing)</small></summary>
      <p>
        <small>
          Paste a CSV in the same format the reconciliation page copies to the clipboard
          (<code>productCode,cases</code> rows, with or without the header). Each row adds the
          item to the order and creates claims for randomly-chosen members that sum to exactly the
          requested number of cases.
        </small>
      </p>

      <textarea
        bind:value={importCsv}
        disabled={importing}
        rows="8"
        placeholder={'Item number, Quantity\n1005,1\n100510,2'}
        class="import-textarea"
      ></textarea>

      <button onclick={handleImportInfinityCsv} disabled={importing || !importCsv.trim()}>
        {importing ? 'Importing…' : 'Import'}
      </button>

      {#if importError}
        <p style="color: var(--color-terracotta);">{importError}</p>
      {/if}

      {#if importReport}
        <article class="import-report">
          <p>
            Added <strong>{importReport.added}</strong> items,
            created <strong>{importReport.claimsCreated}</strong> claims.
          </p>
          {#if importReport.skipped.length > 0}
            <details>
              <summary>{importReport.skipped.length} skipped</summary>
              <ul>
                {#each importReport.skipped as s, i (i)}
                  <li><code>{s.productCode}</code> — {s.reason}</li>
                {/each}
              </ul>
            </details>
          {/if}
        </article>
      {/if}
    </details>
  </section>
{/if}

<style>
  .flex input[readonly] {
    margin-bottom: 0;
  }

  .import-textarea {
    font-family: var(--pico-font-family-monospace, monospace);
    font-size: 0.9em;
  }

  .import-report {
    margin-top: 1rem;
    padding: 0.75rem 1rem;
  }
</style>
