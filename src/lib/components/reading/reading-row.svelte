<script lang="ts">
	import { resolve } from '$app/paths';
	import { useConvexClient } from 'convex-svelte';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { api } from '#convex/_generated/api.js';
	import type { PlanView } from '#convex/model/reading.js';
	import { passageLabel } from '#convex/shared/bible.js';
	import { daysBetween } from '#convex/shared/recurrence.js';
	import { prefetchQuery } from '#lib/convex-query.svelte.js';
	import { dateLabel, relativeDay } from '#lib/dates.js';
	import { readingPlanArgs } from '#lib/tab-queries.js';
	import { today } from '#lib/today.svelte.js';

	let { plan }: { plan: PlanView } = $props();

	/** "today", "tomorrow", "on Thu, Nov 27"; nothing for a day gone by (it's behind). */
	const when = (date: string) =>
		date < today.current
			? ''
			: daysBetween(today.current, date) <= 1
				? relativeDay(date, today.current).toLowerCase()
				: `on ${dateLabel(date, today.current)}`;
	const share = $derived(plan.chaptersTotal ? plan.chaptersRead / plan.chaptersTotal : 0);

	const client = useConvexClient();
	const prefetch = () =>
		prefetchQuery(client, api.reading.get, readingPlanArgs(plan.planId, today.current));
</script>

<a
	href={resolve('/requests/reading/[planId]', { planId: plan.planId })}
	class="group flex h-full min-h-21 items-center gap-3 rounded-lg border bg-card px-4 py-3 transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
	onpointerenter={prefetch}
	onpointerdown={prefetch}
>
	<div class="min-w-0 flex-1">
		<div class="flex items-baseline justify-between gap-3">
			<h3 class="truncate font-display text-lg leading-snug">{plan.book}</h3>
			<span class="shrink-0 tabular text-xs text-muted-foreground">
				{plan.chaptersRead}/{plan.chaptersTotal}
			</span>
		</div>
		<div
			class="mt-1.5 h-1 overflow-hidden rounded-full bg-muted"
			role="progressbar"
			aria-label="Chapters read"
			aria-valuemin={0}
			aria-valuemax={plan.chaptersTotal}
			aria-valuenow={plan.chaptersRead}
		>
			<div
				class="h-full rounded-full bg-sage transition-[width]"
				style:width="{share * 100}%"
			></div>
		</div>
		<p class="mt-1.5 flex flex-wrap gap-x-1.5 text-sm text-muted-foreground">
			{#if plan.next}
				<span class={plan.next.date <= today.current ? 'text-candle' : undefined}>
					{passageLabel(plan.book, plan.next)}
					{when(plan.next.date)}
				</span>
				{#if plan.behind}
					<span aria-hidden="true">·</span>
					<span>{plan.behind} behind</span>
				{:else}
					<span aria-hidden="true">·</span>
					<span>{plan.summary}</span>
				{/if}
			{:else}
				<span class="text-sage">Finished</span>
			{/if}
		</p>
	</div>
	<ChevronRight
		class="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
	/>
</a>
