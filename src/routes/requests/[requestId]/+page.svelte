<script lang="ts">
	import { tick } from 'svelte';
	import { afterNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { slide } from 'svelte/transition';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import Check from '@lucide/svelte/icons/check';
	import CalendarX2 from '@lucide/svelte/icons/calendar-x-2';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import HandHeart from '@lucide/svelte/icons/hand-heart';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash from '@lucide/svelte/icons/trash';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import { api } from '#convex/_generated/api.js';
	import type { Id } from '#convex/_generated/dataModel.js';
	import { isDate, occursOn } from '#convex/shared/recurrence.js';
	import AdaptiveSheet from '#lib/components/adaptive-sheet.svelte';
	import DateField from '#lib/components/date-field.svelte';
	import PageHeader from '#lib/components/page-header.svelte';
	import PrayingHands from '#lib/components/praying-hands.svelte';
	import RequestEditor from '#lib/components/requests/request-editor.svelte';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Collapsible from '#lib/components/ui/collapsible/index.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { convexQuery } from '#lib/convex-query.svelte.js';
	import { dateLabel, dayName, formatDay, isDay } from '#lib/dates.js';
	import { requestActions } from '#lib/request-actions.js';
	import { requestArgs } from '#lib/tab-queries.js';
	import { today } from '#lib/today.svelte.js';

	const requestId = $derived(page.params.requestId as Id<'requests'>);
	// `?day=` comes from tapping it on the Days tab: the page is that day's, with its prayed mark and skip.
	const dayParam = $derived.by(() => {
		const day = page.url.searchParams.get('day');
		return isDay(day) && isDate(day) ? day : undefined;
	});
	// The request (with its upcoming and prayed days) and the person's week start, awaited together and live.
	const [request, me] = $derived(
		await Promise.all([
			convexQuery(api.requests.get, requestArgs(requestId, today.current)),
			convexQuery(api.users.me, {})
		])
	);
	const actions = requestActions();

	// Back goes where it came from: the Days tab (always, for a day's page), or the list (also when opened
	// directly).
	let fromDays = $state(false);
	afterNavigate(({ from, type }) => {
		if (type === 'enter') fromDays = false;
		else if (from?.route.id) fromDays = from.route.id === '/';
	});
	const back = $derived(
		fromDays || dayParam
			? { href: resolve('/'), label: 'Days' }
			: { href: resolve('/requests'), label: 'Requests' }
	);

	const target = $derived(request && { requestId, title: request.title });
	/**
	 * The day the page is about: the one tapped on the Days tab, else today (a one-time request's own day).
	 * Shown when it's on the Days tab that day: scheduled (skipped or not), or marked prayed.
	 */
	const day = $derived.by(() => {
		if (!request) return undefined;
		// A one-time request is about its one day, wherever it was opened from.
		const date = dayParam ?? (request.recurring ? today.current : request.startDate);
		const occurring = {
			startDate: request.startDate,
			rrule: request.rrule ?? undefined,
			skipDates: request.skipDates,
			answeredOn: request.answeredOn ?? undefined
		};
		const scheduled = occursOn(occurring, date, { includeSkipped: true });
		const skipped = scheduled && request.skipDates.includes(date);
		const prayed = request.prayedDates.includes(date);
		if (!scheduled && !prayed) return undefined;
		return { date, scheduled, skipped, prayed };
	});
	// How the page's day reads, mid-sentence: "today", "next Friday".
	const on = $derived(day && dayName(day.date, today.current, me.weekStart, true));
	// Under the title: the page's day and how it stands ("Prayed today", "Next Wednesday"), as Meal Tracker's
	// recipe page says which meal it's for, then a repeating one's schedule. Without a day: the schedule, and
	// when a repeating one started (or starts).
	const description = $derived.by(() => {
		if (!request) return undefined;
		if (day && on) {
			const state = day.skipped
				? `Skipped ${on}`
				: day.prayed
					? `Prayed ${on}`
					: on[0].toUpperCase() + on.slice(1);
			// A one-time request's schedule is just that day again.
			return request.recurring ? `${state} · ${request.summary}` : state;
		}
		if (!request.recurring) return request.summary;
		const start = dateLabel(request.startDate, today.current);
		return `${request.summary} · ${request.startDate > today.current ? 'starts' : 'since'} ${start}`;
	});
	// The days after the one up top: its next few, and the ones skipped ahead (to bring back), in order.
	const comingUp = $derived(
		request
			? [
					...request.upcoming.map((date) => ({ date, skipped: false })),
					...request.skipDates
						.filter((d) => d >= today.current)
						.map((date) => ({ date, skipped: true }))
				]
					.filter(({ date }) => date !== day?.date)
					.sort((a, b) => a.date.localeCompare(b.date))
			: []
	);

	// Prayed days fold away under their count; open, the latest first.
	let prayedOpen = $state(false);
	const HISTORY_SHOWN = 24;
	let historyOpen = $state(false);
	const history = $derived(
		historyOpen
			? (request?.prayedDates ?? [])
			: (request?.prayedDates.slice(0, HISTORY_SHOWN) ?? [])
	);

	// Editing happens in place, laid out like the page (as Meal Tracker's recipes do). The switch is a view
	// transition: the title holds still while the rest crossfades and the body rises in (layout.css).
	let editing = $state(false);
	/** The editor field to start in (tapping the notes placeholder starts in Notes). */
	let editFocus = $state<'notes'>();
	function setEditing(value: boolean, focus?: 'notes') {
		if (value === editing) return;
		editFocus = focus;
		if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
			editing = value;
			return;
		}
		document.startViewTransition(async () => {
			editing = value;
			await tick();
		});
	}

	// Marking it answered: the day (today, unless it starts later) and a note.
	let answerOpen = $state(false);
	let answerDay = $state('');
	let answerNote = $state('');
	let answering = $state(false);
	function startAnswer() {
		if (!request) return;
		answerDay = request.startDate > today.current ? request.startDate : today.current;
		answerNote = '';
		answerOpen = true;
	}
	async function saveAnswer(event: SubmitEvent) {
		event.preventDefault();
		if (!target || answering) return;
		answering = true;
		if (await actions.answer(target, answerDay, answerNote)) answerOpen = false;
		answering = false;
	}

	let confirmOpen = $state(false);
	let deleting = $state(false);
	async function deleteRequest() {
		if (!target) return;
		deleting = true;
		const href = back.href;
		if (await actions.remove(target)) {
			confirmOpen = false;
			await goto(href);
		} else deleting = false;
	}

	const dayHref = (day: string) => `${resolve('/')}?day=${day}`;
	const answerFormId = $props.id();
