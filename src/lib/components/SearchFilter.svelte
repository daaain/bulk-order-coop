<script lang="ts">
	let {
		query = $bindable(''),
		organicOnly = $bindable(false),
		selectedBrand = $bindable(''),
		brands = []
	}: {
		query: string;
		organicOnly: boolean;
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
		<select bind:value={selectedBrand} aria-label="Filter by brand">
			<option value="">All brands</option>
			{#each brands as brand}
				<option value={brand}>{brand}</option>
			{/each}
		</select>
	</fieldset>
</div>
