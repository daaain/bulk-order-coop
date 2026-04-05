<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { LayoutData } from './$types';
  import { page } from '$app/stores';

  let { data, children }: { data: LayoutData; children: Snippet } = $props();

  const statusLabels: Record<string, string> = {
    open: 'Open',
    closed: 'Closed',
    reconciling: 'Reconciling',
    complete: 'Complete',
  };

  const statusLabel = $derived(statusLabels[data.order.status] ?? data.order.status);

  const tabs = $derived([
    { href: `/orders/${data.orderId}`, label: 'Dashboard', exact: true },
    { href: `/orders/${data.orderId}/catalogue`, label: 'Catalogue' },
    { href: `/orders/${data.orderId}/claims`, label: 'Claims' },
    { href: `/orders/${data.orderId}/reconciliation`, label: 'Reconciliation' },
  ]);

  function isActive(tab: { href: string; exact?: boolean }, pathname: string): boolean {
    return tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
  }
</script>

<svelte:head>
	<title>{data.order.name} — Bulk Order Co-op</title>
</svelte:head>

<hgroup class="animate-in">
  <h2>{data.order.name}</h2>
  <p>
    <mark class="badge-{data.order.status}">
      {statusLabel}
    </mark>
  </p>
</hgroup>

<nav class="tab-nav" aria-label="Order navigation">
  {#each tabs as tab}
    <a href={tab.href} class:active={isActive(tab, $page.url.pathname)}>{tab.label}</a>
  {/each}
</nav>

{@render children()}
