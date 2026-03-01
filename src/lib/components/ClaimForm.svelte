<script lang="ts">
	let {
		unit = '',
		initialAmount = 0,
		initialFlexibility = '*',
		loading = false,
		onsubmit,
		oncancel
	}: {
		unit?: string;
		initialAmount?: number;
		initialFlexibility?: string;
		loading?: boolean;
		onsubmit: (amount: number, flexibility: string) => void;
		oncancel?: () => void;
	} = $props();

	let amount = $state(initialAmount);
	let flexibility = $state(initialFlexibility);

	let step = $derived(
		unit === 'kg' || unit === 'l' || unit === 'g' || unit === 'ml' ? 0.1 : 1
	);
</script>

<form
	onsubmit={(e) => {
		e.preventDefault();
		onsubmit(amount, flexibility);
	}}
>
	<label>
		Amount{unit ? ` (${unit})` : ''}
		<input type="number" bind:value={amount} min={step} {step} required disabled={loading} />
	</label>

	<fieldset>
		<legend>Flexibility</legend>
		<label>
			<input type="radio" bind:group={flexibility} value="*" disabled={loading} />
			Exact only
		</label>
		<label>
			<input type="radio" bind:group={flexibility} value="+" disabled={loading} />
			Can take more
		</label>
		<label>
			<input type="radio" bind:group={flexibility} value="-" disabled={loading} />
			Can take less
		</label>
		<label>
			<input type="radio" bind:group={flexibility} value="+-" disabled={loading} />
			Flexible either way
		</label>
	</fieldset>

	<div role="group">
		<button type="submit" disabled={loading} aria-busy={loading}>
			Save claim
		</button>
		{#if oncancel}
			<button type="button" class="secondary" onclick={oncancel} disabled={loading}>
				Cancel
			</button>
		{/if}
	</div>
</form>
