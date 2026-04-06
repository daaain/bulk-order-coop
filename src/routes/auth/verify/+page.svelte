<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { useAuth } from '$lib/auth.svelte';
  import { apiFetch } from '$lib/api';

  const auth = useAuth();

  let verifying = $state(true);
  let error = $state('');

  $effect(() => {
    const token = $page.url.searchParams.get('token');
    if (!token) {
      error = 'No verification token provided';
      verifying = false;
      return;
    }

    apiFetch<{
      token: string;
      user: {
        id: string;
        email: string;
        name: string | null;
        initials: string | null;
      };
      isNewUser: boolean;
    }>(`/auth/verify?token=${token}`)
      .then((data) => {
        auth.login(data.token, data.user);
        if (data.isNewUser || !data.user.name || !data.user.initials) {
          goto('/auth/profile');
        } else {
          goto('/orders');
        }
      })
      .catch((err) => {
        error = err instanceof Error ? err.message : 'Verification failed';
      })
      .finally(() => {
        verifying = false;
      });
  });
</script>

<svelte:head>
  <title>Verify — Bulk Order Co-op</title>
</svelte:head>

<div class="auth-card animate-in">
  <h1>Signing in</h1>

  {#if verifying}
    <p aria-busy="true">Verifying your sign-in link...</p>
  {:else if error}
    <section>
      <p><mark>{error}</mark></p>
      <a href="/" role="button">Back to sign in</a>
    </section>
  {/if}
</div>
