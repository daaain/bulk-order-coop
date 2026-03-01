<script lang="ts">
  import { goto } from '$app/navigation';
  import type { PageData } from './$types';
  import { useAuth } from '$lib/auth.svelte';
  import { joinOrder } from '$lib/orders';

  let { data }: { data: PageData } = $props();

  const auth = useAuth();

  let joining = $state(false);
  let error = $state('');

  async function handleJoin() {
    if (!data.preview) return;
    joining = true;
    error = '';
    try {
      await joinOrder(data.preview.id, data.code);
      goto(`/orders/${data.preview.id}`);
    } catch (e: any) {
      if (e.status === 409) {
        // Already a member — just redirect
        goto(`/orders/${data.preview.id}`);
      } else {
        error = e.message || 'Failed to join order';
      }
    } finally {
      joining = false;
    }
  }
</script>

<svelte:head>
	<title>Join Order — Bulk Order Co-op</title>
</svelte:head>

<h1>Join Order</h1>

{#if !auth.isAuthenticated}
  <section>
    <p>You need to sign in before joining an order.</p>
    <a href="/" role="button">Sign in</a>
  </section>
{:else if data.error}
  <section>
    <p>This invite link doesn't seem to be valid. Please check the link and try again.</p>
    <a href="/orders" role="button" class="secondary">Go to my orders</a>
  </section>
{:else if data.preview}
  <article>
    <header>
      <strong>{data.preview.name}</strong>
    </header>
    <p>{data.preview.memberCount} {data.preview.memberCount === 1 ? 'member' : 'members'} so far</p>
    {#if data.preview.status !== 'open'}
      <p>This order is no longer accepting new members.</p>
    {:else}
      <footer>
        <button onclick={handleJoin} aria-busy={joining} disabled={joining}>
          {joining ? 'Joining...' : 'Join this order'}
        </button>
      </footer>
    {/if}
    {#if error}
      <p style="color: var(--pico-color-red-500);">{error}</p>
    {/if}
  </article>
{/if}
