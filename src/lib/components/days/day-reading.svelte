<script lang="ts">
	import { goto } from '$app/navigation';
	import { useConvexClient } from 'convex-svelte';
	import BookOpen from '@lucide/svelte/icons/book-open';
	import ExternalLink from '@lucide/svelte/icons/square-arrow-out-up-right';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import { api } from '#convex/_generated/api.js';
	import type { DayReading } from '#convex/days.js';
	import { chapterCount, passageLabel } from '#convex/shared/bible.js';
	import CheckMark from '#lib/components/check-mark.svelte';
	import * as ContextMenu from '#lib/components/ui/context-menu/index.js';
	import { prefetchQuery } from '#lib/convex-query.svelte.js';
	import type { ReadingActions } from '#lib/reading-actions.js';
	import { readingPlanArgs } from '#lib/tab-queries.js';
	import { today } from '#lib/today.svelte.js';

	let {
		reading,
		date,
		href,
		actions
	}: {
		reading: DayReading;
		/** The day it's listed on. */
		date: string;
		/** Its plan's page. */
		href: string;
		actions: ReadingActions;
	} = $props();

	const label = $derived(passageLabel(reading.book, reading));
	// As with requests: a day that hasn't come yet has no check (its plan's page can mark one read ahead).
	const checkable = $derived(date <= today.current || reading.read);

	const client = useConvexClient();
	const prefetch = () =>
		prefetchQuery(client, api.reading.get, readingPlanArgs(reading.planId, today.current));

	// A long press that opens the menu ends in a tap on whatever it pressed: swallow it (as day-item does).
	let pressOpened = false;
</script>

<ContextMenu.Root onOpenChange={(open) => open && (pressOpened = true)}>
	<ContextMenu.Trigger
		class={[
			'flex items-stretch transition-colors [-webkit-touch-callout:none] hover:bg-accent/40 has-[a:focus-visible]:bg-accent/40',
			reading.read && 'bg-sage/5'
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
		{#if checkable}
			<button
				type="button"
				aria-pressed={reading.read}
				aria-label="Read {label}"
				class="group grid w-14 shrink-0 place-items-center rounded-l-xl focus-visible:outline-none [&:focus-visible>span]:ring-3 [&:focus-visible>span]:ring-ring/50"
				onclick={() => void actions.read(reading, !reading.read)}
			>
				<CheckMark checked={reading.read} />
			</button>
		{:else}
			<span class="w-4 shrink-0" aria-hidden="true"></span>
		{/if}
		<a
			{href}
			class="flex min-h-14 min-w-0 flex-1 flex-col justify-center py-2.5 pr-4 text-left focus-visible:outline-none"
			onpointerenter={prefetch}
			onpointerdown={prefetch}
		>
			<span class={['leading-snug break-words', reading.read && 'text-muted-foreground']}>
				{label}
			</span>
			<span class="mt-0.5 text-xs text-muted-foreground">
				{#if reading.read}
					<span class="text-sage">Read</span>
					<span aria-hidden="true">·</span>
				{/if}
				{chapterCount(reading.to - reading.from + 1)}
			</span>
		</a>
	</ContextMenu.Trigger>
	<ContextMenu.Content side="bottom" align="start" collisionPadding={8} class="w-56">
		{#if checkable}
			<ContextMenu.Item onSelect={() => void actions.read(reading, !reading.read, true)}>
				{#if reading.read}
					<Undo2 />
					Not read yet
				{:else}
					<BookOpen />
					Mark read
				{/if}
			</ContextMenu.Item>
			<ContextMenu.Separator />
		{/if}
		<ContextMenu.Item onSelect={() => goto(href)}
			><ExternalLink />Open {reading.book}</ContextMenu.Item
		>
	</ContextMenu.Content>
</ContextMenu.Root>
