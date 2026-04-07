<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { useAuth } from '$lib/auth.svelte';
  import { apiFetch } from '$lib/api';
  import { safeRedirect } from '$lib/redirect';

  const auth = useAuth();

  let email = $state('');
  let sending = $state(false);
  let sent = $state(false);
  let error = $state('');

  const redirect = $derived(safeRedirect($page.url.searchParams.get('redirect')));

  // If already authenticated, redirect to the requested destination (or orders)
  $effect(() => {
    if (auth.isAuthenticated) {
      goto(redirect ?? '/orders');
    }
  });

  async function handleSubmit(e: Event) {
    e.preventDefault();
    sending = true;
    error = '';

    try {
      await apiFetch('/auth/magic-link', {
        method: 'POST',
        body: JSON.stringify({ email, redirect }),
      });
      sent = true;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to send magic link';
    } finally {
      sending = false;
    }
  }
</script>

<svelte:head>
  <title>Sign In — Bulk Order Co-op</title>
</svelte:head>

<div class="hero">
  <hgroup>
    <h1 class="animate-in">Bulk Order Co-op</h1>
    <p class="animate-in stagger-1">Coordinate bulk food orders with your community</p>
  </hgroup>
</div>

{#if sent}
  <div class="auth-card animate-in stagger-2" style="text-align: center;">
    <p style="font-size: 2.5rem; margin-bottom: 0.25rem;">&#x2709;&#xFE0F;</p>
    <h2>Check your email</h2>
    <p>We've sent a sign-in link to <strong>{email}</strong>.</p>
    <p>Click the link in the email to sign in. It expires in 15 minutes.</p>
    <button
      onclick={() => {
        sent = false;
        email = '';
      }}>Send another link</button
    >
  </div>
{:else}
  <div class="auth-card animate-in stagger-2">
    <h2>Sign in</h2>
    {#if error}
      <p><mark>{error}</mark></p>
    {/if}
    <form onsubmit={handleSubmit}>
      <label>
        Email address
        <input type="email" bind:value={email} placeholder="you@example.com" required />
      </label>
      <button type="submit" aria-busy={sending} disabled={sending}>
        {sending ? 'Sending...' : 'Send magic link'}
      </button>
    </form>
  </div>
{/if}
