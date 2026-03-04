<script lang="ts">
	let {
		query = $bindable(''),
		organicOnly = $bindable(false),
		onOfferOnly = $bindable(false),
		selectedBrand = $bindable(''),
		brands = []
	}: {
		query: string;
		organicOnly: boolean;
		onOfferOnly: boolean;
		selectedBrand: string;
		brands: string[];
	} = $props();
</script>

<div role="search">
	<input
		type="search"
		bind:value={query}
		placeholder="Search products..."
		aria-label="Search products"
	/>
	<fieldset>
		<label>
			<input type="checkbox" bind:checked={organicOnly} />
			Organic only
		</label>
		<label>
			<input type="checkbox" bind:checked={onOfferOnly} />
			On offer only
		</label>
		<select bind:value={selectedBrand} aria-label="Filter by brand">
			<option value="">All brands</option>
			{#each brands as brand}
				<option value={brand}>{brand}</option>
			{/each}
		</select>
	</fieldset>
</div>

<style>
	div[role="search"] {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		margin-bottom: 1rem;
		--pico-group-box-shadow: none;
		--pico-group-box-shadow-focus-with-input: none;
		box-shadow: none;
	}

	div[role="search"] input[type="search"] {
		flex: 1 1 200px;
		margin-bottom: 0;
	}

	fieldset {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		align-items: center;
		border: none;
		padding: 0;
		margin: 0;
	}

	fieldset label {
		margin-bottom: 0;
		white-space: nowrap;
	}

	fieldset select {
		margin-bottom: 0;
		width: auto;
	}
</style>
