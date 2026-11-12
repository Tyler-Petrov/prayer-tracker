<script lang="ts">
	import Minus from '@lucide/svelte/icons/minus';
	import Plus from '@lucide/svelte/icons/plus';
	import { Button } from '#lib/components/ui/button/index.js';

	let {
		value = $bindable(),
		min = 1,
		max = 100,
		noun,
		before
	}: {
		value: number;
		min?: number;
		max?: number;
		/** Plural, after the number: "days" reads "9 days", "1 day". */
		noun: string;
		/** Words before the number: "Every" reads "Every 9 days". */
		before?: string;
	} = $props();

	const label = $derived(value === 1 ? noun.replace(/s$/, '') : noun);
	const id = $props.id();
</script>

<!-- − and + nudge from the outer edges; the number itself can be typed into (every 90 days). -->
<div
	class="flex h-12 w-full items-center justify-between rounded-full border border-border bg-card px-1 sm:max-w-72"
>
	<Button
		variant="ghost"
		size="icon"
		class="size-10 rounded-full"
		aria-label="Fewer {noun}"
		disabled={value <= min}
		onclick={() => (value = Math.max(min, value - 1))}
	>
		<Minus />
	</Button>
	<label for={id} class="flex items-baseline gap-1.5 whitespace-nowrap">
		{#if before}<span class="text-sm text-muted-foreground">{before}</span>{/if}
		<input
			{id}
			{value}
			inputmode="numeric"
			autocomplete="off"
			size={Math.max(1, String(value).length)}
			class="[field-sizing:content] w-auto min-w-[1ch] rounded-sm bg-transparent p-0 text-center tabular text-lg outline-none focus-visible:text-candle focus-visible:underline focus-visible:decoration-candle/60 focus-visible:underline-offset-4"
			onfocus={(e) => e.currentTarget.select()}
			oninput={(e) => {
				const n = Number(e.currentTarget.value);
				if (Number.isInteger(n) && n >= min && n <= max) value = n;
			}}
			onchange={(e) => {
				const n = Math.round(Number(e.currentTarget.value));
				if (e.currentTarget.value.trim() && Number.isFinite(n)) {
					value = Math.min(max, Math.max(min, n));
				}
				e.currentTarget.value = String(value);
			}}
		/>
		<span class="text-sm text-muted-foreground">{label}</span>
	</label>
	<Button
		variant="ghost"
		size="icon"
		class="size-10 rounded-full"
		aria-label="More {noun}"
		disabled={value >= max}
		onclick={() => (value = Math.min(max, value + 1))}
	>
		<Plus />
	</Button>
	<span class="sr-only" aria-live="polite">{before} {value} {label}</span>
</div>
