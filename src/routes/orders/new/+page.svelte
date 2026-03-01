<script lang="ts">
	import { goto } from '$app/navigation';
	import { apiFetch } from '$lib/api';
	import { createOrder } from '$lib/orders';

	type Catalogue = { id: string; name: string; uploadedAt: number; itemCount: number };

	let name = $state('');
	let deadline = $state('');
	let catalogueSource = $state<'existing' | 'upload'>('upload');
	let selectedCatalogueId = $state('');
	let catalogueName = $state('');
	let file = $state<File | null>(null);
	let loading = $state(false);
	let error = $state('');
	let submitted = $state(false);

	let catalogues = $state<Catalogue[]>([]);
	let cataloguesLoading = $state(true);

	let nameInvalid = $derived(submitted && !name.trim());
	let catalogueInvalid = $derived(
		submitted &&
			((catalogueSource === 'existing' && !selectedCatalogueId) ||
				(catalogueSource === 'upload' && !file))
	);

	$effect(() => {
		apiFetch<Catalogue[]>('/catalogues')
			.then((data) => {
				catalogues = data;
			})
			.catch((err) => {
				error = err instanceof Error ? err.message : 'Failed to load catalogues';
			})
			.finally(() => {
				cataloguesLoading = false;
			});
	});

	function handleFileChange(e: Event) {
		const input = e.target as HTMLInputElement;
		file = input.files?.[0] ?? null;
	}

	async function uploadCatalogue(catName: string, csvFile: File): Promise<string> {
		const formData = new FormData();
		formData.append('name', catName);
		formData.append('file', csvFile);

		const headers: Record<string, string> = {};
		const token = localStorage.getItem('auth_token');
		if (token) {
			headers['Authorization'] = `Bearer ${token}`;
		}

		const res = await fetch('/api/catalogues', {
			method: 'POST',
			headers,
			body: formData
		});

		if (!res.ok) {
			const body = await res.text();
			throw new Error(body);
		}

		const data: { id: string; name: string; itemCount: number } = await res.json();
		return data.id;
	}

	async function handleSubmit(e: Event) {
		e.preventDefault();
		submitted = true;

		if (!name.trim()) return;
		if (catalogueSource === 'existing' && !selectedCatalogueId) return;
		if (catalogueSource === 'upload' && !file) return;

		loading = true;
		error = '';

		try {
			let catalogueId: string;

			if (catalogueSource === 'upload') {
				const uploadName = catalogueName.trim() || file!.name.replace(/\.csv$/i, '');
				catalogueId = await uploadCatalogue(uploadName, file!);
			} else {
				catalogueId = selectedCatalogueId;
			}

			const orderData: { name: string; catalogueId: string; deadline?: number } = {
				name: name.trim(),
				catalogueId
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

<h1>Create New Order</h1>

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
	</label>

	<fieldset>
		<legend>Catalogue source</legend>
		<label>
			<input
				type="radio"
				name="catalogueSource"
				value="existing"
				bind:group={catalogueSource}
				disabled={loading || cataloguesLoading}
			/>
			Use existing catalogue
		</label>
		<label>
			<input
				type="radio"
				name="catalogueSource"
				value="upload"
				bind:group={catalogueSource}
				disabled={loading}
			/>
			Upload new CSV
		</label>
	</fieldset>

	{#if catalogueSource === 'existing'}
		<label>
			Select catalogue
			{#if cataloguesLoading}
				<select disabled aria-busy="true">
					<option>Loading catalogues...</option>
				</select>
			{:else if catalogues.length === 0}
				<select disabled>
					<option>No catalogues available — upload a CSV instead</option>
				</select>
			{:else}
				<select
					bind:value={selectedCatalogueId}
					aria-invalid={catalogueInvalid ? true : undefined}
					disabled={loading}
				>
					<option value="">Choose a catalogue...</option>
					{#each catalogues as cat}
						<option value={cat.id}>{cat.name} ({cat.itemCount} items)</option>
					{/each}
				</select>
			{/if}
			{#if catalogueInvalid}<small>Please select a catalogue.</small>{/if}
		</label>
	{:else}
		<label>
			Catalogue name (optional)
			<input
				type="text"
				bind:value={catalogueName}
				placeholder="e.g. February 2026 Price List"
				disabled={loading}
			/>
			<small>Leave blank to use the file name.</small>
		</label>

		<label>
			Catalogue CSV
			<input
				type="file"
				accept=".csv"
				onchange={handleFileChange}
				aria-invalid={catalogueInvalid ? true : undefined}
				disabled={loading}
			/>
			{#if catalogueInvalid}<small>Please select a CSV file.</small>{/if}
		</label>
	{/if}

	<div role="group">
		<button type="submit" aria-busy={loading} disabled={loading}>
			{loading ? 'Creating...' : 'Create order'}
		</button>
		<a href="/orders" role="button" class="outline">Cancel</a>
	</div>
</form>