</script>

{#if request}
	{@const r = request}
	{#snippet requestActionButtons()}
		<!-- The page's day comes first, as a planned meal's "Made it" does on Meal Tracker's recipe page, then
		     answering, in lavender (outlined beside it, the main button without it). -->
		{#if day && on}
			{#if day.skipped}
				<Button
					variant="secondary"
					class="h-11 flex-1"
					onclick={() => target && actions.skip(target, day.date, false, on)}
				>
					<Undo2 />
					Bring back
				</Button>
			{:else if day.prayed}
				<Button
					variant="secondary"
					class="h-11 flex-1"
					onclick={() =>
						target &&
						actions.prayed(target, day.date, false, `${r.title} isn't marked prayed ${on}`)}
				>
					<Undo2 />
					Not prayed
				</Button>
			{:else}
				<Button
					class="h-11 flex-1"
					onclick={() =>
						target && actions.prayed(target, day.date, true, `Prayed for ${r.title} ${on}`)}
				>
					<PrayingHands />
					Mark prayed
				</Button>
			{/if}
		{/if}
		{#if r.answeredOn}
			<Button
				variant="secondary"
				class="h-11 flex-1"
				onclick={() => target && actions.unanswer(target)}
			>
				<Undo2 />
				Not answered
			</Button>
		{:else}
			<Button
				variant={day ? 'outline' : 'default'}
				class={['h-11 flex-1', day && '[&_svg]:text-lavender']}
				onclick={startAnswer}
			>
				<Check />
				Mark answered
			</Button>
		{/if}
	{/snippet}

	<!-- Edit and More, at the header's right: icons on phones. -->
	{#snippet toolButtons(phone: boolean)}
		<Button
			variant={phone ? 'ghost' : 'outline'}
			size={phone ? 'icon' : 'default'}
			class={phone ? 'size-10' : 'h-10 px-3'}
			aria-label={phone ? 'Edit' : undefined}
			onclick={() => setEditing(true)}
		>
			<Pencil />
			{#if !phone}Edit{/if}
		</Button>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button {...props} variant="ghost" size="icon" class="size-10" aria-label="More">
						<Ellipsis />
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="end" class="w-auto min-w-44">
				{#if day && on && r.recurring && day.scheduled && !day.skipped}
					<DropdownMenu.Item
						class="min-h-10"
						onSelect={() => target && actions.skip(target, day.date, true, on)}
					>
						<CalendarX2 />
						Skip just {on}
					</DropdownMenu.Item>
					<DropdownMenu.Separator />
				{/if}
				{#if dayParam ?? r.nextDate}
					<DropdownMenu.Item
						class="min-h-10"
						onSelect={() => goto(dayHref((dayParam ?? r.nextDate)!))}
					>
						<CalendarDays />
						Show on Days
					</DropdownMenu.Item>
					<DropdownMenu.Separator />
				{/if}
				<DropdownMenu.Item
					variant="destructive"
					class="min-h-10"
					onSelect={() => (confirmOpen = true)}
				>
					<Trash />
					Delete request
				</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	{/snippet}

	{#if editing}
		<RequestEditor
			inline
			bind:open={() => editing, setEditing}
			focus={editFocus}
			target={{ kind: 'edit', request: r }}
			weekStart={me.weekStart}
		/>
	{/if}
	<!-- Long titles wrap instead of truncating. Only hidden while editing: it knows where the page was opened
	     from, so Back still steps back in history after. -->
	<div
		class={['[&_h1]:text-balance [&_h1]:break-words [&_h1]:whitespace-normal', editing && 'hidden']}
	>
		<PageHeader title={r.title} {back} {description} centerActions>
			{#snippet actions()}
				<div class="flex items-center gap-1 md:hidden">{@render toolButtons(true)}</div>
				<div class="hidden items-center gap-2 md:flex">{@render toolButtons(false)}</div>
			{/snippet}
		</PageHeader>
	</div>
	{#if !editing}
		<!-- The day's prayed and answering, side by side under the header. -->
		<div class="page-column -mt-1 flex gap-2 pb-6">
			{@render requestActionButtons()}
		</div>

		{#key requestId}
			<div class="page-column flex flex-col gap-6 pb-10 [view-transition-name:request-body]">
				{#if r.answeredOn}
					<section
						class="rounded-xl border border-lavender/30 bg-lavender/8 px-4 py-3"
						aria-label="Answered"
						transition:slide={{ duration: 200 }}
					>
						<p class="flex items-center gap-2 font-display text-lg text-lavender">
							<Check class="size-4" aria-hidden="true" />
							Answered {dateLabel(r.answeredOn, today.current)}
						</p>
						{#if r.answerNote}
							<p class="mt-1 text-sm whitespace-pre-wrap">{r.answerNote}</p>
						{/if}
					</section>
				{/if}

				<section aria-labelledby="notes-heading">
					<h2
						id="notes-heading"
						class="mb-2 font-sans text-xs font-medium tracking-wide text-muted-foreground uppercase"
					>
						Notes
					</h2>
					{#if r.notes}
						<p class="leading-relaxed whitespace-pre-wrap">{r.notes}</p>
					{:else}
						<!-- Where the notes would be: clicking it starts writing them. -->
						<button
							type="button"
							class="-mx-2 -mt-1 w-[calc(100%+1rem)] rounded-md px-2 py-1 text-left leading-relaxed text-muted-foreground/60 transition-colors hover:bg-card focus-visible:bg-card focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
							onclick={() => setEditing(true, 'notes')}
						>
							Click to add notes
						</button>
					{/if}
				</section>

				{#if comingUp.length}
					<section aria-labelledby="coming-up-heading">
						<h2
							id="coming-up-heading"
							class="mb-2 font-sans text-xs font-medium tracking-wide text-muted-foreground uppercase"
						>
							Coming up
						</h2>
						<ul class="divide-y overflow-hidden rounded-xl border bg-card">
							{#each comingUp as { date, skipped } (date)}
								<li transition:slide={{ duration: 150 }}>
									{#if skipped}
										<div class="flex min-h-11 items-center gap-3 pr-2 pl-4 text-sm">
											<span class="flex-1 text-muted-foreground line-through">
												{dayName(date, today.current, me.weekStart)}
											</span>
											<span class="text-muted-foreground">{dateLabel(date, today.current)}</span>
											<Button
												variant="ghost"
												class="h-9 px-2 text-candle"
												onclick={() =>
													target &&
													actions.skip(
														target,
														date,
														false,
														dayName(date, today.current, me.weekStart, true)
													)}
											>
												<Undo2 />
												Bring back
											</Button>
										</div>
									{:else}
										<a
											href={dayHref(date)}
											class="flex min-h-11 items-center justify-between gap-3 px-4 text-sm transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none"
										>
											<span class={date === today.current ? 'text-candle' : undefined}>
												{dayName(date, today.current, me.weekStart)}
											</span>
											<span class="text-muted-foreground">{dateLabel(date, today.current)}</span>
										</a>
									{/if}
								</li>
							{/each}
						</ul>
					</section>
				{:else if r.recurring && !r.answeredOn && !r.upcoming.length}
					<p class="text-sm text-muted-foreground">No more days on its schedule.</p>
				{/if}

				<!-- The prayed days, folded under their count (as T3 Code folds its snoozed threads). Only for a
				     request on more than one day: a one-time one's prayed day is the one in the header. -->
				{#if r.recurring || r.prayedDates.some((date) => date !== r.startDate)}
					<Collapsible.Root bind:open={prayedOpen}>
						<Collapsible.Trigger
							disabled={!r.prayedDates.length}
							class="flex min-h-11 w-full items-center gap-2 rounded-xl border bg-card px-4 text-sm text-muted-foreground transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none enabled:hover:bg-accent/40 enabled:hover:text-foreground"
						>
							<span class="flex-1 text-left">Prayed</span>
							<span class="tabular">{r.prayedCount}</span>
							<ChevronRight
								class={[
									'size-4 transition-transform',
									prayedOpen && 'rotate-90',
									!r.prayedDates.length && 'invisible'
								]}
								aria-hidden="true"
							/>
						</Collapsible.Trigger>
						<Collapsible.Content>
							<ul class="flex flex-wrap gap-2 pt-3">
								{#each history as day (day)}
									<li>
										<a
											href={dayHref(day)}
											class="flex h-9 items-center rounded-full border border-sage/25 bg-sage/8 px-3 text-sm transition-colors hover:bg-sage/15 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
											aria-label="Prayed {formatDay(day, 'long')}"
										>
											{day === today.current ? 'Today' : dateLabel(day, today.current)}
										</a>
									</li>
								{/each}
							</ul>
							{#if r.prayedDates.length > HISTORY_SHOWN}
								<Button
									variant="ghost"
									class="mt-2 h-10 px-2 text-candle"
									onclick={() => (historyOpen = !historyOpen)}
								>
									{historyOpen ? 'Show fewer' : `Show all ${r.prayedDates.length}`}
								</Button>
							{/if}
						</Collapsible.Content>
					</Collapsible.Root>
				{/if}
			</div>
		{/key}
	{/if}

	<AdaptiveSheet
		bind:open={answerOpen}
		title="Mark answered"
		description="It stops coming up after the day it was answered."
	>
		<form id={answerFormId} class="flex flex-col gap-6 pt-1 pb-2" onsubmit={saveAnswer}>
			<div class="flex flex-col gap-2">
				<Label for="{answerFormId}-day">Answered on</Label>
				<DateField
					id="{answerFormId}-day"
					bind:value={answerDay}
					min={r.startDate}
					weekStart={me.weekStart}
				/>
			</div>
			<div class="flex flex-col gap-2">
				<Label for="{answerFormId}-note">
					How it was answered <span class="font-normal text-muted-foreground">(optional)</span>
				</Label>
				<Textarea
					id="{answerFormId}-note"
					bind:value={answerNote}
					rows={3}
					maxlength={2000}
					class="max-h-48"
				/>
			</div>
		</form>
		{#snippet footer()}
			<Button variant="outline" class="h-11" onclick={() => (answerOpen = false)}>Cancel</Button>
			<Button type="submit" form={answerFormId} class="h-11" disabled={answering}>
				{#if answering}<Spinner />{/if}
				Mark answered
			</Button>
		{/snippet}
	</AdaptiveSheet>

	<AlertDialog.Root bind:open={confirmOpen}>
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title class="font-display text-xl">Delete {r.title}?</AlertDialog.Title>
				<AlertDialog.Description>
					This permanently deletes the request and every day it was marked prayed. To keep it but
					stop it coming up, mark it answered instead.
				</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Cancel class="h-11" disabled={deleting}>Cancel</AlertDialog.Cancel>
				<AlertDialog.Action
					variant="destructive"
					class="h-11"
					disabled={deleting}
					onclick={deleteRequest}
				>
					{#if deleting}<Spinner />{/if}
					Delete request
				</AlertDialog.Action>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>
{:else if !deleting}
	<PageHeader title="Request" back={{ href: resolve('/requests'), label: 'Requests' }} />
	<div class="page-column">
		<Empty.Root class="border">
			<Empty.Header>
				<Empty.Media variant="icon"><HandHeart /></Empty.Media>
				<Empty.Title class="font-display text-xl">This request isn't here</Empty.Title>
				<Empty.Description>It may have been deleted, or the link is wrong.</Empty.Description>
			</Empty.Header>
			<Empty.Content>
				<Button href={resolve('/requests')} variant="outline" class="h-11 px-4">All requests</Button
				>
			</Empty.Content>
		</Empty.Root>
	</div>
{/if}
