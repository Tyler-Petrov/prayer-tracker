// Browser-safe, and the one place recurrence is worked out: Convex functions and the Svelte client both import it.
//
// A request's schedule is stored as an RFC 5545 rule with a date-only, floating DTSTART:
//   DTSTART;VALUE=DATE:20261112
//   RRULE:FREQ=WEEKLY;BYDAY=MO,TH;WKST=SU
// Dates are calendar days ("YYYY-MM-DD") with no time or timezone. rrule-temporal anchors a date-only rule at
// midnight UTC, and every date in and out of it goes through UTC midnight, so daylight saving never moves a day.
// A one-time request has no rule at all: it happens on its start date.
//
// rrule-temporal uses the runtime's Temporal when there is one and its own bundled polyfill when there isn't
// (Convex's V8 runtime, most browsers today), so nothing here imports Temporal.
//
// Skipped dates are kept beside the rule (a request's `skipDates`) and taken out after expanding it, which is
// exactly what EXDATE does: like EXDATE, a skipped date still uses up one of "after N times".
import { RRuleTemporal } from 'rrule-temporal';

export type YMD = string;

/** RFC 5545 weekday codes, Sunday first (the order of `Date.getUTCDay()`). */
export const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
export type Weekday = (typeof WEEKDAYS)[number];
/** The first day of the week: decides which weeks "every 2 weeks" counts (WKST). */
export type WeekStart = 'SU' | 'MO';

export type Repeat =
	| { kind: 'none' }
	/** Every `interval` days: 1 is every day, 9 is every 9 days. */
	| { kind: 'daily'; interval: number }
	/** On these weekdays, every `interval` weeks. */
	| { kind: 'weekly'; interval: number; weekdays: Weekday[] }
	/** On the start date's day of the month, every `interval` months. A 29th–31st falls on the last day of shorter months. */
	| { kind: 'monthly'; interval: number }
	/** On the start date's month and day, every `interval` years. Feb 29 falls on Feb 28 in other years. */
	| { kind: 'yearly'; interval: number };

export type Ends =
	| { kind: 'never' }
	/** The last day it can happen on, inclusive. */
	| { kind: 'until'; date: YMD }
	/** After this many occurrences, counted from the start date (skipped ones included, as EXDATE counts). */
	| { kind: 'count'; count: number };

/** The editor's fields. `ends` and `weekStart` only matter when it repeats. */
export type Schedule = { startDate: YMD; repeat: Repeat; ends: Ends; weekStart?: WeekStart };

/** What expanding needs from a request (its stored fields). */
export type Occurring = {
	startDate: YMD;
	/** Absent for a one-time request. */
	rrule?: string;
	skipDates?: YMD[];
	/** It's answered: nothing after this date. */
	answeredOn?: YMD;
};

export const MAX_INTERVAL = 999;
/** rrule-temporal walks a COUNT rule from its start, and gives up past 10,000 steps. */
export const MAX_COUNT = 1000;
/**
 * The longest range days.range answers, and so the most days the Days tab holds at once. Kept to about four
 * months so one query reads a bounded number of prayed marks however many requests there are a day.
 */
export const MAX_RANGE_DAYS = 120;
/** Stands in for "never ends" where a date is needed (an index bound). */
export const OPEN_END = '9999-12-31';

// ---------------------------------------------------------------------------------------------------------------
// Calendar days, as UTC midnights.

const DAY_MS = 86_400_000;
const toDays = (day: YMD) => Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
const fromDays = (days: number) => new Date(days * DAY_MS).toISOString().slice(0, 10);

/** A real calendar day written YYYY-MM-DD (no 2026-02-30). */
export function isDate(value: unknown): boolean {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const ms = Date.parse(`${value}T00:00:00Z`);
	return !isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}
