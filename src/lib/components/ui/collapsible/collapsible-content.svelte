<script lang="ts">
	import { Collapsible as CollapsiblePrimitive } from 'bits-ui';
	import { slide } from 'svelte/transition';

	let {
		ref = $bindable(null),
		children,
		...restProps
	}: CollapsiblePrimitive.ContentProps = $props();
</script>

<!-- Stays mounted so Svelte can slide it open and closed instead of popping. -->
<CollapsiblePrimitive.Content bind:ref data-slot="collapsible-content" forceMount {...restProps}>
	{#snippet child({ props, open })}
		{#if open}
			<div {...props} transition:slide={{ duration: 200 }}>
				{@render children?.()}
			</div>
		{/if}
	{/snippet}
</CollapsiblePrimitive.Content>
