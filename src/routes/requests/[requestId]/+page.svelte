<script lang="ts">
	import { afterNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { slide } from 'svelte/transition';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import CalendarX2 from '@lucide/svelte/icons/calendar-x-2';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import HandHeart from '@lucide/svelte/icons/hand-heart';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Trash from '@lucide/svelte/icons/trash';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import { api } from '#convex/_generated/api.js';
	import type { Id } from '#convex/_generated/dataModel.js';
	import { isDate, occursOn } from '#convex/shared/recurrence.js';
	import AdaptiveSheet from '#lib/components/adaptive-sheet.svelte';
	import CheckMark from '#lib/components/check-mark.svelte';
	import DateField from '#lib/components/date-field.svelte';
	import PageHeader from '#lib/components/page-header.svelte';
	import RequestEditor from '#lib/components/requests/request-editor.svelte';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
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
	 * The day the page is about: the one tapped on the Days tab, else today. Shown when it's on the Days tab
	 * that day: scheduled (skipped or not), or marked prayed.
	 */
	const day = $derived.by(() => {
		if (!request) return undefined;
		const date = dayParam ?? today.current;
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
	const skippedAhead = $derived(request?.skipDates.filter((d) => d >= today.current) ?? []);

	const HISTORY_SHOWN = 24;
	let historyOpen = $state(false);
	const history = $derived(
		historyOpen
			? (request?.prayedDates ?? [])
			: (request?.prayedDates.slice(0, HISTORY_SHOWN) ?? [])
	);

	let editorOpen = $state(false);

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
	{#snippet requestActionButtons(phone: boolean)}
		{#if r.answeredOn}
			<Button
				variant="secondary"
				class={phone ? 'h-11 flex-1' : 'h-10 px-3'}
				onclick={() => target && actions.unanswer(target)}
			>
				<Undo2 />
				Not answered
			</Button>
		{:else}
			<Button class={phone ? 'h-11 flex-1' : 'h-10 px-3'} onclick={startAnswer}>
				<Sparkles />
				Mark answered
			</Button>
		{/if}
		<Button
			variant="outline"
			class={phone ? 'h-11 px-4' : 'h-10 px-3'}
			onclick={() => (editorOpen = true)}
		>
			<Pencil />
			Edit
		</Button>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						variant={phone ? 'outline' : 'ghost'}
						size="icon"
						class={phone ? 'size-11' : 'size-10'}
						aria-label="More"
					>
						<Ellipsis />
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="end" class="w-auto min-w-44">
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

	<!-- Long titles wrap instead of truncating; on phones the actions move below so the title gets the full width. -->
	<div class="[&_h1]:text-balance [&_h1]:break-words [&_h1]:whitespace-normal">
		<PageHeader title={r.title} {back} description={r.summary}>
			{#snippet actions()}
				<div class="hidden items-center gap-2 md:flex">{@render requestActionButtons(false)}</div>
			{/snippet}
		</PageHeader>
	</div>
	<div class="page-column -mt-1 flex gap-2 pb-4 md:hidden">
		{@render requestActionButtons(true)}
	</div>

	{#key requestId}
		<div class="page-column flex flex-col gap-6 pb-10">
			{#if r.answeredOn}
				<section
					class="rounded-xl border border-lavender/30 bg-lavender/8 px-4 py-3"
					aria-label="Answered"
					transition:slide={{ duration: 200 }}
				>
					<p class="flex items-center gap-2 font-display text-lg text-lavender">
						<Sparkles class="size-4" aria-hidden="true" />
						Answered {dateLabel(r.answeredOn, today.current)}
					</p>
					{#if r.answerNote}
						<p class="mt-1 text-sm whitespace-pre-wrap">{r.answerNote}</p>
					{/if}
				</section>
			{/if}

			{#if day}
				{@const on = dayName(day.date, today.current, me.weekStart, true)}
				<!-- The day's check and skip, right here. -->
				<section
					aria-labelledby="day-heading"
					class={[
						'divide-y overflow-hidden rounded-xl border bg-card',
						day.prayed ? 'border-sage/25' : !day.skipped && 'border-candle/25'
					]}
				>
					<h2 id="day-heading" class="sr-only">
						{dayName(day.date, today.current, me.weekStart)}, {formatDay(day.date, 'month')}
					</h2>
					{#if day.skipped}
						<div class="flex min-h-14 items-center gap-3 px-4">
							<span
								class="size-6 shrink-0 rounded-full border-2 border-dashed border-muted-foreground/40"
								aria-hidden="true"
							></span>
							<span class="flex-1 text-muted-foreground">Skipped {on}</span>
						</div>
						<button
							type="button"
							class="flex min-h-11 w-full items-center gap-3 px-4 text-left text-sm text-candle transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none"
							onclick={() => target && actions.skip(target, day.date, false, on)}
						>
							<Undo2 class="size-4" aria-hidden="true" />
							Bring back {on}
						</button>
					{:else}
						<button
							type="button"
							aria-pressed={day.prayed}
							class={[
								'flex min-h-14 w-full items-center gap-3 px-4 text-left transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none',
								day.prayed && 'bg-sage/5'
							]}
							onclick={() => target && actions.prayed(target, day.date, !day.prayed)}
						>
							<CheckMark checked={day.prayed} />
							<span class="flex-1">{day.prayed ? `Prayed ${on}` : `Pray for this ${on}`}</span>
						</button>
						{#if r.recurring && day.scheduled}
							<button
								type="button"
								class="flex min-h-11 w-full items-center gap-3 px-4 text-left text-sm text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground focus-visible:bg-accent/40 focus-visible:outline-none"
								onclick={() => target && actions.skip(target, day.date, true, on)}
							>
								<CalendarX2 class="size-4" aria-hidden="true" />
								Skip just {on}
							</button>
						{/if}
					{/if}
				</section>
			{/if}

			{#if r.notes}
				<section aria-labelledby="notes-heading">
					<h2
						id="notes-heading"
						class="mb-2 font-sans text-xs font-medium tracking-wide text-muted-foreground uppercase"
					>
						Notes
					</h2>
					<p class="leading-relaxed whitespace-pre-wrap">{r.notes}</p>
				</section>
			{/if}

			<section aria-labelledby="schedule-heading" class="rounded-xl border bg-card px-4 py-3">
				<h2
					id="schedule-heading"
					class="font-sans text-xs font-medium tracking-wide text-muted-foreground uppercase"
				>
					Schedule
				</h2>
				<p class="mt-1 font-display text-lg leading-snug">{r.summary}</p>
				<p class="mt-0.5 text-sm text-muted-foreground">
					{[
						`${r.recurring ? 'Started' : 'On'} ${dateLabel(r.startDate, today.current)}`,
						r.recurring && r.endDate && !r.answeredOn
							? `last day ${dateLabel(r.endDate, today.current)}`
							: undefined
					]
						.filter(Boolean)
						.join(' · ')}
				</p>
				{#if r.upcoming.length}
					<h3 class="mt-4 text-sm font-medium">Coming up</h3>
					<ul class="mt-1 flex flex-col">
						{#each r.upcoming as day (day)}
							<li>
								<a
									href={dayHref(day)}
									class="-mx-2 flex min-h-10 items-center justify-between gap-3 rounded-md px-2 text-sm transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
								>
									<span class={day === today.current ? 'text-candle' : undefined}>
										{dayName(day, today.current, me.weekStart)}
									</span>
									<span class="text-muted-foreground">{dateLabel(day, today.current)}</span>
								</a>
							</li>
						{/each}
					</ul>
				{:else if !r.answeredOn}
					<p class="mt-3 text-sm text-muted-foreground">No more days on its schedule.</p>
				{/if}
				{#if skippedAhead.length}
					<h3 class="mt-4 text-sm font-medium">Skipped</h3>
					<ul class="mt-1 flex flex-col">
						{#each skippedAhead as day (day)}
							<li
								class="flex min-h-10 items-center justify-between gap-3 text-sm"
								transition:slide={{ duration: 150 }}
							>
								<span class="text-muted-foreground line-through">
									{dateLabel(day, today.current)}
								</span>
								<Button
									variant="ghost"
									class="h-9 text-candle"
									onclick={() =>
										target &&
										actions.skip(
											target,
											day,
											false,
											dayName(day, today.current, me.weekStart, true)
										)}
								>
									<Undo2 />
									Bring back
								</Button>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<section aria-labelledby="history-heading">
				<h2
					id="history-heading"
					class="mb-2 flex items-baseline justify-between font-sans text-xs font-medium tracking-wide text-muted-foreground uppercase"
				>
					Prayed
					<span class="tabular tracking-normal normal-case">
						{r.prayedCount === 0
							? 'not yet'
							: r.prayedCount === 1
								? 'once'
								: `${r.prayedCount} times`}
					</span>
				</h2>
				{#if r.prayedDates.length}
					<ul class="flex flex-wrap gap-2">
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
				{:else}
					<p class="rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground">
						Days you mark it prayed show here.
					</p>
				{/if}
			</section>
		</div>
	{/key}

	<RequestEditor
		bind:open={editorOpen}
		target={{ kind: 'edit', request: r }}
		weekStart={me.weekStart}
	/>

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
