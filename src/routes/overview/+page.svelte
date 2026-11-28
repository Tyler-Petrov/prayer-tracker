<script lang="ts">
	import { resolve } from '$app/paths';
	import BookOpen from '@lucide/svelte/icons/book-open';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import HandHeart from '@lucide/svelte/icons/hand-heart';
	import Plus from '@lucide/svelte/icons/plus';
	import { api } from '#convex/_generated/api.js';
	import { passageLabel } from '#convex/shared/bible.js';
	import { daysBetween, shortDate } from '#convex/shared/recurrence.js';
	import PageHeader from '#lib/components/page-header.svelte';
	import ReadingEditor from '#lib/components/reading/reading-editor.svelte';
	import { convexQuery } from '#lib/convex-query.svelte.js';
	import { dateLabel, formatDay, relativeDay } from '#lib/dates.js';
	import { overviewArgs, readingListArgs } from '#lib/tab-queries.js';
	import { today } from '#lib/today.svelte.js';

	// Kept subscribed by the app shell, so the tab opens at once.
	const [stats, plans, me] = $derived(
		await Promise.all([
			convexQuery(api.overview.stats, overviewArgs(today.current)),
			convexQuery(api.reading.list, readingListArgs(today.current)),
			convexQuery(api.users.me, {})
		])
	);

	/** "today", "tomorrow", "Thu, Nov 27"; nothing for a day gone by (it's behind). */
	const when = (date: string) =>
		date < today.current
			? ''
			: daysBetween(today.current, date) <= 1
				? relativeDay(date, today.current).toLowerCase()
				: dateLabel(date, today.current);

	let readingEditorOpen = $state(false);
</script>

<PageHeader title="Overview" />

