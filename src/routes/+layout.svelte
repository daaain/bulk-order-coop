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

<header class="site-header">
	<div class="container">
		<a href="/" class="site-logo">
			<span class="logo-leaf" aria-hidden="true">&#x1F33F;</span>
			<span>Bulk Order Co-op</span>
		</a>

		<nav>
			<ul class="nav-links">
				{#if auth.isAuthenticated}
					<li><a href="/orders">Orders</a></li>
					<li>
						<span class="nav-user">
							<span class="nav-avatar">{auth.user?.initials ?? '?'}</span>
						</span>
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
	</div>
</header>

<main class="site-main">
	<div class="container">
		{@render children()}
	</div>
</main>

<footer class="site-footer">
	<div class="container">
		<small>Bulk Order Co-op &middot; Coordinating community food orders</small>
	</div>
</footer>
