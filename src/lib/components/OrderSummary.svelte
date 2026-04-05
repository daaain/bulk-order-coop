<script lang="ts">
  import type { OrderWithMemberCount } from '$shared/types';

  let { order }: { order: OrderWithMemberCount } = $props();

  const statusLabels: Record<string, string> = {
    open: 'Open',
    closed: 'Closed',
    reconciling: 'Reconciling',
    complete: 'Complete'
  };

  const deadlineInfo = $derived.by(() => {
    if (!order.deadline) return null;
    const now = Date.now();
    const deadlineMs = order.deadline * 1000;
    const diffDays = Math.ceil((deadlineMs - now) / (1000 * 60 * 60 * 24));
    if (diffDays > 1) return `${diffDays} days left`;
    if (diffDays === 1) return '1 day left';
    if (diffDays === 0) return 'Due today';
    if (diffDays === -1) return 'Deadline passed 1 day ago';
    return `Deadline passed ${Math.abs(diffDays)} days ago`;
  });

  const memberLabel = $derived(order.memberCount === 1 ? '1 member' : `${order.memberCount} members`);
</script>

<a href="/orders/{order.id}" class="order-link">
  <article>
    <header>
      <strong>{order.name}</strong>
      <mark class="badge-{order.status}">{statusLabels[order.status]}</mark>
    </header>
    <p>{memberLabel}</p>
    {#if order.deadline}
      <p>Deadline: {new Date(order.deadline * 1000).toLocaleDateString('en-GB')}</p>
      <p><small>{deadlineInfo}</small></p>
    {/if}
  </article>
</a>

<style>
  .order-link {
    text-decoration: none;
    color: inherit;
  }
</style>
