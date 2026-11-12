<script lang="ts">
	import Check from '@lucide/svelte/icons/check';

	/** The round check for a day's request (Days tab, request page). Inside a `group` button, it previews the check on hover. */
	let { checked }: { checked: boolean } = $props();
</script>

<span
	aria-hidden="true"
	class={[
		'grid size-6 shrink-0 place-items-center rounded-full border-2 transition-colors duration-150',
		checked
			? 'border-sage bg-sage text-background'
			: 'border-muted-foreground/50 text-candle group-hover:border-candle/70'
	]}
>
	<Check
		class={[
			'size-4 transition-opacity duration-150',
			checked ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'
		]}
		strokeWidth={3}
	/>
</span>
