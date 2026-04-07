<script lang="ts">
  import type { PageData } from './$types';
  import { useAuth } from '$lib/auth.svelte';
  import { updateOrder } from '$lib/orders';
  import ConfirmButton from '$lib/components/ConfirmButton.svelte';

  let { data }: { data: PageData } = $props();

  const auth = useAuth();

  let copied = $state(false);
  let statusLoading = $state(false);
  let statusError = $state('');

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
  <figure>
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Initials</th>
          <th>Role</th>
          <th>Joined</th>
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

<style>
  .flex input[readonly] {
    margin-bottom: 0;
  }
</style>
