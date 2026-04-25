<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { LayoutData } from './$types';
  import { page } from '$app/stores';
  import { tick } from 'svelte';

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
    { href: `/orders/${data.orderId}/submission`, label: 'Submission' },
    { href: `/orders/${data.orderId}/invoice`, label: 'Invoice' },
    { href: `/orders/${data.orderId}/delivery`, label: 'Delivery' },
  ]);

  function isActive(tab: { href: string; exact?: boolean }, pathname: string): boolean {
    return tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
  }

  let navEl: HTMLElement | undefined = $state();
  let indicatorLeft = $state(0);
  let indicatorWidth = $state(0);
  let indicatorReady = $state(false);

  async function measureIndicator() {
    await tick();
    if (!navEl) return;
    const active = navEl.querySelector<HTMLAnchorElement>('a.active');
    if (!active) {
      indicatorWidth = 0;
      return;
    }
    indicatorLeft = active.offsetLeft;
    indicatorWidth = active.offsetWidth;
  }

  $effect(() => {
    void $page.url.pathname;
    void data.orderId;
    measureIndicator().then(() => {
      indicatorReady = true;
    });
  });

  $effect(() => {
    const onResize = () => measureIndicator();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });
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

<nav
  class="tab-nav"
  class:indicator-ready={indicatorReady}
  aria-label="Order navigation"
  bind:this={navEl}
  style="--indicator-left: {indicatorLeft}px; --indicator-width: {indicatorWidth}px;"
>
  {#each tabs as tab}
    <a href={tab.href} class:active={isActive(tab, $page.url.pathname)}>{tab.label}</a>
  {/each}
</nav>

{@render children()}
