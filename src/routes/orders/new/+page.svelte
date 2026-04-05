<script lang="ts">
	import { goto } from '$app/navigation';
	import { createOrder } from '$lib/orders';
	import { parseCatalogueCsv } from '$shared/csv';
	import { storeCatalogue } from '$lib/catalogue-db';

	const dateFormatter = new Intl.DateTimeFormat('en-US', {
		month: 'long',
		year: 'numeric'
	});
	const now = new Date();
	let name = $state(`${dateFormatter.format(now)} Order`);

	function nextWednesdaySecondWeek(): string {
		const d = new Date(now);
		// Move to next Wednesday (day 3)
		const daysUntilWed = (3 - d.getDay() + 7) % 7 || 7;
		d.setDate(d.getDate() + daysUntilWed + 7); // +7 for second week
		return d.toISOString().slice(0, 10);
	}

	let deadline = $state(nextWednesdaySecondWeek());

	const dayOfWeekFormatter = new Intl.DateTimeFormat('en-GB', { weekday: 'long' });
	let deadlineDayOfWeek = $derived(
		deadline ? dayOfWeekFormatter.format(new Date(deadline + 'T00:00:00')) : ''
	);
	let file = $state<File | null>(null);
	let loading = $state(false);
	let error = $state('');
	let submitted = $state(false);

	let nameInvalid = $derived(submitted && !name.trim());
	let fileInvalid = $derived(submitted && !file);

	function handleFileChange(e: Event) {
		const input = e.target as HTMLInputElement;
		file = input.files?.[0] ?? null;
	}

	async function uploadCatalogue(csvFile: File): Promise<{ key: string; csvText: string }> {
		const headers: Record<string, string> = {};
		const token = localStorage.getItem('auth_token');
		if (token) {
			headers['Authorization'] = `Bearer ${token}`;
		}

		const formData = new FormData();
		formData.append('file', csvFile);

		const res = await fetch('/api/catalogues', {
			method: 'POST',
			headers,
			body: formData
		});

		if (!res.ok) {
			const body = await res.text();
			throw new Error(body);
		}

		const data: { key: string; itemCount: number } = await res.json();
		const csvText = await csvFile.text();
		return { key: data.key, csvText };
	}

	async function handleSubmit(e: Event) {
		e.preventDefault();
		submitted = true;

		if (!name.trim()) return;
		if (!file) return;

		loading = true;
		error = '';

		try {
			const { key, csvText } = await uploadCatalogue(file);

			// Parse and cache in IndexedDB for immediate browsing
			const items = parseCatalogueCsv(csvText);
			await storeCatalogue(key, items);

			const orderData: { name: string; catalogueKey: string; deadline?: number } = {
				name: name.trim(),
				catalogueKey: key
			};

			if (deadline) {
				orderData.deadline = Math.floor(new Date(deadline).getTime() / 1000);
			}

			const order = await createOrder(orderData);
			goto(`/orders/${order.id}`);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to create order';
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>New Order — Bulk Order Co-op</title>
</svelte:head>

<div class="container-narrow">
	<h1 class="animate-in">Create New Order</h1>

	{#if error}
		<p><mark>{error}</mark></p>
	{/if}

	<form onsubmit={handleSubmit}>
		<label>
			Order name
			<input
				type="text"
				bind:value={name}
				placeholder="e.g. January 2026 Order"
				required
				aria-invalid={nameInvalid ? true : undefined}
				disabled={loading}
			/>
			{#if nameInvalid}<small>Please enter an order name.</small>{/if}
		</label>

		<label>
			Deadline (optional)
			<input type="date" bind:value={deadline} disabled={loading} />
			{#if deadlineDayOfWeek}<small>{deadlineDayOfWeek}</small>{/if}
		</label>

		<label>
			Catalogue CSV
			<input
				type="file"
				accept=".csv"
				onchange={handleFileChange}
				aria-invalid={fileInvalid ? true : undefined}
				disabled={loading}
			/>
			{#if fileInvalid}<small>Please select a CSV file.</small>{/if}
		</label>

		<div role="group">
			<button type="submit" aria-busy={loading} disabled={loading}>
				{loading ? 'Creating...' : 'Create order'}
			</button>
			<a href="/orders" role="button" class="outline">Cancel</a>
		</div>
	</form>
</div>