{#snippet stat(value: string | number, label: string, note: string, dot?: string)}
	<div class="border-t py-3 odd:pr-3 even:border-l even:pl-3">
		<p class="font-display text-4xl leading-tight">{value}</p>
		<p class="mt-0.5 flex items-center gap-1.5 text-sm">
			{#if dot}<span class={['size-2 shrink-0 rounded-full', dot]} aria-hidden="true"></span>{/if}
			{label}
		</p>
		<p class="mt-0.5 text-xs text-muted-foreground">{note}</p>
	</div>
{/snippet}

<div class="page-column flex flex-col gap-10 pb-10">
	<section aria-labelledby="prayer-heading">
		<h2 id="prayer-heading" class="mb-2 flex items-center gap-2 font-display text-xl">
			<HandHeart class="size-5 text-candle" aria-hidden="true" />
			Prayer
		</h2>
		<div class="grid grid-cols-2">
			{@render stat(
				stats.answered,
				stats.answered === 1 ? 'Prayer answered' : 'Prayers answered',
				`${stats.answeredThisYear} this year`,
				'bg-lavender'
			)}
			{@render stat(stats.praying, 'Praying for', 'active requests')}
			{@render stat(stats.daysPrayed, 'Days prayed', `of the last ${stats.days.length}`, 'bg-sage')}
			{@render stat(
				stats.streakFull ? `${stats.streak}+` : stats.streak,
				'Days in a row',
				'up to today'
			)}
		</div>

		<div class="border-t pt-3 pb-1">
			<div class="flex items-baseline justify-between text-sm">
				<span>Last {stats.days.length} days</span>
				<span class="text-xs text-muted-foreground">
					{stats.daysPrayed}
					{stats.daysPrayed === 1 ? 'day' : 'days'}
				</span>
			</div>
			<div
				class="my-2 grid grid-cols-[repeat(30,minmax(0,1fr))] gap-0.5"
				role="img"
				aria-label="Prayed on {stats.daysPrayed} of the last {stats.days.length} days"
			>
				{#each stats.days as day (day.date)}
					<span
						title="{formatDay(day.date, 'month')}: {day.prayed ? 'prayed' : 'not prayed'}"
						class={[
							'h-5 rounded-[2px]',
							day.prayed ? 'bg-sage' : 'bg-muted',
							day.date === today.current && 'outline-[1.5px] outline-offset-1 outline-candle'
						]}
					></span>
				{/each}
			</div>
			<div class="flex justify-between text-xs text-muted-foreground">
				<span>{formatDay(stats.days[0].date, 'month')}</span>
				<span>Today</span>
			</div>
		</div>

		<ul class="mt-2">
			{#each stats.recentAnswered as answer (answer.requestId)}
				<li class="border-t">
					<a
						href={resolve('/requests/[requestId]', { requestId: answer.requestId })}
						class="flex min-h-11 items-center gap-3 py-2.5 transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none"
					>
						<span class="min-w-0 flex-1 leading-snug break-words">{answer.title}</span>
						<span class="shrink-0 text-xs text-lavender">
							Answered {shortDate(answer.answeredOn, today.current)}
						</span>
					</a>
				</li>
			{/each}
			<li class="border-t">
				<a
					href={resolve('/requests')}
					class="flex min-h-11 items-center justify-between gap-3 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
				>
					All requests
					<ChevronRight class="size-4" aria-hidden="true" />
				</a>
			</li>
		</ul>
		{#if stats.requestsCapped}
			<p class="mt-2 text-xs text-muted-foreground">
				These count your newest requests; there are too many to count them all.
			</p>
		{/if}
	</section>

	<section aria-labelledby="reading-heading">
		<h2 id="reading-heading" class="mb-2 flex items-center gap-2 font-display text-xl">
			<BookOpen class="size-5 text-candle" aria-hidden="true" />
			Bible reading
		</h2>
		<div class="grid grid-cols-2">
			{@render stat(stats.chaptersRead, 'Chapters read', 'in your plans', 'bg-sage')}
			{@render stat(
				stats.booksFinished.length,
				stats.booksFinished.length === 1 ? 'Book finished' : 'Books finished',
				stats.booksFinished.join(', ') || 'none yet'
			)}
		</div>
		<ul>
			<!-- Being read first, then finished (reading.list's order). -->
			{#each plans as plan (plan.planId)}
				<li class="border-t">
					<a
						href={resolve('/requests/reading/[planId]', { planId: plan.planId })}
						class="block py-2.5 transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none"
					>
						<span class="flex items-baseline justify-between gap-3">
							<span class="min-w-0 truncate">{plan.book}</span>
							{#if plan.next}
								<span
									class={[
										'shrink-0 text-xs',
										plan.next.date <= today.current ? 'text-candle' : 'text-muted-foreground'
									]}
								>
									{plan.chaptersRead}/{plan.chaptersTotal} ·
									{passageLabel(plan.book, plan.next)}
									{plan.behind ? `· ${plan.behind} behind` : when(plan.next.date)}
								</span>
							{:else}
								<span class="shrink-0 text-xs text-sage">
									{plan.chaptersTotal}/{plan.chaptersTotal} · Finished
								</span>
							{/if}
						</span>
						<span
							class="mt-1.5 block h-1 overflow-hidden rounded-full bg-muted"
							role="progressbar"
							aria-label="Chapters of {plan.book} read"
							aria-valuemin={0}
							aria-valuemax={plan.chaptersTotal}
							aria-valuenow={plan.chaptersRead}
						>
							<span
								class="block h-full rounded-full bg-sage"
								style:width="{plan.chaptersTotal
									? (plan.chaptersRead / plan.chaptersTotal) * 100
									: 0}%"
							></span>
						</span>
					</a>
				</li>
			{/each}
			<li class="border-t">
				<button
					type="button"
					class="flex min-h-11 w-full items-center justify-between gap-3 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
					onclick={() => (readingEditorOpen = true)}
				>
					Read a book
					<Plus class="size-4" aria-hidden="true" />
				</button>
			</li>
		</ul>
	</section>
</div>

<ReadingEditor bind:open={readingEditorOpen} target={{ kind: 'add' }} weekStart={me.weekStart} />