export const addDays = (day: YMD, n: number) => fromDays(toDays(day) + n);
/** Whole days from `from` to `to`, negative when `to` is earlier. */
export const daysBetween = (from: YMD, to: YMD) => toDays(to) - toDays(from);
export const weekdayOf = (day: YMD): Weekday => WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()];
const utc = (day: YMD) => new Date(`${day}T00:00:00Z`);
const compact = (day: YMD) => day.replaceAll('-', '');
const expand = (basic: string) => `${basic.slice(0, 4)}-${basic.slice(4, 6)}-${basic.slice(6, 8)}`;
const plain = (occurrence: { toPlainDate(): { toString(): string } }) =>
	occurrence.toPlainDate().toString();
const min = (a: YMD, b: YMD) => (a < b ? a : b);
const max = (a: YMD, b: YMD) => (a > b ? a : b);

// ---------------------------------------------------------------------------------------------------------------
// Fields to rule and back.

/** What's wrong with a schedule, in words for the person, or null when it's fine. */
export function validateSchedule(schedule: Schedule): string | null {
	const { startDate, repeat, ends } = schedule;
	if (!isDate(startDate)) return 'Pick a start date';
	if (repeat.kind === 'none') return null;
	if (!Number.isInteger(repeat.interval) || repeat.interval < 1 || repeat.interval > MAX_INTERVAL)
		return `Repeat every 1 to ${MAX_INTERVAL}`;
	if (repeat.kind === 'weekly') {
		if (repeat.weekdays.length === 0) return 'Pick at least one day of the week';
		if (repeat.weekdays.some((day) => !WEEKDAYS.includes(day))) return 'Unknown day of the week';
	}
	if (ends.kind === 'until') {
		if (!isDate(ends.date)) return 'Pick an end date';
		if (ends.date < startDate) return 'The end date is before the start date';
	}
	if (ends.kind === 'count') {
		if (!Number.isInteger(ends.count) || ends.count < 1 || ends.count > MAX_COUNT)
			return `End after 1 to ${MAX_COUNT} times`;
		// Dates are four-digit years: a rule whose last time is later can't be stored or shown.
		if (!countEnd(ruleString(schedule)!, startDate))
			return 'That many times runs past the year 9999; end it sooner';
	}
	return null;
}

/**
 * The stored rule for a schedule: `DTSTART;VALUE=DATE:…\nRRULE:…`, or undefined when it doesn't repeat.
 * Deterministic, so the same fields always give the same string. Throws on an invalid schedule.
 */
export function toRRule(schedule: Schedule): string | undefined {
	const problem = validateSchedule(schedule);
	if (problem) throw new Error(problem);
	return ruleString(schedule);
}

/** `toRRule` without the checks. */
function ruleString(schedule: Schedule): string | undefined {
	const { startDate, repeat, ends } = schedule;
	if (repeat.kind === 'none') return undefined;

	const parts = [`FREQ=${repeat.kind.toUpperCase()}`];
	if (repeat.interval !== 1) parts.push(`INTERVAL=${repeat.interval}`);
	const [, month, day] = startDate.split('-').map(Number);
	switch (repeat.kind) {
		case 'weekly': {
			const weekStart = schedule.weekStart ?? 'SU';
			parts.push(
				`BYDAY=${sortWeekdays(repeat.weekdays, weekStart).join(',')}`,
				`WKST=${weekStart}`
			);
			break;
		}
		case 'monthly':
			parts.push(...monthDayParts(day));
			break;
		case 'yearly':
			parts.push(`BYMONTH=${month}`, ...monthDayParts(day));
			break;
	}
	if (ends.kind === 'until') parts.push(`UNTIL=${compact(ends.date)}`);
	if (ends.kind === 'count') parts.push(`COUNT=${ends.count}`);
	return `DTSTART;VALUE=DATE:${compact(startDate)}\nRRULE:${parts.join(';')}`;
}

/**
 * The 29th, 30th or 31st can't happen every month. Rather than skip those months (plain BYMONTHDAY), take the
 * latest of 28…day that the month has: the day itself, or the month's last day (BYSETPOS=-1). Feb 29 yearly
 * likewise falls on Feb 28 outside leap years.
 */
