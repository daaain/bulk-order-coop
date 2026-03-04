<script lang="ts">
	import type { RoundingResult } from '$shared/types';

	let {
		rounding,
		packSize,
		isPackaged = false
	}: {
		rounding: RoundingResult;
		packSize?: number;
		isPackaged?: boolean;
	} = $props();

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

	function toPackDisplay(amount: number): number {
		return packSize && packSize > 0 ? Math.round(amount / packSize) : amount;
	}
</script>

<div class="rounding-bar">
	<progress value={fillPercent} max="100" style="--pico-progress-color: {colour};"></progress>
	<small style="color: {colour};">
		{statusLabels[rounding.status]}
		{#if rounding.gap > 0 && rounding.status !== 'ready'}
			— need {isPackaged ? `${toPackDisplay(rounding.gap)} more pack${toPackDisplay(rounding.gap) !== 1 ? 's' : ''}` : `${rounding.gap} more`}
		{/if}
		&middot;
		{#if isPackaged}
			{toPackDisplay(rounding.totalClaimed)}/{toPackDisplay(rounding.casesNeeded * rounding.caseSize)} packs
		{:else}
			{rounding.totalClaimed}/{rounding.casesNeeded * rounding.caseSize}
		{/if}
		({rounding.casesNeeded} case{rounding.casesNeeded !== 1 ? 's' : ''})
	</small>
</div>
