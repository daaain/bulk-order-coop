<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: Snippet } = $props();

  const statusColours: Record<string, string> = {
    open: '#2ecc40',
    closed: '#ff851b',
    reconciling: '#0074d9',
    complete: '#aaa',
  };

  const statusLabels: Record<string, string> = {
    open: 'Open',
    closed: 'Closed',
    reconciling: 'Reconciling',
    complete: 'Complete',
  };

  const badgeColour = $derived(statusColours[data.order.status] ?? '#aaa');
  const statusLabel = $derived(statusLabels[data.order.status] ?? data.order.status);
</script>

<svelte:head>
	<title>{data.order.name} — Bulk Order Co-op</title>
</svelte:head>

<hgroup>
  <h2>{data.order.name}</h2>
  <p>
    <mark
      style="background: {badgeColour}; color: white; padding: 0.2em 0.6em; border-radius: 4px;"
    >
      {statusLabel}
    </mark>
  </p>
</hgroup>

<nav aria-label="Order navigation">
  <ul>
    <li><a href="/orders/{data.orderId}">Dashboard</a></li>
    <li><a href="/orders/{data.orderId}/catalogue">Catalogue</a></li>
    <li><a href="/orders/{data.orderId}/claims">Claims</a></li>
    <li><a href="/orders/{data.orderId}/reconciliation">Reconciliation</a></li>
  </ul>
</nav>

{@render children()}
