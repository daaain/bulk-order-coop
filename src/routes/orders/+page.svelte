<script lang="ts">
  import { goto } from '$app/navigation';
  import type { PageData } from './$types';
  import OrderSummary from '$lib/components/OrderSummary.svelte';

  let { data }: { data: PageData } = $props();
  let inviteCode = $state('');

  function handleJoin(e: Event) {
    e.preventDefault();
    if (inviteCode.trim()) {
      goto(`/join/${inviteCode.trim()}`);
    }
  }
</script>

<svelte:head>
	<title>My Orders — Bulk Order Co-op</title>
</svelte:head>

<h1>My Orders</h1>

<div style="display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 2rem;">
  <a href="/orders/new" role="button">Create new order</a>
  <form onsubmit={handleJoin} style="display: flex; gap: 0.5rem; align-items: flex-end;">
    <input
      type="text"
      bind:value={inviteCode}
      placeholder="Enter invite code"
      style="margin-bottom: 0;"
    />
    <button type="submit">Join</button>
  </form>
</div>

{#if data.orders.length === 0}
  <section>
    <p>No orders yet. Create one or join with an invite code.</p>
  </section>
{:else}
  <div class="grid">
    {#each data.orders as order (order.id)}
      <OrderSummary {order} />
    {/each}
  </div>
{/if}
