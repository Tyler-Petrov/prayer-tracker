<script lang="ts">
	import { untrack } from 'svelte';
	import { slide } from 'svelte/transition';
	import { afterNavigate, beforeNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { navigating, page } from '$app/state';
	import { parseDate } from '@internationalized/date';
	import { toast } from 'svelte-sonner';
	import CalendarSearch from '@lucide/svelte/icons/calendar-search';
	import Check from '@lucide/svelte/icons/check';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import Plus from '@lucide/svelte/icons/plus';
	import { api } from '#convex/_generated/api.js';
	import type { Id } from '#convex/_generated/dataModel.js';
	import type { DayItem as Item } from '#convex/days.js';
	import { addDays, daysBetween, isDate, MAX_RANGE_DAYS } from '#convex/shared/recurrence.js';
	import { weekStart } from '#convex/shared/weeks.js';
	import DayItem from '#lib/components/days/day-item.svelte';
	import ItemSheet from '#lib/components/days/item-sheet.svelte';
	import RequestEditor, { type EditorTarget } from '#lib/components/requests/request-editor.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Calendar } from '#lib/components/ui/calendar/index.js';
	import * as Popover from '#lib/components/ui/popover/index.js';
	import { convexQuery } from '#lib/convex-query.svelte.js';
	import { dayName, formatDay, isDay, weekLabel } from '#lib/dates.js';
	import { daysView } from '#lib/days-view.svelte.js';
	import { Detent } from '#lib/detent.svelte.js';
	import { requestActions } from '#lib/request-actions.js';
	import { daysArgs, requestsArgs } from '#lib/tab-queries.js';
	import { today } from '#lib/today.svelte.js';

	type Range = { from: string; to: string };
	/** How many days the list grows by at a time, at either end. */
	const STEP = 7;

	// The Days tab is one list of days (Meal Tracker's plan). It opens on `?day=` (a link to a day, from a
	// request's page), else where it was left (daysView), else today, and grows a week at a time as either end
	// scrolls near, up to MAX_RANGE_DAYS.
	const param = $derived.by(() => {
		const day = page.url.searchParams.get('day');
		return isDay(day) && isDate(day) ? day : undefined;
	});
	/**
	 * A day jumped to beyond the loaded days (Today, the calendar): the list starts over around it. Kept here,
	 * not in the URL, so Back and a reload still open where the tab was left rather than on this day.
	 */
	let target = $state<string>();
	const start = $derived(target ?? param ?? today.current);
	// Read once, as the page opens; not state, so letting go of it doesn't move the range. A `?day=` link opens
	// on its day, but coming back to it through history (Back from a request) is coming back to where it was left.
	const opening = {
		spot: untrack(() => (param && navigating.type !== 'popstate' ? undefined : daysView.spot))
	};
	let range: Range = $derived(daysArgs(opening.spot?.day ?? start));
	// Awaited together, with the range it answers: while a wider range loads, the days already here stay as they
	// are. The Requests list says each one's schedule in words, and the person's week start divides the weeks;
	// the app shell keeps both subscribed. One awaited derived, not several: updates to them land in one batch.
	const loaded = $derived(await load(range));
	function load(range: Range) {
		return Promise.all([
			convexQuery(api.days.range, range),
			convexQuery(api.requests.list, requestsArgs(today.current)),
			convexQuery(api.users.me, {})
		]).then(([days, requests, me]) => ({ range, days, requests, me }));
	}
	const me = $derived(loaded.me);
	const rows = $derived(new Map(loaded.requests.rows.map((row) => [row.requestId, row])));
	const actions = requestActions();

	/** Set while the page scrolls, and for a moment after. */
	let scrolling = $state(false);
	let settle: ReturnType<typeof setTimeout> | undefined;

	// Days show once their requests have loaded, so a new week arrives whole instead of filling in. A change at
	// the top waits for the page to be still: moving the page under a smooth or momentum scroll makes it jump.
	// Days added above wait whole. Days let go of above (the range is at its longest and grew below) keep their
	// rows, as they last were, until then; the days added below show at once, so a long scroll down never runs
	// out of list.
	let last: typeof loaded | undefined;
	const shown = $derived.by(() => {
		if (!last || !scrolling || loaded.range.from === last.range.from) return (last = loaded);
		const { from, to } = last.range;
		// Anything but a trim of this list (days added above, a jump elsewhere) waits whole.
		const trimmed = loaded.range.from > from && loaded.range.from <= to && loaded.range.to >= to;
		if (!trimmed) return last;
		const kept = last.days.filter((day) => day.date < loaded.range.from);
		return (last = {
			...loaded,
			range: { from, to: loaded.range.to },
			days: [...kept, ...loaded.days]
		});
	});
	const shownFrom = $derived(shown?.range.from);
	const dates = $derived.by(() => {
		if (!shown) return [];
		const { from, to } = shown.range;
		return Array.from({ length: daysBetween(from, to) + 1 }, (_, i) => addDays(from, i));
	});
	// Each day's requests. A day's list is reused while its requests are unchanged, so it isn't touched when
	// other days change (days added above, a check on another day).
	type DayList = { json: string; items: Item[] };
	let lists = new Map<string, DayList>();
	const byDay = $derived.by(() => {
		const found = new Map((shown?.days ?? []).map((day) => [day.date, day.items]));
		const next = new Map(
			dates.map((date): [string, DayList] => {
				const items = found.get(date) ?? [];
				const json = JSON.stringify(items);
				const old = lists.get(date);
				return [date, old?.json === json ? old : { json, items }];
			})
		);
		lists = next;
		return next;
	});

	/** "Oct 4 – 10", or "Sep 27 – Oct 3" across months. */
	function weekRange(week: string) {
		const end = addDays(week, 6);
		const last =
			week.slice(0, 7) === end.slice(0, 7) ? String(Number(end.slice(8))) : formatDay(end, 'month');
		return `${formatDay(week, 'month')} – ${last}`;
	}

	let list: HTMLElement | undefined = $state();
	let header: HTMLElement | undefined = $state();
	/** Which way today's row is when it's off screen, as of the last scroll. */
	let todaySide = $state<'above' | 'below'>();
	const todayAway = $derived(
		!shown
			? undefined
			: today.current < shown.range.from
				? 'above'
				: today.current > shown.range.to
					? 'below'
					: todaySide
	);
	/** The day at the top of the screen, under the header: its month names the header. */
	let topDay = $state<string>();
	let scrolledTo: string | undefined;

	const rowOf = (day: string) => list?.querySelector<HTMLElement>(`[data-day="${day}"]`);
	// A scroll running past today stops on it for a moment, so it isn't missed.
	const detent = new Detent(() => rowOf(today.current));

	/** A day just scrolled to (Today, a date picked): its heading gets the candlelight wash. */
	let flashed = $state<string>();
	let flashTimer: ReturnType<typeof setTimeout> | undefined;
	function flash(day: string) {
		flashed = undefined;
		clearTimeout(flashTimer);
		requestAnimationFrame(() => {
			flashed = day;
			flashTimer = setTimeout(() => (flashed = undefined), 800);
		});
	}

	// The page opens where it was left, or on its start day: landed as that row renders (attached), and
	// again once Kit has scrolled for the navigation.
	afterNavigate(({ from }) => {
		scrolledTo = undefined;
		if (from?.route.id === '/') {
			// Days tapped while here: back to today (or the `?day=` linked to). Its row may have been let go of
			// (scrolled far away): then the list starts over around it, and its row lands as it renders.
			opening.spot = undefined;
			target = undefined;
			if (!land()) range = daysArgs(start);
			return;
		}
		// Let go of the spot once landed on; until then its row's attachment still lands there.
		if (land()) opening.spot = undefined;
	});
	// Leaving, note the row at the top of the screen to come back to.
	beforeNavigate(({ to }) => {
		if (to?.route.id === '/') return;
		noteAnchor();
		const day = anchor?.row.dataset.day;
		daysView.leave(day ? { day, top: anchor!.top } : undefined);
	});

	/** Puts the page where it was left, or on its start day, once it has rendered. False if not yet. */
	function land() {
		if (scrolledTo === start) return true;
		const row = rowOf(opening.spot?.day ?? start);
		if (!row) return false;
		scrolledTo = start;
		detent.skip();
		if (opening.spot)
			window.scrollTo({
				top: scrollY + row.getBoundingClientRect().top - opening.spot.top,
				behavior: 'instant'
			});
		else {
			row.scrollIntoView({ block: 'start', behavior: 'instant' });
			const picked = target ?? param;
			if (picked) flash(picked);
		}
		noteAnchor();
		return true;
	}

	const smooth = () =>
		matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';

	/** Scrolls to `day`: right there when it's loaded, else the list starts over around it. */
	function jumpTo(day: string) {
		detent.skip();
		if (shown && day >= shown.range.from && day <= shown.range.to) {
			rowOf(day)?.scrollIntoView({ block: 'start', behavior: smooth() });
			flash(day);
			return;
		}
		scrolledTo = undefined;
		opening.spot = undefined;
		// A new start moves the range with it; the same one (scrolled far from) starts the range over.
		if (day === start) range = daysArgs(day);
		else target = day;
	}

	// Anything above the screen changing height would push what's on screen around: days added or let go of
	// above, and, within the days, requests added, rescheduled or answered (here or on another device), each
	// one sliding in or out. Note the top row on screen as the page scrolls, and when the list changes, scroll by
	// however far that row moved, before the frame paints. (Not CSS scroll anchoring: Safari lacks it, and it
	// would double up.) Also note which way today is, for the Today button, and which day is under the header,
	// for its month.
	let anchor: { row: HTMLElement; top: number } | undefined;
	function noteAnchor() {
		const rows = [...(list?.querySelectorAll<HTMLElement>('[data-day]') ?? [])];
		const row = rows.find((el) => el.getBoundingClientRect().bottom > 0);
		anchor = row && { row, top: row.getBoundingClientRect().top };
		const below = header?.getBoundingClientRect().bottom ?? 0;
		topDay = rows.find((el) => el.getBoundingClientRect().bottom > below + 8)?.dataset.day;
		const box = rowOf(today.current)?.getBoundingClientRect();
		todaySide =
			!box || (box.bottom > below && box.top < innerHeight)
				? undefined
				: box.top < below
					? 'above'
					: 'below';
	}
	function onscroll() {
		noteAnchor();
		scrolling = true;
		clearTimeout(settle);
		settle = setTimeout(() => (scrolling = false), 150);
	}
	/**
	 * Puts the top row back where it was noted. Not while the page scrolls: the row has moved with the scroll
	 * since its last scroll event, so it would pull the page back (and stop a momentum scroll). Changes above wait
	 * for the page to be still anyway (`shown`).
	 */
	function keepPlace() {
		if (!scrolling && anchor?.row.isConnected) {
			const moved = anchor.row.getBoundingClientRect().top - anchor.top;
			if (Math.abs(moved) >= 1) window.scrollTo({ top: scrollY + moved, behavior: 'instant' });
		}
		noteAnchor();
	}
	// Once the days or their requests render differently...
	$effect(() => {
		if (!shownFrom) return;
		void byDay;
		untrack(keepPlace);
	});
	// ...and on every frame the list's height changes after that (a request sliding in or out).
	function heightWatch(node: HTMLElement) {
		const observer = new ResizeObserver(() => keepPlace());
		observer.observe(node);
		return () => observer.disconnect();
	}
	// The list goes on both ways, so an overscroll at the top is a scroll that beat the next week in, not a
	// refresh (the days are live anyway).
	$effect(() => {
		const { style } = document.documentElement;
		style.overflowAnchor = 'none';
		style.overscrollBehaviorY = 'none';
		return () => {
			style.overflowAnchor = '';
			style.overscrollBehaviorY = '';
		};
	});

	/**
	 * Calls `onview` when the element comes within 4 screens of the viewport, or already is when attached.
	 * Well ahead, as days above only show once the page is still: a long flick runs on what's already there.
	 * (Pixels, not a percentage: those can resolve against the width.)
	 */
	function near(onview: () => void) {
		return (node: HTMLElement) => {
			const observer = new IntersectionObserver(
				([entry]) => {
					if (entry.isIntersecting) onview();
				},
				{ rootMargin: `${4 * innerHeight}px 0px` }
			);
			observer.observe(node);
			return () => observer.disconnect();
		};
	}

	function grow(end: 'from' | 'to') {
		// One week at a time: wait for the last one to load, and to show at that end.
		if (loaded.range !== range) return;
		if (end === 'from' ? shown.range.from !== range.from : shown.range.to !== range.to) return;
		let { from, to } = range;
		if (end === 'from') from = addDays(from, -STEP);
		else to = addDays(to, STEP);
		// days.range answers at most MAX_RANGE_DAYS at a time: past that, let go of a week at the far end.
		if (daysBetween(from, to) >= MAX_RANGE_DAYS) {
			if (end === 'from') to = addDays(to, -STEP);
			else from = addDays(from, STEP);
		}
		range = { from, to };
	}

	// The request sheet for a day's item, following the live item; the last copy stays while it closes.
	let sheetOpen = $state(false);
	let picked = $state.raw<{ item: Item; date: string }>();
	const live = $derived(
		picked && byDay.get(picked.date)?.items.find((i) => i.requestId === picked?.item.requestId)
	);
	// It left that day somewhere else (answered, deleted, rescheduled): close rather than offer actions that fail.
	$effect(() => {
		if (!sheetOpen || !picked || live || !shown) return;
		if (picked.date < shown.range.from || picked.date > shown.range.to) return;
		sheetOpen = false;
		toast(
			`${picked.item.title} is no longer on ${dayName(picked.date, today.current, me.weekStart, true)}`
		);
	});

	let editorOpen = $state(false);
	let editorTarget = $state.raw<EditorTarget>({ kind: 'add', day: today.current });

	function add(day: string) {
		editorTarget = { kind: 'add', day, fromDay: true };
		editorOpen = true;
	}
	function edit(requestId: Id<'requests'>) {
		const row = rows.get(requestId);
		if (!row) return;
		editorTarget = { kind: 'edit', request: row };
		sheetOpen = false;
		editorOpen = true;
	}
	function open(item: Item, date: string) {
		picked = { item, date };
		sheetOpen = true;
	}

	const requestHref = (requestId: Id<'requests'>) =>
		resolve('/requests/[requestId]', { requestId });

	let pickerOpen = $state(false);
	const month = $derived(formatDay(topDay ?? start, 'monthYear'));
</script>

<svelte:window {onscroll} />

<svelte:head>
	<title>Days · Prayer Tracker</title>
</svelte:head>

<h1 class="sr-only">Days</h1>

<!-- The month at the top of the screen, and ways back to today or to any day. -->
<div
	bind:this={header}
	class="sticky top-0 z-20 border-b bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur"
>
	<div class="page-column flex h-14 items-center gap-2">
		<p class="min-w-0 flex-1 truncate font-display text-xl tracking-tight" aria-live="polite">
			{month}
		</p>
		<Button
			variant="outline"
			class={['h-11 gap-1.5 px-3 md:h-9', todayAway && 'border-candle/40 text-candle']}
			aria-label={todayAway ? `Back to today (${todayAway})` : 'Today'}
			onclick={() => jumpTo(today.current)}
		>
			{#if todayAway === 'above'}
				<ChevronUp />
			{:else if todayAway === 'below'}
				<ChevronDown />
			{/if}
			Today
		</Button>
		<Popover.Root bind:open={pickerOpen}>
			<Popover.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						variant="ghost"
						size="icon"
						class="size-11 md:size-9"
						aria-label="Go to a day"
					>
						<CalendarSearch />
					</Button>
				{/snippet}
			</Popover.Trigger>
			<Popover.Content align="end" class="w-auto p-0">
				<!-- preventDeselect: tapping the day already chosen (the one at the top) goes to it, not nowhere. -->
				<Calendar
					type="single"
					value={parseDate(topDay ?? start)}
					preventDeselect
					onValueChange={(day) => {
						if (!day) return;
						pickerOpen = false;
						jumpTo(day.toString());
					}}
					weekStartsOn={me.weekStart === 'MO' ? 1 : 0}
					captionLayout="dropdown"
					locale={navigator.language}
					class="rounded-md"
				/>
				<div class="flex justify-end border-t p-2">
					<Button
						variant="ghost"
						class="h-11 text-candle md:h-9"
						onclick={() => {
							pickerOpen = false;
							jumpTo(today.current);
						}}
					>
						Today
					</Button>
				</div>
			</Popover.Content>
		</Popover.Root>
	</div>
</div>

<div class="page-column pt-1 pb-28 md:pb-16">
	{#if shown}
		<div bind:this={list} {@attach detent.listen} {@attach heightWatch}>
			<!-- Re-attached after each load, so it checks again whether it's still near. -->
			{#key shown.range}<div {@attach near(() => grow('from'))}></div>{/key}
			{#each dates as day (day)}
				{@const items = byDay.get(day)!.items}
				{@const isToday = day === today.current}
				{@const due = items.filter((i) => !i.skipped)}
				{@const done = due.filter((i) => i.prayed).length}
				<section
					data-day={day}
					aria-label={`${dayName(day, today.current, me.weekStart)}, ${formatDay(day, 'month')}`}
					class="scroll-mt-[calc(3.75rem+env(safe-area-inset-top))] py-3"
					{@attach day === (opening.spot?.day ?? start) && land}
				>
					{#if day === weekStart(day, me.weekStart)}
						<div class="mt-4 mb-4 flex items-center gap-3 text-sm text-muted-foreground">
							<span>
								{Math.abs(daysBetween(weekStart(today.current, me.weekStart), day)) > 7
									? weekRange(day)
									: `${weekLabel(day, today.current, me.weekStart)} · ${weekRange(day)}`}
							</span>
							<span class="h-px flex-1 bg-border"></span>
						</div>
					{/if}
					<div class="mb-2 flex items-center gap-2">
						<h2
							class={[
								'flex min-w-0 flex-1 items-baseline gap-2.5',
								((isToday && detent.holding) || flashed === day) && 'landed'
							]}
						>
							<span
								class={[
									'text-xl',
									isToday ? 'text-candle' : day < today.current && 'text-foreground/75'
								]}
							>
								{dayName(day, today.current, me.weekStart)}
							</span>
							<span class="font-sans text-sm tracking-normal text-muted-foreground">
								{formatDay(day, day.slice(0, 4) === today.current.slice(0, 4) ? 'month' : 'date')}
							</span>
						</h2>
						{#if due.length}
							<span
								class={[
									'flex items-center gap-1 tabular text-xs',
									done === due.length ? 'text-sage' : 'text-muted-foreground'
								]}
								aria-label="{done} of {due.length} prayed"
							>
								{#if done === due.length}<Check class="size-3.5" strokeWidth={3} />{/if}
								{done}/{due.length}
							</span>
						{/if}
						{#if items.length}
							<Button
								variant="ghost"
								size="icon"
								class="size-9 text-muted-foreground hover:text-candle"
								aria-label="Add a request for {dayName(day, today.current, me.weekStart, true)}"
								onclick={() => add(day)}
							>
								<Plus />
							</Button>
						{/if}
					</div>
					{#if items.length}
						<ul
							class={[
								'divide-y divide-border overflow-hidden rounded-xl border bg-card',
								isToday && 'border-candle/25'
							]}
						>
							{#each items as item (item.requestId)}
								<li transition:slide={{ duration: 150 }}>
									<DayItem
										{item}
										date={day}
										summary={rows.get(item.requestId)?.summary}
										href={requestHref(item.requestId)}
										{actions}
										weekStart={me.weekStart}
										onopen={() => open(item, day)}
										onedit={() => edit(item.requestId)}
									/>
								</li>
							{/each}
						</ul>
					{:else}
						<button
							type="button"
							class="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-dashed text-sm text-muted-foreground transition-colors hover:border-candle/50 hover:text-candle focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
							aria-label="Add a request for {dayName(day, today.current, me.weekStart, true)}"
							onclick={() => add(day)}
						>
							<Plus class="size-4" />
							Add a request
						</button>
					{/if}
				</section>
			{/each}
			<!-- Re-attached after each load, so it checks again whether it's still near. -->
			{#key shown.range}<div {@attach near(() => grow('to'))}></div>{/key}
		</div>
	{/if}
</div>

{#if picked}
	<ItemSheet
		bind:open={sheetOpen}
		item={live ?? picked.item}
		date={picked.date}
		summary={rows.get(picked.item.requestId)?.summary}
		notes={rows.get(picked.item.requestId)?.notes}
		href={requestHref(picked.item.requestId)}
		{actions}
		weekStart={me.weekStart}
		onedit={() => picked && edit(picked.item.requestId)}
	/>
{/if}

<RequestEditor bind:open={editorOpen} target={editorTarget} weekStart={me.weekStart} />
