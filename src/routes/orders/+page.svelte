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

<h1 class="animate-in">My Orders</h1>

<div class="flex flex-wrap items-end gap-4 mb-8">
  <a href="/orders/new" role="button">Create new order</a>
  <form onsubmit={handleJoin} class="flex items-end gap-2">
    <input
      class="invite-input"
      type="text"
      bind:value={inviteCode}
      placeholder="Enter invite code"
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

<style>
  .invite-input {
    margin-bottom: 0;
  }
</style>