function monthDayParts(day: number) {
	if (day <= 28) return [`BYMONTHDAY=${day}`];
	const days = Array.from({ length: day - 27 }, (_, i) => 28 + i);
	return [`BYMONTHDAY=${days.join(',')}`, 'BYSETPOS=-1'];
}

/** Weekdays in calendar order for a week starting on `weekStart`, without repeats. */
export function sortWeekdays(weekdays: readonly Weekday[], weekStart: WeekStart = 'SU') {
	const order = weekStart === 'MO' ? [...WEEKDAYS.slice(1), 'SU'] : [...WEEKDAYS];
	return order.filter((day): day is Weekday => weekdays.includes(day as Weekday));
}

/**
 * A stored request back into the editor's fields. Reads only the rules `toRRule` writes (and the same rules
 * written differently: CRLF, lowercase, any part order); anything else throws.
 */
export function parseRRule(rrule: string | undefined, startDate: YMD): Schedule {
	if (!rrule) return { startDate, repeat: { kind: 'none' }, ends: { kind: 'never' } };
	let start = startDate;
	let rule: string | undefined;
	for (const line of rrule.split(/\r?\n/).map((l) => l.trim())) {
		const upper = line.toUpperCase();
		if (upper.startsWith('DTSTART'))
			start = expand(upper.slice(upper.indexOf(':') + 1, upper.indexOf(':') + 9));
		else if (upper.startsWith('RRULE:')) rule = upper.slice('RRULE:'.length);
		else if (line) throw new Error(`Unsupported line in rule: ${line}`);
	}
	if (!rule) throw new Error('No RRULE in rule');
	if (!isDate(start)) throw new Error('Bad DTSTART in rule');

	const fields = new Map(
		rule.split(';').map((part) => {
			const [key, value = ''] = part.split('=');
			return [key, value] as const;
		})
	);
	const interval = Number(fields.get('INTERVAL') ?? 1);
	const weekStart: WeekStart = fields.get('WKST') === 'MO' ? 'MO' : 'SU';
	let repeat: Repeat;
	switch (fields.get('FREQ')) {
		case 'DAILY':
			repeat = { kind: 'daily', interval };
			break;
		case 'WEEKLY': {
			const byDay = fields.get('BYDAY');
			const weekdays = byDay ? (byDay.split(',') as Weekday[]) : [weekdayOf(start)];
			repeat = { kind: 'weekly', interval, weekdays: sortWeekdays(weekdays, weekStart) };
			break;
		}
		case 'MONTHLY':
			repeat = { kind: 'monthly', interval };
			break;
		case 'YEARLY':
			repeat = { kind: 'yearly', interval };
			break;
		default:
			throw new Error(`Unsupported FREQ in rule: ${fields.get('FREQ')}`);
	}
	const until = fields.get('UNTIL');
	const count = fields.get('COUNT');
	const ends: Ends = until
		? { kind: 'until', date: expand(until.slice(0, 8)) }
		: count
			? { kind: 'count', count: Number(count) }
			: { kind: 'never' };
	const schedule: Schedule = { startDate: start, repeat, ends };
	if (repeat.kind === 'weekly') schedule.weekStart = weekStart;
	return schedule;
}

// ---------------------------------------------------------------------------------------------------------------
// Expanding.

// Rules are parsed once per string: a query expands the same few requests over and over.
const rules = new Map<string, RRuleTemporal>();
function ruleOf(rrule: string) {
	let rule = rules.get(rrule);
	if (!rule) {
		rule = new RRuleTemporal({ rruleString: rrule });
		if (rules.size > 500) rules.clear();
		rules.set(rrule, rule);
	}
	return rule;
}

/**
 * The dates a request happens on from `from` through `to` (both inclusive), in order. Skipped dates are left
 * out (or kept, with `includeSkipped`), and nothing comes after the day it was answered.
 */
