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
	<span style="white-space: nowrap;">
		{confirmLabel}
		<button class="outline {className}" {disabled} onclick={handleConfirm} style="padding: 0.2em 0.6em; font-size: 0.85em; margin-left: 0.25rem;">
			Yes
		</button>
		<button class="outline secondary" {disabled} onclick={handleCancel} style="padding: 0.2em 0.6em; font-size: 0.85em; margin-left: 0.25rem;">
			Cancel
		</button>
	</span>
{:else}
	<button class={className} {disabled} onclick={handleClick}>
		{label}
	</button>
{/if}
