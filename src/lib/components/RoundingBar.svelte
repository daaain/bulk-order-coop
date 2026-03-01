<script lang="ts">
	import type { RoundingResult } from '$shared/types';

	let { rounding }: { rounding: RoundingResult } = $props();

	const statusLabels: Record<string, string> = {
		ready: 'Ready to order',
		nearly: 'Nearly there',
		needs_more: 'Needs more takers',
		over: 'Over — flexible members can reduce'
	};

	const statusColours: Record<string, string> = {
		ready: '#2ecc40',
		nearly: '#ff851b',
		needs_more: '#ff4136',
		over: '#0074d9'
	};

	let fillPercent = $derived(
		rounding.casesNeeded > 0
			? Math.min(100, (rounding.totalClaimed / (rounding.casesNeeded * rounding.caseSize)) * 100)
			: 0
	);

	let colour = $derived(statusColours[rounding.status] ?? '#aaa');
</script>

<div class="rounding-bar">
	<progress value={fillPercent} max="100" style="--pico-progress-color: {colour};"></progress>
	<small style="color: {colour};">
		{statusLabels[rounding.status]}
		{#if rounding.gap > 0 && rounding.status !== 'ready'}
			— need {rounding.gap} more
		{/if}
		&middot;
		{rounding.totalClaimed}/{rounding.casesNeeded * rounding.caseSize}
		({rounding.casesNeeded} case{rounding.casesNeeded !== 1 ? 's' : ''})
	</small>
</div>
