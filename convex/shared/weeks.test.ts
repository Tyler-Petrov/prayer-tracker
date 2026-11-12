import { expect, test } from 'vitest';
import { addDays, addWeeks, weekStart } from './weeks';

test('weeks start on Sunday, or Monday when asked', () => {
	// 2026-11-12 is a Thursday.
	expect(weekStart('2026-11-12')).toBe('2026-11-08');
	expect(weekStart('2026-11-12', 'MO')).toBe('2026-11-09');
	expect(weekStart('2026-11-08')).toBe('2026-11-08');
	expect(weekStart('2026-11-08', 'MO')).toBe('2026-11-02');
	expect(weekStart('2026-11-09', 'MO')).toBe('2026-11-09');
	expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
	expect(addWeeks('2026-12-27', 1)).toBe('2027-01-03');
});

test('weeks before 1970 (negative day numbers) start on the right day', () => {
	// 1969-12-27 was a Saturday.
	expect(weekStart('1969-12-27')).toBe('1969-12-21');
	expect(weekStart('1969-12-27', 'MO')).toBe('1969-12-22');
	expect(weekStart('1969-12-28')).toBe('1969-12-28');
	expect(weekStart('1969-12-31', 'MO')).toBe('1969-12-29');
	// 1960-06-15 was a Wednesday.
	expect(weekStart('1960-06-15')).toBe('1960-06-12');
	expect(weekStart('1960-06-15', 'MO')).toBe('1960-06-13');
	// Every day of a long stretch either side of 1970 lands on a Sunday no later than itself, within a week.
	for (let day = '1969-01-01'; day <= '1971-01-01'; day = addDays(day, 1)) {
		const start = weekStart(day);
		expect(new Date(`${start}T00:00:00Z`).getUTCDay()).toBe(0);
		expect(start <= day && addDays(start, 7) > day).toBe(true);
	}
});
