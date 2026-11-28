<script lang="ts">
	import { goto } from '$app/navigation';
	import { useConvexClient } from 'convex-svelte';
	import CalendarX2 from '@lucide/svelte/icons/calendar-x-2';
	import ExternalLink from '@lucide/svelte/icons/square-arrow-out-up-right';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Repeat from '@lucide/svelte/icons/repeat';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import { api } from '#convex/_generated/api.js';
	import type { DayItem } from '#convex/days.js';
	import CheckMark from '#lib/components/check-mark.svelte';
	import PrayingHands from '#lib/components/praying-hands.svelte';
	import * as ContextMenu from '#lib/components/ui/context-menu/index.js';
	import { prefetchQuery } from '#lib/convex-query.svelte.js';
	import { dayName } from '#lib/dates.js';
	import type { RequestActions } from '#lib/request-actions.js';
	import { requestArgs } from '#lib/tab-queries.js';
	import { today } from '#lib/today.svelte.js';
	import { shortDate, type WeekStart } from '#convex/shared/recurrence.js';

	let {
		item,
		date,
		summary,
		href,
		actions,
		weekStart,
		onedit
	}: {
		item: DayItem;
		/** The day it's listed on. */
		date: string;
		/** Its schedule in words ("Every 9 days"), from the Requests list. */
		summary: string | undefined;
		/** Its page, for this day. */
		href: string;
		actions: RequestActions;
		/** The person's first day of the week, which decides "next" and "last" (as the Days headings do). */
		weekStart: WeekStart;
		onedit: () => void;
	} = $props();

	const on = $derived(dayName(date, today.current, weekStart, true));
	const answeredHere = $derived(item.answeredOn === date);
	const answeredBefore = $derived(item.answeredOn !== null && item.answeredOn < date);
	// A day that hasn't come yet can't be prayed for: no check. One already marked keeps it, to take it back.
	const checkable = $derived(date <= today.current || item.prayed);

	function prayed(value: boolean, withToast: boolean) {
		void actions.prayed(
			item,
			date,
			value,
			withToast
				? value
					? `Prayed for ${item.title} ${on}`
					: `${item.title} isn't marked prayed ${on}`
				: undefined
		);
	}

	// What its page awaits, started as the row is hovered or pressed, so it's ready by the time the page is
	// (SvelteKit preloads the page's code from the link the same way).
	const client = useConvexClient();
	const prefetch = () =>
		prefetchQuery(client, api.requests.get, requestArgs(item.requestId, today.current));

	// A long press that opens the menu ends in a tap on whatever it pressed: swallow it, or the row's
	// check or sheet would act too.
	let pressOpened = false;
</script>

<ContextMenu.Root onOpenChange={(open) => open && (pressOpened = true)}>
	<ContextMenu.Trigger
		class={[
			'flex items-stretch transition-colors [-webkit-touch-callout:none] hover:bg-accent/40 has-[a:focus-visible]:bg-accent/40'
		]}
		onpointerdowncapture={() => (pressOpened = false)}
		onkeydowncapture={() => (pressOpened = false)}
		onclickcapture={(e: MouseEvent) => {
			if (!pressOpened) return;
			pressOpened = false;
			e.preventDefault();
			e.stopPropagation();
		}}
	>
		<!-- Ahead of today there's nothing to check yet, so the title starts at the edge. -->
		{#if checkable && item.skipped}
			<!-- Skipped: nothing to check; the page or menu brings it back. -->
			<span class="grid w-10 shrink-0 place-items-center justify-items-start" aria-hidden="true">
				<span class="size-6 rounded-full border-2 border-dashed border-muted-foreground/40"></span>
			</span>
		{:else if checkable}
			<button
				type="button"
				aria-pressed={item.prayed}
				aria-label="Prayed for {item.title}"
				class="group grid w-10 shrink-0 place-items-center justify-items-start focus-visible:outline-none [&:focus-visible>span]:ring-3 [&:focus-visible>span]:ring-ring/50"
				onclick={() => prayed(!item.prayed, false)}
			>
				<CheckMark checked={item.prayed} />
			</button>
		{/if}
		<a
			{href}
			class="flex min-h-11 min-w-0 flex-1 items-center gap-3 py-2.5 text-left focus-visible:outline-none"
			onpointerenter={prefetch}
			onpointerdown={prefetch}
		>
			<span
				class={[
					'min-w-0 flex-1 leading-snug break-words',
					(item.prayed || item.skipped) && 'text-muted-foreground',
					item.skipped && 'line-through decoration-muted-foreground/60'
				]}
			>
				{item.title}
			</span>
			<!-- On the right, on the title's line: the check says prayed, so only what it doesn't. -->
			<span
				class="flex max-w-1/2 shrink-0 flex-wrap items-center justify-end gap-x-1.5 text-right text-xs text-muted-foreground"
			>
				{#if item.skipped}
					<span>Skipped {on}</span>
				{/if}
				{#if answeredHere}
					{#if item.skipped}<span aria-hidden="true">·</span>{/if}
					<span class="text-lavender">Answered</span>
				{:else if answeredBefore}
					{#if item.skipped}<span aria-hidden="true">·</span>{/if}
					<span class="text-lavender">Answered {shortDate(item.answeredOn!, today.current)}</span>
				{/if}
				{#if !item.scheduled}
					{#if item.skipped || answeredHere || answeredBefore}<span aria-hidden="true">·</span>{/if}
					<span>Not scheduled this day</span>
				{:else if item.recurring && summary}
					{#if item.skipped || answeredHere || answeredBefore}<span aria-hidden="true">·</span>{/if}
					<span class="inline-flex items-center gap-1">
						<Repeat class="size-3" aria-hidden="true" />{summary}
					</span>
				{/if}
			</span>
		</a>
	</ContextMenu.Trigger>
	<!-- Below the press, not beside it: beside, a press past the middle of a phone flips the menu left, and
	     nothing shifts it back across (floating-ui shifts along the side only), so it hung off the left edge. -->
	<ContextMenu.Content side="bottom" align="start" collisionPadding={8} class="w-60">
		{#if !item.skipped && checkable}
			<ContextMenu.Item onSelect={() => prayed(!item.prayed, true)}>
				{#if item.prayed}
					<Undo2 />
					Not prayed yet
				{:else}
					<PrayingHands />
					Mark prayed
				{/if}
			</ContextMenu.Item>
		{/if}
		{#if item.recurring && item.scheduled}
			<ContextMenu.Item onSelect={() => void actions.skip(item, date, !item.skipped, on)}>
				{#if item.skipped}
					<Undo2 />
					Bring back {on}
				{:else}
					<CalendarX2 />
					Skip just {on}
				{/if}
			</ContextMenu.Item>
		{/if}
		<ContextMenu.Separator />
		<ContextMenu.Item onSelect={() => goto(href)}><ExternalLink />Open request</ContextMenu.Item>
		<ContextMenu.Item onSelect={onedit}><Pencil />Edit</ContextMenu.Item>
	</ContextMenu.Content>
</ContextMenu.Root>
