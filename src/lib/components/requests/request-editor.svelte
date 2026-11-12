<script lang="ts" module>
	import type { Id } from '#convex/_generated/dataModel.js';
	import type { Schedule } from '#convex/shared/recurrence.js';

	/**
	 * Adding one (starting on `day`; `fromDay` when added from that day on the Days tab, so the day is already
	 * chosen and isn't asked again), or changing one.
	 */
	export type EditorTarget =
		| { kind: 'add'; day: string; fromDay?: boolean }
		| {
				kind: 'edit';
				request: {
					requestId: Id<'requests'>;
					title: string;
					notes: string | null;
					schedule: Schedule;
					/** When it was answered: it can't start after that. */
					answeredOn: string | null;
				};
		  };
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import { slide } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import { useMutation } from 'convex-svelte';
	import { api } from '#convex/_generated/api.js';
	import { startsAfterAnswer } from '#convex/model/requests.js';
	import {
		addDays,
		describeSchedule,
		MAX_COUNT,
		MAX_INTERVAL,
		nextOccurrences,
		sortWeekdays,
		toRRule,
		validateSchedule,
		weekdayOf,
		WEEKDAYS,
		type Ends,
		type Repeat,
		type WeekStart,
		type Weekday
	} from '#convex/shared/recurrence.js';
	import AdaptiveSheet from '#lib/components/adaptive-sheet.svelte';
	import DateField from '#lib/components/date-field.svelte';
	import NumberStepper from '#lib/components/number-stepper.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';
	import { dateLabel, dayName, relativeDay } from '#lib/dates.js';
	import { toastError } from '#lib/errors.js';
	import { today } from '#lib/today.svelte.js';

	let {
		open = $bindable(false),
		target,
		weekStart,
		inline = false,
		focus,
		onsaved
	}: {
		open: boolean;
		target: EditorTarget;
		/**
		 * In place of the request's page, laid out like it (Meal Tracker's recipe editor): the title edited where
		 * it sits, Save and Cancel beside it (in a bar above the tabs on phones). Shown while `open`.
		 */
		inline?: boolean;
		/** In place: the field to start in. */
		focus?: 'notes';
		/** The person's first day of the week: the weekday order, and how new "every N weeks" rules count. */
		weekStart: WeekStart;
		/** Called with the request once it's saved. */
		onsaved?: (requestId: Id<'requests'>) => void;
	} = $props();

	type Choice = 'none' | 'daily' | 'days' | 'weekly' | 'monthly' | 'yearly';
	const CHOICES: { value: Choice; label: string }[] = [
		{ value: 'none', label: "Doesn't repeat" },
		{ value: 'daily', label: 'Every day' },
		{ value: 'days', label: 'Every few days' },
		{ value: 'weekly', label: 'Weekly' },
		{ value: 'monthly', label: 'Monthly' },
		{ value: 'yearly', label: 'Yearly' }
	];
	const UNITS = { weekly: 'weeks', monthly: 'months', yearly: 'years' } as const;
	type EndChoice = Ends['kind'];
	const ENDS: { value: EndChoice; label: string }[] = [
		{ value: 'never', label: 'Never' },
		{ value: 'until', label: 'On a day' },
		{ value: 'count', label: 'After a number of times' }
	];
	const DAY_NAMES: Record<Weekday, string> = {
		SU: 'Sunday',
		MO: 'Monday',
		TU: 'Tuesday',
		WE: 'Wednesday',
		TH: 'Thursday',
		FR: 'Friday',
		SA: 'Saturday'
	};

	function freshDraft() {
		const request = target.kind === 'edit' ? target.request : undefined;
		const schedule = request?.schedule;
		const startDate = schedule?.startDate ?? (target.kind === 'add' ? target.day : today.current);
		const repeat = schedule?.repeat ?? { kind: 'none' };
		const ends = schedule?.ends ?? { kind: 'never' };
		const choice: Choice =
			repeat.kind === 'daily' ? (repeat.interval === 1 ? 'daily' : 'days') : repeat.kind;
		return {
			title: request?.title ?? '',
			notes: request?.notes ?? '',
			startDate,
			choice,
			/** Every few days: how many. */
			days: repeat.kind === 'daily' && repeat.interval > 1 ? repeat.interval : 3,
			/** Every N weeks, months or years. */
			interval: repeat.kind !== 'none' && repeat.kind !== 'daily' ? repeat.interval : 1,
			/** Null: the start date's weekday, following it as the start date changes. */
			weekdays: repeat.kind === 'weekly' ? [...repeat.weekdays] : (null as Weekday[] | null),
			/** A stored weekly rule keeps the week start it was made with. */
			weekStart: schedule?.weekStart,
			ends: ends.kind as EndChoice,
			until: ends.kind === 'until' ? ends.date : addDays(startDate, 30),
			count: ends.kind === 'count' ? ends.count : 10,
			/** Saving was tried: show what's missing. */
			tried: false
		};
	}

	// A fresh draft every time the sheet opens; while it closes, the old one stays on screen. Made as the sheet
	// opens, not in a derived: with async work in flight (the Days tab loading a week), Svelte evaluates deriveds
	// again for each batch, and a derived making the draft handed some of the form a new one while the rest kept
	// editing the old (picking Weekly left the weekdays and "Ends" hidden). An effect runs once per change, as
	// committed.
	let draft = $state(untrack(freshDraft));
	let wasOpen = untrack(() => open);
	$effect.pre(() => {
		if (open && !wasOpen) draft = untrack(freshDraft);
		wasOpen = open;
	});

	const ruleWeekStart = $derived(draft.weekStart ?? weekStart);
	const weekdays = $derived(draft.weekdays ?? [weekdayOf(draft.startDate)]);
	const orderedWeekdays = $derived(sortWeekdays(WEEKDAYS, weekStart));

	const schedule = $derived.by(() => {
		const { choice, startDate } = draft;
		const repeat: Repeat =
			choice === 'none'
				? { kind: 'none' }
				: choice === 'daily'
					? { kind: 'daily', interval: 1 }
					: choice === 'days'
						? { kind: 'daily', interval: draft.days }
						: choice === 'weekly'
							? { kind: 'weekly', interval: draft.interval, weekdays }
							: { kind: choice, interval: draft.interval };
		const ends: Ends =
			choice === 'none' || draft.ends === 'never'
				? { kind: 'never' }
				: draft.ends === 'until'
					? { kind: 'until', date: draft.until }
					: { kind: 'count', count: draft.count };
		return {
			startDate,
			repeat,
			ends,
			...(choice === 'weekly' ? { weekStart: ruleWeekStart } : {})
		};
	});

	// Added from a day on the Days tab: that's the day it starts, so it isn't asked again.
	const fromDay = $derived(target.kind === 'add' && target.fromDay ? target.day : null);
	const titleProblem = $derived(draft.title.trim() ? null : 'Give it a title');
	// Answered, it can't start after the answer (requests.update says the same).
	const answeredOn = $derived(target.kind === 'edit' ? target.request.answeredOn : null);
	const problem = $derived(
		answeredOn && schedule.startDate > answeredOn
			? startsAfterAnswer(answeredOn)
			: validateSchedule(schedule)
	);

	// What it comes to, as it's edited: the schedule in words and the next few days it falls on.
	const preview = $derived.by(() => {
		if (problem) return undefined;
		const rrule = toRRule(schedule);
		const from = schedule.startDate > today.current ? schedule.startDate : today.current;
		return {
			summary: describeSchedule(schedule, today.current),
			dates: nextOccurrences({ startDate: schedule.startDate, rrule }, from, 5)
		};
	});

	const create = useMutation(api.requests.create);
	const update = useMutation(api.requests.update);
	let saving = $state(false);
	const formId = $props.id();

	function setChoice(value: string) {
		// A second tap on the chosen one would clear it.
		if (CHOICES.some((c) => c.value === value)) draft.choice = value as Choice;
	}
	function setEnds(value: string) {
		if (ENDS.some((e) => e.value === value)) draft.ends = value as EndChoice;
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		draft.tried = true;
		if (titleProblem || problem || saving) return;
		saving = true;
		const title = draft.title.trim();
		const args = {
			title,
			notes: draft.notes.trim() || undefined,
			schedule: $state.snapshot(schedule)
		};
		try {
			if (target.kind === 'edit') {
				const { requestId } = target.request;
				await update({ requestId, ...args });
				toast.success(`Saved ${title}`);
				onsaved?.(requestId);
			} else {
				const requestId = await create(args);
				toast.success(`Added ${title}`, { description: preview?.summary });
				onsaved?.(requestId);
			}
			open = false;
		} catch (error) {
			toastError(error);
		} finally {
			saving = false;
		}
	}

	// In place, the text is edited where it shows on the page, and the fields grow with it (from Meal Tracker).
	const field =
		'-mx-2 w-full resize-none rounded-md bg-transparent px-2 field-sizing-content outline-none transition-colors placeholder:text-muted-foreground/60 hover:bg-card focus-visible:bg-card focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:ring-3 aria-invalid:ring-tomato/40';
