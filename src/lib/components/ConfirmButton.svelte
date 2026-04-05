<script lang="ts">
	let {
		label,
		confirmLabel = 'Are you sure?',
		onclick,
		disabled = false,
		class: className = ''
	}: {
		label: string;
		confirmLabel?: string;
		onclick: () => void;
		disabled?: boolean;
		class?: string;
	} = $props();

	let confirming = $state(false);
	let timer: ReturnType<typeof setTimeout> | null = null;

	function handleClick() {
		if (!confirming) {
			confirming = true;
			timer = setTimeout(() => {
				confirming = false;
			}, 3000);
		}
	}

	function handleConfirm() {
		confirming = false;
		if (timer) clearTimeout(timer);
		onclick();
	}

	function handleCancel() {
		confirming = false;
		if (timer) clearTimeout(timer);
	}
</script>

{#if confirming}
	<span class="confirm-prompt">
		{confirmLabel}
		<button class="ghost {className}" {disabled} onclick={handleConfirm}>
			Yes
		</button>
		<button class="ghost secondary" {disabled} onclick={handleCancel}>
			Cancel
		</button>
	</span>
{:else}
	<button class={className} {disabled} onclick={handleClick}>
		{label}
	</button>
{/if}

<style>
	.confirm-prompt {
		white-space: nowrap;
	}

	.confirm-prompt button {
		padding: var(--space-1) var(--space-2);
		font-size: var(--text-sm);
		margin-left: var(--space-1);
	}
</style>
