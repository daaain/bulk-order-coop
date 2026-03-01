<script lang="ts">
	import { goto } from '$app/navigation';
	import { useAuth } from '$lib/auth.svelte';
	import { apiFetch } from '$lib/api';

	const auth = useAuth();

	let name = $state(auth.user?.name ?? '');
	let initials = $state(auth.user?.initials ?? '');
	let saving = $state(false);
	let error = $state('');

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (!auth.user) return;

		saving = true;
		error = '';

		try {
			const data = await apiFetch<{
				user: { id: string; email: string; name: string; initials: string };
			}>('/auth/profile', {
				method: 'PUT',
				body: JSON.stringify({
					memberId: auth.user.id,
					name,
					initials
				})
			});
			auth.updateUser(data.user);
			goto('/orders');
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to save profile';
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head>
	<title>Profile — Bulk Order Co-op</title>
</svelte:head>

<h1>Complete your profile</h1>

<p>We need a few details so other members can identify you in orders.</p>

{#if error}
	<p><mark>{error}</mark></p>
{/if}

<form onsubmit={handleSubmit}>
	<label>
		Your name
		<input type="text" bind:value={name} placeholder="e.g. Jane Smith" required />
	</label>

	<label>
		Initials (2-3 characters)
		<input
			type="text"
			bind:value={initials}
			placeholder="e.g. JS"
			minlength="2"
			maxlength="3"
			required
		/>
		<small>Used to identify your claims in shared views</small>
	</label>

	<button type="submit" aria-busy={saving} disabled={saving}>
		{saving ? 'Saving...' : 'Save and continue'}
	</button>
</form>
