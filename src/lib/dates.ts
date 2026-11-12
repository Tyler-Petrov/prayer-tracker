import {
	DateFormatter,
	fromDate,
	getLocalTimeZone,
	parseDate,
	toCalendarDate
} from '@internationalized/date';
import type { WeekStart } from '#convex/shared/recurrence.js';
import { weekStart } from '#convex/shared/weeks.js';

/** Whole days from `from` to `to` (negative if `to` is earlier). */
export const daysBetween = (from: string, to: string) => parseDate(to).compare(parseDate(from));
/** The local calendar day of a timestamp. */
export const dayOf = (ms: number) =>
	toCalendarDate(fromDate(new Date(ms), getLocalTimeZone())).toString();
export const isDay = (s: string | null | undefined): s is string =>
	!!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));

const formats = {
	short: new DateFormatter(navigator.language, {
		weekday: 'short',
		month: 'short',
		day: 'numeric'
	}), // "Thu, Oct 8"
	month: new DateFormatter(navigator.language, { month: 'short', day: 'numeric' }), // "Oct 8"
	weekday: new DateFormatter(navigator.language, { weekday: 'long' }), // "Thursday"
	long: new DateFormatter(navigator.language, { weekday: 'long', month: 'long', day: 'numeric' }), // "Thursday, October 8"
	year: new DateFormatter(navigator.language, {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		year: 'numeric'
	}), // "Thu, Oct 8, 2026"
	date: new DateFormatter(navigator.language, { month: 'short', day: 'numeric', year: 'numeric' }), // "Oct 8, 2027"
	monthYear: new DateFormatter(navigator.language, { month: 'long', year: 'numeric' }) // "October 2026"
};
export function formatDay(day: string, style: keyof typeof formats = 'short') {
	return formats[style].format(parseDate(day).toDate(getLocalTimeZone()));
}
/** "Thu, Oct 8", with the year when it isn't `today`'s ("Thu, Oct 8, 2027"). */
export function dateLabel(day: string, today: string) {
	return formatDay(day, day.slice(0, 4) === today.slice(0, 4) ? 'short' : 'year');
}

/** "Today", "Tomorrow", "Yesterday", else "Thu, Oct 8". */
export function relativeDay(day: string, today: string) {
	const d = daysBetween(today, day);
	return d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : d === -1 ? 'Yesterday' : formatDay(day);
}

/**
 * What a day is called: "Yesterday", "Today", "Tomorrow", else its weekday, as "Next Friday" or
 * "Last Friday" in the weeks either side of this one. Which week is "next" depends on the person's first day of
 * the week (`first`, users.weekStart), so it's required: every label then agrees with the Days headings.
 * `inline` for mid-sentence ("next Friday"), where a day further out also gets its date ("Friday, Oct 30")
 * since no heading says which week.
 */
export function dayName(day: string, today: string, first: WeekStart, inline = false) {
	const d = daysBetween(today, day);
	const weeks = daysBetween(weekStart(today, first), weekStart(day, first)) / 7;
	const weekday = formatDay(day, 'weekday');
	const name =
		d === 0
			? 'today'
			: d === 1
				? 'tomorrow'
				: d === -1
					? 'yesterday'
					: weeks === 1
						? `next ${weekday}`
						: weeks === -1
							? `last ${weekday}`
							: weekday;
	if (!inline) return name[0].toUpperCase() + name.slice(1);
	return Math.abs(weeks) > 1 ? `${weekday}, ${formatDay(day, 'month')}` : name;
}

/** "This week", "Next week", "Last week", else "Week of Oct 12". `inline` for mid-sentence: "this week", "the week of Oct 12". */
export function weekLabel(week: string, today: string, first: WeekStart, inline = false) {
	const n = daysBetween(weekStart(today, first), week) / 7;
	const near = n === 0 ? 'this week' : n === 1 ? 'next week' : n === -1 ? 'last week' : undefined;
	if (near) return inline ? near : near[0].toUpperCase() + near.slice(1);
	return `${inline ? 'the week' : 'Week'} of ${formatDay(week, 'month')}`;
}
