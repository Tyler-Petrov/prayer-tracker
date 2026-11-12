<script lang="ts">
	import { resolve } from '$app/paths';
	import { useConvexClient } from 'convex-svelte';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { api } from '#convex/_generated/api.js';
	import type { RequestView } from '#convex/model/requests.js';
	import { daysBetween } from '#convex/shared/recurrence.js';
	import { prefetchQuery } from '#lib/convex-query.svelte.js';
	import { dateLabel, relativeDay } from '#lib/dates.js';
	import { requestArgs } from '#lib/tab-queries.js';
	import { today } from '#lib/today.svelte.js';

	let { request }: { request: RequestView } = $props();

	const when = (date: string) =>
		Math.abs(daysBetween(today.current, date)) <= 1
			? relativeDay(date, today.current)
			: dateLabel(date, today.current);

	// What its page awaits, started as the row is hovered or pressed, so it's ready by the time the page is
	// (SvelteKit preloads the page's code from the link the same way).
	const client = useConvexClient();
	const prefetch = () =>
		prefetchQuery(client, api.requests.get, requestArgs(request.requestId, today.current));
</script>

<a
	href={resolve('/requests/[requestId]', { requestId: request.requestId })}
	class="group flex h-full min-h-21 items-center gap-3 rounded-lg border bg-card px-4 py-3 transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
	onpointerenter={prefetch}
	onpointerdown={prefetch}
>
	<div class="min-w-0 flex-1">
		<h3 class="line-clamp-2 font-display text-lg leading-snug break-words">{request.title}</h3>
		<p class="mt-1 text-sm text-muted-foreground">{request.summary}</p>
		<p class="mt-0.5 flex flex-wrap gap-x-1.5 text-sm text-muted-foreground">
			{#if request.section === 'answered' && request.answeredOn}
				<span class="text-lavender">Answered {dateLabel(request.answeredOn, today.current)}</span>
			{:else if request.nextDate}
				<span class={request.nextDate === today.current ? 'text-candle' : undefined}>
					Next {when(request.nextDate)}
				</span>
			{:else if request.endDate}
				<span>Ended {dateLabel(request.endDate, today.current)}</span>
			{/if}
			<span aria-hidden="true">·</span>
			<span>
				{request.prayedCount === 0
					? 'Not prayed yet'
					: `Prayed ${request.prayedCount === 1 ? 'once' : `${request.prayedCount} times`}`}
			</span>
		</p>
	</div>
	<ChevronRight
		class="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
	/>
</a>
