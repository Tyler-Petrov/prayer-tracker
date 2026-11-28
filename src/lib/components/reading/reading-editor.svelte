<script lang="ts" module>
	import type { Id } from '#convex/_generated/dataModel.js';
	import type { ReadingPlanFields } from '#convex/shared/bible.js';

	/** Starting a plan, or changing one (from its page). */
	export type ReadingEditorTarget =
		| { kind: 'add' }
		| {
				kind: 'edit';
				plan: {
					planId: Id<'readingPlans'>;
					book: string;
					fields: ReadingPlanFields;
					/** Its first reading not checked off: where they are now. */
					next: { date: string; from: number } | null;
				};
				/** Readings already checked off: they keep their day and chapters, so the new plan goes around them. */
				read: { date: string; from: number; to: number }[];
		  };
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import { slide } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import { useMutation } from 'convex-svelte';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { api } from '#convex/_generated/api.js';
	import { planSummary } from '#convex/model/reading.js';
	import {
		BOOKS,
		chaptersIn,
		isBook,
		NEW_TESTAMENT,
		passageLabel,
		planReadings,
		validatePlan,
		type ReadingRepeat
	} from '#convex/shared/bible.js';
	import {
		addDays,
		MAX_INTERVAL,
		sortWeekdays,
		weekdayOf,
		WEEKDAYS,
		type WeekStart,
		type Weekday
	} from '#convex/shared/recurrence.js';
	import AdaptiveSheet from '#lib/components/adaptive-sheet.svelte';
	import DateField from '#lib/components/date-field.svelte';
	import NumberStepper from '#lib/components/number-stepper.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';
	import { dateLabel, relativeDay } from '#lib/dates.js';
	import { toastError } from '#lib/errors.js';
	import { today } from '#lib/today.svelte.js';

	let {
		open = $bindable(false),
		target,
		weekStart,
		onsaved
	}: {
		open: boolean;
		target: ReadingEditorTarget;
		/** The person's first day of the week: the weekday order, and how weekly plans count. */
		weekStart: WeekStart;
		/** Called with the plan once it's saved. */
		onsaved?: (planId: Id<'readingPlans'>) => void;
	} = $props();

	type Choice = 'daily' | 'days' | 'weekly';
	const CHOICES: { value: Choice; label: string }[] = [
		{ value: 'daily', label: 'Every day' },
		{ value: 'days', label: 'Every few days' },
		{ value: 'weekly', label: 'Certain days' }
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
		const plan = target.kind === 'edit' ? target.plan : undefined;
		const fields = plan?.fields;
		const repeat = fields?.repeat ?? { kind: 'daily', interval: 1 };
		// Changing a plan carries on from where they are: the first chapter not read, from today (or from its next
		// reading, when that's later).
		const next = plan?.next;
		const startDate = next && next.date > today.current ? next.date : today.current;
		return {
			book: plan?.book ?? '',
			fromChapter: next?.from ?? fields?.fromChapter ?? 1,
			chaptersPerDay: fields?.chaptersPerDay ?? 1,
			startDate: plan ? startDate : today.current,
			choice: (repeat.kind === 'weekly'
				? 'weekly'
				: repeat.interval === 1
					? 'daily'
					: 'days') as Choice,
			days: repeat.kind === 'daily' && repeat.interval > 1 ? repeat.interval : 2,
			/** Null: the start date's weekday, following it as the start date changes. */
			weekdays: repeat.kind === 'weekly' ? [...repeat.weekdays] : (null as Weekday[] | null),
			weekStart: fields?.weekStart,
			tried: false
		};
	}

	// A fresh draft each time the sheet opens (as the request editor does, and for the same reason: made in an
	// effect, not a derived).
	let draft = $state(untrack(freshDraft));
	let wasOpen = untrack(() => open);
	$effect.pre(() => {
		if (open && !wasOpen) draft = untrack(freshDraft);
		wasOpen = open;
	});

	const chapters = $derived(isBook(draft.book) ? chaptersIn(draft.book) : undefined);
	/** A new book can have fewer chapters than the numbers picked for the last one. */
	function fitChapters(event: Event) {
		// From the select itself: whether `bind:value` has run yet doesn't matter.
		const book = (event.currentTarget as HTMLSelectElement).value;
		if (!isBook(book)) return;
		const most = chaptersIn(book);
		if (draft.fromChapter > most) draft.fromChapter = 1;
		if (draft.chaptersPerDay > most) draft.chaptersPerDay = most;
	}

	const weekdays = $derived(draft.weekdays ?? [weekdayOf(draft.startDate)]);
	const orderedWeekdays = $derived(sortWeekdays(WEEKDAYS, weekStart));
	const fields = $derived.by(() => {
		const repeat: ReadingRepeat =
			draft.choice === 'weekly'
				? { kind: 'weekly', interval: 1, weekdays }
				: { kind: 'daily', interval: draft.choice === 'days' ? draft.days : 1 };
		return {
			fromChapter: draft.fromChapter,
			chaptersPerDay: draft.chaptersPerDay,
			startDate: draft.startDate,
			repeat,
			...(draft.choice === 'weekly' ? { weekStart: draft.weekStart ?? weekStart } : {})
		};
	});
	const problem = $derived(validatePlan(draft.book, fields));

	// What it comes to: the first few readings, and when the book is done.
	const read = $derived(target.kind === 'edit' ? target.read : []);
	const preview = $derived.by(() => {
		if (problem) return undefined;
		const readings = planReadings(draft.book, fields, read);
		return {
			summary: planSummary(fields, today.current),
			first: readings.slice(0, 3),
			last: readings.at(-1),
			count: readings.length
		};
	});

	const when = (date: string) =>
		date === today.current || date === addDays(today.current, 1)
			? relativeDay(date, today.current)
			: dateLabel(date, today.current);

	const create = useMutation(api.reading.create);
	const update = useMutation(api.reading.update);
	let saving = $state(false);
	const formId = $props.id();

	function setChoice(value: string) {
		// A second tap on the chosen one would clear it.
		if (CHOICES.some((c) => c.value === value)) draft.choice = value as Choice;
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		draft.tried = true;
		if (problem || saving) return;
		saving = true;
		try {
			const planFields = $state.snapshot(fields);
			if (target.kind === 'edit') {
				const { planId, book } = target.plan;
				await update({ planId, fields: planFields });
				toast.success(`Planned the rest of ${book}`, { description: preview?.summary });
				onsaved?.(planId);
			} else {
				const planId = await create({ book: draft.book, fields: planFields });
				toast.success(`Reading ${draft.book}`, { description: preview?.summary });
				onsaved?.(planId);
			}
			open = false;
		} catch (error) {
			toastError(error);
		} finally {
			saving = false;
		}
	}

	const toggle =
		'text-muted-foreground data-[state=on]:border-candle/60 data-[state=on]:bg-candle/12 data-[state=on]:text-candle';