export function occurrences(
	request: Occurring,
	from: YMD,
	to: YMD,
	{ includeSkipped = false }: { includeSkipped?: boolean } = {}
): YMD[] {
	const start = max(from, request.startDate);
	const end = request.answeredOn ? min(to, request.answeredOn) : to;
	if (start > end) return [];
	if (!request.rrule) return request.startDate === start ? [start] : [];
	const dates = ruleOf(request.rrule).between(utc(start), utc(end), true).map(plain);
	if (includeSkipped || !request.skipDates?.length) return dates;
	const skipped = new Set(request.skipDates);
	return dates.filter((date) => !skipped.has(date));
}

/** Whether the request happens on `date`. Skipped dates don't, unless `includeSkipped`. */
export function occursOn(request: Occurring, date: YMD, options?: { includeSkipped?: boolean }) {
	return occurrences(request, date, date, options).length > 0;
}

/** The next `n` dates it happens on, from `onOrAfter` (inclusive), honoring skips and the answer. */
export function nextOccurrences(request: Occurring, onOrAfter: YMD, n: number): YMD[] {
	const dates: YMD[] = [];
	if (n <= 0) return dates;
	const skipped = new Set(request.skipDates);
	const last = request.answeredOn;
	if (!request.rrule) {
		const date = request.startDate;
		const ok = date >= onOrAfter && !skipped.has(date) && (!last || date <= last);
		return ok ? [date] : [];
	}
	const rule = ruleOf(request.rrule);
	let cursor = max(onOrAfter, request.startDate);
	// Every step either finds a date or passes a skipped one, so this ends.
	for (let steps = 0; dates.length < n && steps <= n + skipped.size; steps++) {
		const next = rule.next(utc(cursor), true);
		if (!next) break;
		const date = plain(next);
		if (last && date > last) break;
		if (!skipped.has(date)) dates.push(date);
		cursor = addDays(date, 1);
	}
	return dates;
}

/** The next date it happens on, from `onOrAfter` (inclusive), or null when it never will again. */
export function nextOccurrence(request: Occurring, onOrAfter: YMD): YMD | null {
	return nextOccurrences(request, onOrAfter, 1)[0] ?? null;
}

/** The first `n` dates of a schedule, from its start: the editor's preview. */
export function firstOccurrences(schedule: Schedule, n: number): YMD[] {
	return nextOccurrences(
		{ startDate: schedule.startDate, rrule: toRRule(schedule) },
		schedule.startDate,
		n
	);
}

/**
 * The last date it can happen on: the one-time date, the rule's last occurrence (UNTIL or COUNT), or the day it
 * was answered, whichever is first; `OPEN_END` when it goes on forever. Skips don't count, so it's an upper
 * bound for finding the requests a range of days needs (requests.lastDate).
 */
export function lastPossibleDate(request: Occurring): YMD {
	let last = OPEN_END;
	if (!request.rrule) last = request.startDate;
	else {
		const { ends } = parseRRule(request.rrule, request.startDate);
		if (ends.kind === 'until') last = ends.date;
		// A rule stored before validateSchedule turned down ones ending past 9999 has no date to end on.
		if (ends.kind === 'count') last = countEnd(request.rrule, request.startDate) ?? OPEN_END;
	}
	return request.answeredOn ? min(last, request.answeredOn) : last;
}

/**
 * The last day of a COUNT rule, or null when it falls after 9999-12-31. (Temporal writes later years with a sign
 * and six digits, "+011017-11-12", which would sort before every real date.)
 */
function countEnd(rrule: string, startDate: YMD): YMD | null {
	try {
		const all = ruleOf(rrule).all();
		const last = all.length ? plain(all[all.length - 1]) : startDate;
		return isDate(last) ? last : null;
	} catch {
		// Past the end of Temporal's calendar.
		return null;
	}
}

/**
 * The last day it actually happens on, skips and the answer honored: what "ended" or "last day" means to the
 * person (lastPossibleDate is only an upper bound). Null when it goes on forever, or never happens at all.
 */
