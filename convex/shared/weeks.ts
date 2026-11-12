// Browser-safe. Weeks are named by their first day as YYYY-MM-DD: Sunday, or Monday for those who start the week
// then (users.weekStart). These are calendar days, so the math runs in UTC whatever the local timezone.
import type { WeekStart } from './recurrence';

const DAY_MS = 86_400_000;
const toDays = (day: string) => Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
const fromDays = (days: number) => new Date(days * DAY_MS).toISOString().slice(0, 10);

export const addDays = (day: string, n: number) => fromDays(toDays(day) + n);
export const addWeeks = (week: string, n: number) => addDays(week, 7 * n);

/** The first day of the week containing `day`. Day 0, 1970-01-01, was a Thursday. */
export function weekStart(day: string, first: WeekStart = 'SU') {
	const days = toDays(day);
	const offset = first === 'MO' ? 3 : 4;
	// A true modulo: before 1970 the day number is negative, and JS `%` keeps the sign.
	return fromDays(days - ((((days + offset) % 7) + 7) % 7));
}