</script>

<AdaptiveSheet
	bind:open
	title={target.kind === 'edit' ? `Change ${target.plan.book}` : 'Read a book'}
	description={target.kind === 'add'
		? 'Some chapters at a time, until the end of the book.'
		: 'Chapters already checked off stay as they are; the rest are planned again from here.'}
>
	<form id={formId} class="flex flex-col gap-6 pt-1 pb-2" onsubmit={save} novalidate>
		{#if target.kind === 'add'}
			<div class="flex flex-col gap-2">
				<Label for="{formId}-book">Book</Label>
				<!-- The phone's own picker: a list of 66 inside a drawer is one layer too many. -->
				<div class="relative">
					<select
						id="{formId}-book"
						bind:value={draft.book}
						onchange={fitChapters}
						aria-invalid={draft.tried && !isBook(draft.book)}
						class={[
							'h-11 w-full appearance-none rounded-md border border-input bg-input/30 pr-9 pl-3 text-base shadow-xs transition-[color,box-shadow] outline-none hover:bg-input/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm',
							!draft.book && 'text-muted-foreground'
						]}
					>
						<option value="" disabled>Pick a book</option>
						<optgroup label="Old Testament">
							{#each BOOKS.slice(0, NEW_TESTAMENT) as [name] (name)}
								<option value={name}>{name}</option>
							{/each}
						</optgroup>
						<optgroup label="New Testament">
							{#each BOOKS.slice(NEW_TESTAMENT) as [name] (name)}
								<option value={name}>{name}</option>
							{/each}
						</optgroup>
					</select>
					<ChevronDown
						class="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
					/>
				</div>
			</div>
		{/if}

		{#if chapters}
			<div class="flex flex-col gap-6" transition:slide={{ duration: 150 }}>
				<div class="flex flex-col gap-2">
					<Label>Where you are</Label>
					<NumberStepper
						bind:value={draft.fromChapter}
						min={1}
						max={chapters}
						before="Chapter"
						noun="of {chapters}"
						name="chapters"
					/>
				</div>
				<div class="flex flex-col gap-2">
					<Label>How much each time</Label>
					<NumberStepper bind:value={draft.chaptersPerDay} min={1} max={chapters} noun="chapters" />
				</div>
			</div>
		{/if}

		<fieldset class="flex flex-col gap-3">
			<legend class="mb-2 text-sm font-medium">How often</legend>
			<ToggleGroup.Root
				type="single"
				variant="outline"
				spacing={2}
				class="w-full flex-wrap"
				bind:value={() => draft.choice, setChoice}
				aria-label="How often"
			>
				{#each CHOICES as option (option.value)}
					<ToggleGroup.Item value={option.value} class="h-10 rounded-full px-4 {toggle}">
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
			{:else if draft.choice === 'weekly'}
				<div transition:slide={{ duration: 150 }}>
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
								class="size-10 rounded-full p-0 {toggle}"
							>
								{DAY_NAMES[day][0]}
							</ToggleGroup.Item>
						{/each}
					</ToggleGroup.Root>
				</div>
			{/if}
		</fieldset>

		<div class="flex flex-col gap-2">
			<Label for="{formId}-start">Starts</Label>
			<DateField id="{formId}-start" bind:value={draft.startDate} {weekStart} />
		</div>

		<!-- What it comes to, live. -->
		<div class="rounded-lg border bg-card px-4 py-3" aria-live="polite">
			{#if preview}
				<p class="font-display text-lg leading-snug text-candle">{preview.summary}</p>
				<ul class="mt-2 flex flex-col gap-0.5 text-sm">
					{#each preview.first as reading (reading.date)}
						<li class="flex justify-between gap-3">
							<span>{passageLabel(draft.book, reading)}</span>
							<span class="text-muted-foreground">{when(reading.date)}</span>
						</li>
					{/each}
				</ul>
				{#if preview.last}
					<p class="mt-2 text-sm text-muted-foreground">
						{preview.count > 3 ? '… ' : ''}Finishes {draft.book}
						{when(preview.last.date)}{preview.count > 1 ? ` · ${preview.count} readings` : ''}
					</p>
				{/if}
			{:else if !draft.book}
				<p class="text-sm text-muted-foreground">Pick a book to see the readings.</p>
			{:else}
				<p class="text-sm text-tomato">{problem}</p>
			{/if}
		</div>
	</form>

	{#snippet footer()}
		<Button variant="outline" class="h-11" disabled={saving} onclick={() => (open = false)}>
			Cancel
		</Button>
		<Button type="submit" form={formId} class="h-11" disabled={saving}>
			{#if saving}<Spinner />{/if}
			{target.kind === 'edit' ? 'Save' : 'Start reading'}
		</Button>
	{/snippet}
</AdaptiveSheet>
