<script lang="ts">
	import '../app.css';
	import type { Snippet } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { useAuth } from '$lib/auth.svelte';

	let { children }: { children: Snippet } = $props();

	const auth = useAuth();

	// Public routes that don't require authentication
	const publicRoutes = ['/', '/auth/verify', '/auth/profile'];

	$effect(() => {
		const path = $page.url.pathname;
		const isPublic = publicRoutes.some((r) => path === r || path.startsWith('/join/'));

		if (!auth.isAuthenticated && !isPublic) {
			goto('/');
		}
	});
</script>

<svelte:head>
	<title>Bulk Order Co-op</title>
</svelte:head>

<header class="container">
	<nav>
		<ul>
			<li><a href="/"><strong>Bulk Order Co-op</strong></a></li>
		</ul>
		<ul>
			{#if auth.isAuthenticated}
				<li><a href="/orders">Orders</a></li>
				<li>
					<small>{auth.user?.initials ?? auth.user?.email}</small>
				</li>
				<li>
					<a
						href="/"
						onclick={(e) => {
							e.preventDefault();
							auth.logout();
							goto('/');
						}}>Sign out</a
					>
				</li>
			{/if}
		</ul>
	</nav>
</header>

<main class="container">
	{@render children()}
</main>

<footer class="container">
	<small>Bulk Order Co-op</small>
</footer>