export function lastOccurrence(
	request: Occurring,
	/** Its lastPossibleDate, when that's at hand (requests.lastDate). */
	bound: YMD = lastPossibleDate(request)
): YMD | null {
	if (bound === OPEN_END || bound < request.startDate) return null;
	if (!request.rrule) return request.startDate;
	const rule = ruleOf(request.rrule);
	const skipped = new Set(request.skipDates);
	let cursor = bound;
	// Every step either finds a date or passes a skipped one, so this ends.
	for (let steps = 0; steps <= skipped.size; steps++) {
		const previous = rule.previous(utc(cursor), true);
		if (!previous) return null;
		const date = plain(previous);
		if (date < request.startDate) return null;
		if (!skipped.has(date)) return date;
		cursor = addDays(date, -1);
	}
	return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Words.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY_NAMES: Record<Weekday, string> = {
	SU: 'Sun',
	MO: 'Mon',
	TU: 'Tue',
	WE: 'Wed',
	TH: 'Thu',
	FR: 'Fri',
	SA: 'Sat'
};

/** "Nov 12", with the year when it isn't `today`'s ("Nov 12, 2027"). */
export function shortDate(date: YMD, today?: YMD) {
	const [year, month, day] = date.split('-').map(Number);
	const text = `${MONTHS[month - 1]} ${day}`;
	return today && today.slice(0, 4) === date.slice(0, 4) ? text : `${text}, ${year}`;
}

function ordinal(n: number) {
	const tens = n % 100;
	const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th');
	return `${n}${suffix}`;
}

function every(interval: number, unit: string) {
	if (interval === 1) return `Every ${unit}`;
	if (interval === 2) return `Every other ${unit}`;
	return `Every ${interval} ${unit}s`;
}

/**
 * The schedule in a few words: "Once · Nov 12", "Every day", "Every 9 days", "Weekly on Mon, Thu",
 * "Every other week on Sun", "Monthly on the 31st (or last day)", "Yearly on Feb 29", with
 * " · until Dec 31" or " · 10 times" when it ends. Pass `today` to drop the year from this year's dates.
 */
export function describeSchedule(schedule: Schedule, today?: YMD): string {
	const { startDate, repeat, ends } = schedule;
	if (repeat.kind === 'none') return `Once · ${shortDate(startDate, today)}`;
	const [, month, day] = startDate.split('-').map(Number);
	const lateDay = day >= 29 ? ' (or last day)' : '';
	let text: string;
	switch (repeat.kind) {
		case 'daily':
			text = every(repeat.interval, 'day');
			break;
		case 'weekly': {
			const days = sortWeekdays(repeat.weekdays, schedule.weekStart);
			if (days.length === 7 && repeat.interval === 1) {
				text = 'Every day';
				break;
			}
			const names =
				days.length === 7
					? 'every day'
					: sortWeekdays(days, 'MO').join(',') === 'MO,TU,WE,TH,FR'
						? 'weekdays'
						: days.map((d) => WEEKDAY_NAMES[d]).join(', ');
			text = `${repeat.interval === 1 ? 'Weekly' : every(repeat.interval, 'week')} on ${names}`;
			break;
		}
		case 'monthly':
			text = `${repeat.interval === 1 ? 'Monthly' : every(repeat.interval, 'month')} on the ${ordinal(day)}${lateDay}`;
			break;
		case 'yearly': {
			const feb29 = month === 2 && day === 29 ? ' (Feb 28 in other years)' : '';
			text = `${repeat.interval === 1 ? 'Yearly' : every(repeat.interval, 'year')} on ${MONTHS[month - 1]} ${day}${feb29}`;
			break;
		}
	}
	if (ends.kind === 'until') text += ` · until ${shortDate(ends.date, today)}`;
	if (ends.kind === 'count') text += ` · ${ends.count === 1 ? 'once' : `${ends.count} times`}`;
	return text;
}

/** `describeSchedule` for a stored request. */
export function describe(request: Pick<Occurring, 'startDate' | 'rrule'>, today?: YMD) {
	return describeSchedule(parseRRule(request.rrule, request.startDate), today);
}
