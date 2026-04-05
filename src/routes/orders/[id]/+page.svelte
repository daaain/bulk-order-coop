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

  const isOrganiser = $derived(
    data.order.members.some(
      (m) => m.memberId === auth.user?.id && m.role === 'organiser',
    ),
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
    typeof window !== 'undefined'
      ? `${window.location.origin}/join/${data.order.inviteCode}`
      : '',
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

  async function advanceStatus() {
    const next = nextStatus[data.order.status];
    if (!next) return;
    statusLoading = true;
    statusError = '';
    try {
      await updateOrder(data.orderId, { status: next });
      location.reload();
    } catch (e: unknown) {
      statusError =
        e instanceof Error ? e.message : 'Failed to update status';
    } finally {
      statusLoading = false;
    }
  }
</script>

{#if data.order.deadline}
  <section>
    <h3>Deadline</h3>
    <p>
      {formatDate(data.order.deadline)}
      {#if deadlineText}
        <small> — {deadlineText}</small>
      {/if}
    </p>
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
                <mark class="badge-organiser">
                  Organiser
                </mark>
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
