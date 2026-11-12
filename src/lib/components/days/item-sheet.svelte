<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import CalendarX2 from '@lucide/svelte/icons/calendar-x-2';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import type { DayItem } from '#convex/days.js';
	import type { WeekStart } from '#convex/shared/recurrence.js';
	import AdaptiveSheet from '#lib/components/adaptive-sheet.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { dayName, formatDay } from '#lib/dates.js';
	import type { RequestActions } from '#lib/request-actions.js';
	import { today } from '#lib/today.svelte.js';

	let {
		open = $bindable(false),
		item,
		date,
		summary,
		notes,
		href,
		actions,
		weekStart,
		onedit
	}: {
		open: boolean;
		item: DayItem;
		date: string;
		summary: string | undefined;
		notes: string | null | undefined;
		href: string;
		actions: RequestActions;
		/** The person's first day of the week, which decides "next" and "last" (as the Days headings do). */
		weekStart: WeekStart;
		onedit: () => void;
	} = $props();

	const on = $derived(dayName(date, today.current, weekStart, true));
	const description = $derived(
		[`${dayName(date, today.current, weekStart)}, ${formatDay(date, 'month')}`, summary]
			.filter(Boolean)
			.join(' · ')
	);
</script>

<!-- What can be done with one request on one day: tapped on the Days tab. -->
<AdaptiveSheet bind:open title={item.title} {description}>
	<div class="flex flex-col gap-4 pt-1 pb-2">
		{#if notes}
			<p class="line-clamp-4 text-sm whitespace-pre-wrap text-muted-foreground">{notes}</p>
		{/if}
		{#if item.answeredOn}
			<p class="text-sm text-lavender">
				Answered {item.answeredOn === date
					? on
					: dayName(item.answeredOn, today.current, weekStart, true)}
			</p>
		{/if}
		<div class="flex flex-col gap-2">
			{#if item.skipped}
				<Button
					class="h-11 justify-start"
					onclick={() => {
						void actions.skip(item, date, false, on);
						open = false;
					}}
				>
					<Undo2 />
					Bring back {on}
				</Button>
			{:else}
				<Button
					variant={item.prayed ? 'secondary' : 'default'}
					class="h-11 justify-start"
					onclick={() => {
						void actions.prayed(item, date, !item.prayed);
						open = false;
					}}
				>
					{#if item.prayed}
						<Undo2 />
						Not prayed yet
					{:else}
						<Check />
						Mark prayed {on}
					{/if}
				</Button>
				{#if item.recurring && item.scheduled}
					<Button
						variant="outline"
						class="h-11 justify-start"
						onclick={() => {
							void actions.skip(item, date, true, on);
							open = false;
						}}
					>
						<CalendarX2 />
						Skip just {on}
					</Button>
				{/if}
			{/if}
			<Button variant="outline" class="h-11 justify-start" onclick={onedit}>
				<Pencil />
				Edit request
			</Button>
			<Button variant="ghost" class="h-11 justify-between" {href} onclick={() => (open = false)}>
				Open request
				<ChevronRight />
			</Button>
		</div>
	</div>
</AdaptiveSheet>