</script>

{#snippet scheduleFields()}
	{#if !fromDay}
		<div class="flex flex-col gap-2">
			<Label for="{formId}-start">{draft.choice === 'none' ? 'Day' : 'Starts'}</Label>
			<DateField id="{formId}-start" bind:value={draft.startDate} {weekStart} />
		</div>
	{/if}

	<fieldset class="flex flex-col gap-3">
		<legend class="mb-2 text-sm font-medium">Repeat</legend>
		<ToggleGroup.Root
			type="single"
			variant="outline"
			spacing={2}
			class="w-full flex-wrap"
			bind:value={() => draft.choice, setChoice}
			aria-label="Repeat"
		>
			{#each CHOICES as option (option.value)}
				<ToggleGroup.Item
					value={option.value}
					class="h-10 rounded-full px-4 text-muted-foreground data-[state=on]:border-candle/60 data-[state=on]:bg-candle/12 data-[state=on]:text-candle"
				>
					{option.label}
				</ToggleGroup.Item>
			{/each}
		</ToggleGroup.Root>

		{#if draft.choice === 'days'}
			<div transition:slide={{ duration: 150 }}>
				<NumberStepper
					bind:value={draft.days}
					min={2}
					max={MAX_INTERVAL}
					before="Every"
					noun="days"
				/>
			</div>
		{:else if draft.choice === 'weekly' || draft.choice === 'monthly' || draft.choice === 'yearly'}
			<div class="flex flex-col gap-3" transition:slide={{ duration: 150 }}>
				{#if draft.choice === 'weekly'}
					<ToggleGroup.Root
						type="multiple"
						variant="outline"
						spacing={1}
						class="w-full justify-between sm:justify-start"
						bind:value={() => weekdays, (days: string[]) => (draft.weekdays = days as Weekday[])}
						aria-label="Days of the week"
					>
						{#each orderedWeekdays as day (day)}
							<ToggleGroup.Item
								value={day}
								aria-label={DAY_NAMES[day]}
								class="size-10 rounded-full p-0 text-muted-foreground data-[state=on]:border-candle/60 data-[state=on]:bg-candle/12 data-[state=on]:text-candle"
							>
								{DAY_NAMES[day][0]}
							</ToggleGroup.Item>
						{/each}
					</ToggleGroup.Root>
				{/if}
				<NumberStepper
					bind:value={draft.interval}
					min={1}
					max={MAX_INTERVAL}
					before="Every"
					noun={UNITS[draft.choice]}
				/>
			</div>
		{/if}
	</fieldset>

	{#if draft.choice !== 'none'}
		<fieldset class="flex flex-col gap-3" transition:slide={{ duration: 150 }}>
			<legend class="mb-2 text-sm font-medium">Ends</legend>
			<ToggleGroup.Root
				type="single"
				variant="outline"
				spacing={2}
				class="w-full flex-wrap"
				bind:value={() => draft.ends, setEnds}
				aria-label="Ends"
			>
				{#each ENDS as option (option.value)}
					<ToggleGroup.Item
						value={option.value}
						class="h-10 rounded-full px-4 text-muted-foreground data-[state=on]:border-candle/60 data-[state=on]:bg-candle/12 data-[state=on]:text-candle"
					>
						{option.label}
					</ToggleGroup.Item>
				{/each}
			</ToggleGroup.Root>
			{#if draft.ends === 'until'}
				<div transition:slide={{ duration: 150 }}>
					<DateField
						bind:value={draft.until}
						min={draft.startDate}
						{weekStart}
						invalid={draft.until < draft.startDate}
					/>
				</div>
			{:else if draft.ends === 'count'}
				<div transition:slide={{ duration: 150 }}>
					<NumberStepper
						bind:value={draft.count}
						min={1}
						max={MAX_COUNT}
						before="After"
						noun="times"
					/>
				</div>
			{/if}
		</fieldset>
	{/if}

	<!-- What it comes to, live. -->
	<div class="rounded-lg border bg-card px-4 py-3" aria-live="polite">
		{#if preview}
			<p class="font-display text-lg leading-snug text-candle">{preview.summary}</p>
			{#if draft.choice === 'none'}
				<p class="mt-1 text-sm text-muted-foreground">
					{schedule.startDate === today.current
						? 'Today only.'
						: schedule.startDate > today.current
							? `Just ${dayName(schedule.startDate, today.current, weekStart, true)}.`
							: 'A day gone by: it shows on that day, to mark it prayed.'}
				</p>
			{:else if preview.dates.length}
				<p class="mt-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
					{preview.dates[0] === schedule.startDate && schedule.startDate >= today.current
						? 'Starting'
						: 'Coming up'}
				</p>
				<ul class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
					{#each preview.dates as date (date)}
						<li class="whitespace-nowrap">
							{date === today.current || date === addDays(today.current, 1)
								? relativeDay(date, today.current)
								: dateLabel(date, today.current)}
						</li>
					{/each}
				</ul>
			{:else}
				<p class="mt-1 text-sm text-muted-foreground">No more days after today.</p>
			{/if}
		{:else}
			<p class="text-sm text-tomato">{problem}</p>
		{/if}
	</div>
{/snippet}

{#if inline}
	{#snippet inlineActions(phone: boolean)}
		<Button
			type="button"
			variant={phone ? 'outline' : 'ghost'}
			class={phone ? 'h-11 flex-1' : 'h-10 px-3'}
			disabled={saving}
			onclick={() => (open = false)}
		>
			Cancel
		</Button>
		<Button type="submit" class={phone ? 'h-11 flex-1' : 'h-10 px-4'} disabled={saving}>
			{#if saving}<Spinner />{/if}
			Save
		</Button>
	{/snippet}

	<form id={formId} onsubmit={save} novalidate>
		<!-- Where the page's header is, with "Editing" where Back was, so the title stays put. -->
		<header
			class="page-column flex items-start justify-between gap-3 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-4 md:pt-[calc(2.5rem+env(safe-area-inset-top))]"
		>
			<div class="min-w-0 flex-1">
				<p class="mb-1 flex min-h-8 items-center text-sm text-muted-foreground">Editing</p>
				<textarea
					bind:value={draft.title}
					rows={1}
					maxlength={200}
					placeholder="Who or what to pray for"
					aria-label="Title"
					aria-invalid={draft.tried && !!titleProblem}
					aria-describedby={draft.tried && titleProblem ? `${formId}-title-error` : undefined}
					class={[field, 'font-display text-3xl tracking-tight md:text-4xl']}
					onkeydown={(event) => {
						// Not while an input method is composing: its Enter picks the characters.
						if (event.key !== 'Enter' || event.isComposing) return;
						event.preventDefault();
						event.currentTarget.form?.requestSubmit();
					}}></textarea>
				{#if draft.tried && titleProblem}
					<p id="{formId}-title-error" class="mt-1 text-sm text-tomato">{titleProblem}</p>
				{/if}
			</div>
			<div class="hidden shrink-0 items-center gap-2 pt-9 md:flex">
				{@render inlineActions(false)}
			</div>
		</header>

		<div class="page-column flex flex-col gap-8 pb-10 [view-transition-name:request-body]">
			<section class="flex flex-col gap-2">
				<h2 class="font-sans text-xs font-medium tracking-wide text-muted-foreground uppercase">
					<label for="{formId}-notes">Notes</label>
				</h2>
				<textarea
					id="{formId}-notes"
					bind:value={draft.notes}
					{@attach (node) => {
						if (focus === 'notes') node.focus();
					}}
					placeholder="Details, names, a verse…"
					rows={2}
					maxlength={5000}
					class={[field, '-mt-1 min-h-9 py-1 leading-relaxed']}></textarea>
			</section>
			<section class="flex flex-col gap-6" aria-labelledby="{formId}-schedule">
				<h2
					id="{formId}-schedule"
					class="-mb-2 font-sans text-xs font-medium tracking-wide text-muted-foreground uppercase"
				>
					Schedule
				</h2>
				{@render scheduleFields()}
			</section>
		</div>

		<div
			class="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 page-column flex gap-2 border-t bg-background/95 py-3 backdrop-blur md:hidden"
		>
			{@render inlineActions(true)}
		</div>
	</form>
{:else}
	<AdaptiveSheet
		bind:open
		title={target.kind === 'edit' ? 'Edit request' : 'New request'}
		description={target.kind === 'add'
			? `Something to pray for${fromDay ? ` ${dayName(fromDay, today.current, weekStart, true)}` : ''}, once or on a schedule.`
			: undefined}
	>
		<form id={formId} class="flex flex-col gap-6 pt-1 pb-2" onsubmit={save} novalidate>
			<div class="flex flex-col gap-2">
				<Label for="{formId}-title">Title</Label>
				<Input
					id="{formId}-title"
					bind:value={draft.title}
					placeholder="Who or what to pray for"
					autocomplete="off"
					enterkeyhint="done"
					maxlength={200}
					class="h-11"
					aria-invalid={draft.tried && !!titleProblem}
					aria-describedby={draft.tried && titleProblem ? `${formId}-title-error` : undefined}
				/>
				{#if draft.tried && titleProblem}
					<p id="{formId}-title-error" class="text-sm text-tomato">{titleProblem}</p>
				{/if}
			</div>

			<div class="flex flex-col gap-2">
				<Label for="{formId}-notes">
					Notes <span class="font-normal text-muted-foreground">(optional)</span>
				</Label>
				<Textarea
					id="{formId}-notes"
					bind:value={draft.notes}
					placeholder="Details, names, a verse…"
					rows={3}
					maxlength={5000}
					class="max-h-48"
				/>
			</div>

			{@render scheduleFields()}
		</form>

		{#snippet footer()}
			<Button variant="outline" class="h-11" disabled={saving} onclick={() => (open = false)}>
				Cancel
			</Button>
			<Button type="submit" form={formId} class="h-11" disabled={saving}>
				{#if saving}<Spinner />{/if}
				{target.kind === 'edit' ? 'Save' : 'Add request'}
			</Button>
		{/snippet}
	</AdaptiveSheet>
{/if}
