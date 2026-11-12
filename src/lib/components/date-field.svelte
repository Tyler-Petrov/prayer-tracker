<script lang="ts">
	import { slide } from 'svelte/transition';
	import { parseDate } from '@internationalized/date';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { isDate, type WeekStart } from '#convex/shared/recurrence.js';
	import { Calendar } from '#lib/components/ui/calendar/index.js';
	import { dateLabel } from '#lib/dates.js';
	import { today } from '#lib/today.svelte.js';

	let {
		value = $bindable(),
		min,
		weekStart = 'SU',
		id,
		invalid = false
	}: {
		/** YYYY-MM-DD. */
		value: string;
		/** The earliest day it can be. */
		min?: string;
		weekStart?: WeekStart;
		/** For a `<label for>`. */
		id?: string;
		invalid?: boolean;
	} = $props();

	// The calendar opens in place, under the field, rather than in a popover: it sits in sheets (a drawer on
	// phones), where a popover would be one layer too many.
	let open = $state(false);
	const date = $derived(isDate(value) ? parseDate(value) : undefined);
	const calendarId = $props.id();
</script>

<div>
	<button
		type="button"
		{id}
		aria-expanded={open}
		aria-controls={calendarId}
		data-invalid={invalid || undefined}
		class="flex h-11 w-full items-center gap-2.5 rounded-md border border-input bg-input/30 px-3 text-left text-base shadow-xs transition-[color,box-shadow] outline-none hover:bg-input/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-invalid:border-destructive md:text-sm"
		onclick={() => (open = !open)}
	>
		<CalendarIcon class="size-4 shrink-0 text-muted-foreground" />
		<span class="flex-1 truncate">{date ? dateLabel(value, today.current) : 'Pick a day'}</span>
		<ChevronDown
			class={['size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180']}
		/>
	</button>
	{#if open}
		<div id={calendarId} transition:slide={{ duration: 150 }}>
			<!-- preventDeselect: tapping the chosen day picks it again (and closes) rather than clearing it. -->
			<Calendar
				type="single"
				value={date}
				preventDeselect
				onValueChange={(picked) => {
					if (!picked) return;
					value = picked.toString();
					open = false;
				}}
				weekStartsOn={weekStart === 'MO' ? 1 : 0}
				minValue={min && isDate(min) ? parseDate(min) : undefined}
				locale={navigator.language}
				class="mx-auto mt-2 w-fit rounded-lg border bg-card"
			/>
		</div>
	{/if}
</div>
