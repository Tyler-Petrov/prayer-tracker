import { afterEach, describe, expect, test } from 'vitest';
import {
	addDays,
	daysBetween,
	describeSchedule,
	firstOccurrences,
	isDate,
	lastOccurrence,
	lastPossibleDate,
	nextOccurrence,
	nextOccurrences,
	occurrences,
	occursOn,
	OPEN_END,
	parseRRule,
	toRRule,
	validateSchedule,
	weekdayOf,
	WEEKDAYS,
	type Ends,
	type Occurring,
	type Repeat,
	type Schedule,
	type Weekday,
	type WeekStart,
	type YMD
} from './recurrence';

// ---------------------------------------------------------------------------------------------------------------
// A slow, obvious reference: walk every day and ask whether the schedule has it. The library has to agree.

const daysInMonth = (year: number, month: number) =>
	new Date(Date.UTC(year, month, 0)).getUTCDate();
const parts = (date: YMD) => date.split('-').map(Number) as [number, number, number];

function matches(schedule: Schedule, date: YMD): boolean {
	const { startDate, repeat } = schedule;
	if (date < startDate) return false;
	if (repeat.kind === 'none') return date === startDate;
	const [sy, sm, sd] = parts(startDate);
	const [y, m, d] = parts(date);
	switch (repeat.kind) {
		case 'daily':
			return daysBetween(startDate, date) % repeat.interval === 0;
		case 'weekly': {
			if (!repeat.weekdays.includes(weekdayOf(date))) return false;
			const first = schedule.weekStart === 'MO' ? 1 : 0;
			const weekOf = (day: YMD) =>
				addDays(day, -((WEEKDAYS.indexOf(weekdayOf(day)) - first + 7) % 7));
			return (daysBetween(weekOf(startDate), weekOf(date)) / 7) % repeat.interval === 0;
		}
		case 'monthly': {
			const months = (y - sy) * 12 + (m - sm);
			return months % repeat.interval === 0 && d === Math.min(sd, daysInMonth(y, m));
		}
		case 'yearly':
			return (y - sy) % repeat.interval === 0 && m === sm && d === Math.min(sd, daysInMonth(y, m));
	}
}

/** Every date of the schedule from `from` through `to`, ends applied, the slow way. */
function reference(schedule: Schedule, from: YMD, to: YMD): YMD[] {
	const { ends } = schedule;
	const dates: YMD[] = [];
	let seen = 0;
	for (let day = schedule.startDate; day <= to; day = addDays(day, 1)) {
		if (ends.kind === 'until' && day > ends.date) break;
		if (!matches(schedule, day)) continue;
		seen++;
		if (ends.kind === 'count' && seen > ends.count) break;
		if (day >= from) dates.push(day);
	}
	return dates;
}

function stored(schedule: Schedule, extra: Partial<Occurring> = {}): Occurring {
	return { startDate: schedule.startDate, rrule: toRRule(schedule), ...extra };
}

const never: Ends = { kind: 'never' };
const repeats = (startDate: YMD, repeat: Repeat, ends: Ends = never, weekStart?: WeekStart) =>
	({ startDate, repeat, ends, ...(weekStart && { weekStart }) }) satisfies Schedule;

// ---------------------------------------------------------------------------------------------------------------

describe('the stored rule', () => {
	test('is RFC 5545 with a date-only DTSTART', () => {
		expect(toRRule(repeats('2026-11-12', { kind: 'daily', interval: 1 }))).toBe(
			'DTSTART;VALUE=DATE:20261112\nRRULE:FREQ=DAILY'
		);
		expect(toRRule(repeats('2026-11-12', { kind: 'daily', interval: 9 }))).toBe(
			'DTSTART;VALUE=DATE:20261112\nRRULE:FREQ=DAILY;INTERVAL=9'
		);
		expect(
			toRRule(
				repeats('2026-11-12', { kind: 'weekly', interval: 2, weekdays: ['TH', 'MO'] }, never, 'MO')
			)
		).toBe('DTSTART;VALUE=DATE:20261112\nRRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;WKST=MO');
		expect(toRRule(repeats('2026-11-12', { kind: 'monthly', interval: 1 }))).toBe(
			'DTSTART;VALUE=DATE:20261112\nRRULE:FREQ=MONTHLY;BYMONTHDAY=12'
		);
		expect(toRRule(repeats('2026-01-31', { kind: 'monthly', interval: 3 }))).toBe(
			'DTSTART;VALUE=DATE:20260131\nRRULE:FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=28,29,30,31;BYSETPOS=-1'
		);
		expect(toRRule(repeats('2028-02-29', { kind: 'yearly', interval: 1 }))).toBe(
			'DTSTART;VALUE=DATE:20280229\nRRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1'
		);
		expect(
			toRRule(
				repeats('2026-11-12', { kind: 'daily', interval: 1 }, { kind: 'until', date: '2026-12-31' })
			)
		).toBe('DTSTART;VALUE=DATE:20261112\nRRULE:FREQ=DAILY;UNTIL=20261231');
		expect(
			toRRule(repeats('2026-11-12', { kind: 'daily', interval: 1 }, { kind: 'count', count: 10 }))
		).toBe('DTSTART;VALUE=DATE:20261112\nRRULE:FREQ=DAILY;COUNT=10');
	});

	test('is absent for a one-time request', () => {
		expect(toRRule(repeats('2026-11-12', { kind: 'none' }))).toBeUndefined();
		expect(parseRRule(undefined, '2026-11-12')).toEqual({
			startDate: '2026-11-12',
			repeat: { kind: 'none' },
			ends: never
		});
	});

	test('reads back into the same fields', () => {
		const schedules: Schedule[] = [
			repeats('2026-11-12', { kind: 'daily', interval: 1 }),
			repeats('2026-11-12', { kind: 'daily', interval: 9 }, { kind: 'count', count: 4 }),
			repeats('2026-11-12', { kind: 'weekly', interval: 1, weekdays: ['MO', 'TH'] }, never, 'SU'),
			repeats(
				'2026-11-12',
				// Read back in the week's order: Monday first here.
				{ kind: 'weekly', interval: 3, weekdays: ['SA', 'SU'] },
				{ kind: 'until', date: '2027-06-01' },
				'MO'
			),
			repeats('2026-01-31', { kind: 'monthly', interval: 1 }),
			repeats('2026-11-30', { kind: 'monthly', interval: 6 }, { kind: 'count', count: 12 }),
			repeats('2028-02-29', { kind: 'yearly', interval: 1 }),
			repeats('2026-11-12', { kind: 'yearly', interval: 2 }, { kind: 'until', date: '2040-01-01' })
		];
		for (const schedule of schedules) {
			const expected = { ...schedule };
			if (expected.repeat.kind === 'weekly') expected.weekStart ??= 'SU';
			else delete expected.weekStart;
			expect(parseRRule(toRRule(schedule), schedule.startDate)).toEqual(expected);
		}
	});

	test('reads the same rule written differently', () => {
		expect(
			parseRRule(
				'dtstart;value=date:20261112\r\nrrule:wkst=mo;byday=th,mo;freq=weekly;interval=2',
				'2000-01-01'
			)
		).toEqual(
			repeats('2026-11-12', { kind: 'weekly', interval: 2, weekdays: ['MO', 'TH'] }, never, 'MO')
		);
		// No BYDAY: the start date's weekday, as RFC 5545 says.
		expect(
			parseRRule('DTSTART;VALUE=DATE:20261112\nRRULE:FREQ=WEEKLY', '2026-11-12').repeat
		).toEqual({ kind: 'weekly', interval: 1, weekdays: ['TH'] });
		expect(() => parseRRule('RRULE:FREQ=HOURLY', '2026-11-12')).toThrow();
		expect(() => parseRRule('DTSTART;VALUE=DATE:20261112', '2026-11-12')).toThrow();
	});

	test('rejects schedules that make no sense', () => {
		const daily = { kind: 'daily', interval: 1 } as const;
		expect(validateSchedule(repeats('2026-02-30', daily))).toBe('Pick a start date');
		expect(validateSchedule(repeats('2026-11-12', { kind: 'daily', interval: 0 }))).toMatch(/1 to/);
		expect(validateSchedule(repeats('2026-11-12', { kind: 'daily', interval: 1.5 }))).toMatch(
			/1 to/
		);
		expect(
			validateSchedule(repeats('2026-11-12', { kind: 'weekly', interval: 1, weekdays: [] }))
		).toMatch(/at least one day/);
		expect(
			validateSchedule(repeats('2026-11-12', daily, { kind: 'until', date: '2026-11-11' }))
		).toMatch(/before the start/);
		expect(validateSchedule(repeats('2026-11-12', daily, { kind: 'count', count: 0 }))).toMatch(
			/1 to 1000/
		);
		expect(validateSchedule(repeats('2026-11-12', daily, { kind: 'count', count: 1001 }))).toMatch(
			/1 to 1000/
		);
		expect(
			validateSchedule(repeats('2026-11-12', daily, { kind: 'count', count: 1000 }))
		).toBeNull();
		expect(() => toRRule(repeats('2026-11-12', { kind: 'daily', interval: 0 }))).toThrow();
	});
});

describe('occurrences', () => {
	test('every 9 days, across months and years', () => {
		const schedule = repeats('2026-11-12', { kind: 'daily', interval: 9 });
		const dates = occurrences(stored(schedule), '2026-11-01', '2027-02-28');
		expect(dates.slice(0, 5)).toEqual([
			'2026-11-12',
			'2026-11-21',
			'2026-11-30',
			'2026-12-09',
			'2026-12-18'
		]);
		expect(dates).toEqual(reference(schedule, '2026-11-01', '2027-02-28'));
		for (const [a, b] of dates.slice(1).map((d, i) => [dates[i], d]))
			expect(daysBetween(a, b)).toBe(9);
	});

	test('every day and every other day', () => {
		const daily = repeats('2026-11-12', { kind: 'daily', interval: 1 });
		expect(occurrences(stored(daily), '2026-11-10', '2026-11-15')).toEqual([
			'2026-11-12',
			'2026-11-13',
			'2026-11-14',
			'2026-11-15'
		]);
		const other = repeats('2026-11-12', { kind: 'daily', interval: 2 });
		expect(occurrences(stored(other), '2026-11-12', '2026-11-20')).toEqual(
			reference(other, '2026-11-12', '2026-11-20')
		);
	});

	test('weekly on several days, starting on a day that isn’t one of them', () => {
		// 2026-11-11 is a Wednesday: the first is the Thursday after.
		const schedule = repeats('2026-11-11', { kind: 'weekly', interval: 1, weekdays: ['MO', 'TH'] });
		expect(firstOccurrences(schedule, 5)).toEqual([
			'2026-11-12',
			'2026-11-16',
			'2026-11-19',
			'2026-11-23',
			'2026-11-26'
		]);
		expect(occurrences(stored(schedule), '2026-11-01', '2027-03-01')).toEqual(
			reference(schedule, '2026-11-01', '2027-03-01')
		);
	});

	test('every other week counts weeks from the chosen first day', () => {
		const days: Weekday[] = ['SU', 'TU'];
		const sunday = repeats(
			'2026-03-01',
			{ kind: 'weekly', interval: 2, weekdays: days },
			never,
			'SU'
		);
		const monday = repeats(
			'2026-03-01',
			{ kind: 'weekly', interval: 2, weekdays: days },
			never,
			'MO'
		);
		expect(occurrences(stored(sunday), '2026-03-01', '2026-03-31')).toEqual([
			'2026-03-01',
			'2026-03-03',
			'2026-03-15',
			'2026-03-17',
			'2026-03-29',
			'2026-03-31'
		]);
		expect(occurrences(stored(monday), '2026-03-01', '2026-03-31')).toEqual([
			'2026-03-01',
			'2026-03-10',
			'2026-03-15',
			'2026-03-24',
			'2026-03-29'
		]);
		for (const schedule of [sunday, monday])
			expect(occurrences(stored(schedule), '2026-01-01', '2027-12-31')).toEqual(
				reference(schedule, '2026-01-01', '2027-12-31')
			);
	});

	test('monthly on the 31st falls on the last day of shorter months', () => {
		const schedule = repeats('2026-01-31', { kind: 'monthly', interval: 1 });
		expect(occurrences(stored(schedule), '2026-01-01', '2026-06-30')).toEqual([
			'2026-01-31',
			'2026-02-28',
			'2026-03-31',
			'2026-04-30',
			'2026-05-31',
			'2026-06-30'
		]);
		// A leap year's February has its 29th.
		expect(occurrences(stored(schedule), '2028-02-01', '2028-03-31')).toEqual([
			'2028-02-29',
			'2028-03-31'
		]);
		expect(occurrences(stored(schedule), '2026-01-01', '2030-12-31')).toEqual(
			reference(schedule, '2026-01-01', '2030-12-31')
		);
	});

	test('monthly on the 29th and 30th, and every few months', () => {
		for (const start of ['2026-01-29', '2026-01-30', '2026-03-31', '2026-05-15']) {
			for (const interval of [1, 2, 5]) {
				const schedule = repeats(start, { kind: 'monthly', interval });
				expect(occurrences(stored(schedule), '2026-01-01', '2031-12-31')).toEqual(
					reference(schedule, '2026-01-01', '2031-12-31')
				);
			}
		}
	});

	test('yearly, and Feb 29 in the years between leap years', () => {
		const leap = repeats('2024-02-29', { kind: 'yearly', interval: 1 });
		expect(occurrences(stored(leap), '2024-01-01', '2029-12-31')).toEqual([
			'2024-02-29',
			'2025-02-28',
			'2026-02-28',
			'2027-02-28',
			'2028-02-29',
			'2029-02-28'
		]);
		// 2100 isn't a leap year; 2400 is.
		expect(occurrences(stored(leap), '2100-01-01', '2100-12-31')).toEqual(['2100-02-28']);
		expect(occurrences(stored(leap), '2400-01-01', '2400-12-31')).toEqual(['2400-02-29']);
		const birthday = repeats('2026-11-12', { kind: 'yearly', interval: 3 });
		expect(occurrences(stored(birthday), '2026-01-01', '2040-12-31')).toEqual([
			'2026-11-12',
			'2029-11-12',
			'2032-11-12',
			'2035-11-12',
			'2038-11-12'
		]);
	});

	test('daily rules step over leap days like any other day', () => {
		const schedule = repeats('2028-02-20', { kind: 'daily', interval: 9 });
		expect(occurrences(stored(schedule), '2028-02-20', '2028-03-20')).toEqual([
			'2028-02-20',
			'2028-02-29',
			'2028-03-09',
			'2028-03-18'
		]);
		const every = repeats('2028-02-27', { kind: 'daily', interval: 1 });
		expect(occurrences(stored(every), '2028-02-27', '2028-03-01')).toEqual([
			'2028-02-27',
			'2028-02-28',
			'2028-02-29',
			'2028-03-01'
		]);
	});

	test('ends on a date, inclusive', () => {
		const schedule = repeats(
			'2026-11-12',
			{ kind: 'daily', interval: 9 },
			{ kind: 'until', date: '2026-12-09' }
		);
		expect(occurrences(stored(schedule), '2026-01-01', '2027-12-31')).toEqual([
			'2026-11-12',
			'2026-11-21',
			'2026-11-30',
			'2026-12-09'
		]);
		expect(lastPossibleDate(stored(schedule))).toBe('2026-12-09');
	});

	test('ends after a number of times', () => {
		const schedule = repeats(
			'2026-11-11',
			{ kind: 'weekly', interval: 1, weekdays: ['MO', 'TH'] },
			{ kind: 'count', count: 5 }
		);
		const all = occurrences(stored(schedule), '2026-01-01', '2027-12-31');
		expect(all).toEqual(['2026-11-12', '2026-11-16', '2026-11-19', '2026-11-23', '2026-11-26']);
		expect(all).toEqual(reference(schedule, '2026-01-01', '2027-12-31'));
		// Counted from the start, not from the range.
		expect(occurrences(stored(schedule), '2026-11-20', '2027-12-31')).toEqual([
			'2026-11-23',
			'2026-11-26'
		]);
		expect(lastPossibleDate(stored(schedule))).toBe('2026-11-26');
		expect(nextOccurrence(stored(schedule), '2026-11-27')).toBeNull();
		// The longest allowed.
		const long = repeats(
			'2026-01-01',
			{ kind: 'daily', interval: 1 },
			{ kind: 'count', count: 1000 }
		);
		expect(lastPossibleDate(stored(long))).toBe(addDays('2026-01-01', 999));
		expect(occurrences(stored(long), '2028-09-20', '2028-10-01')).toEqual(
			reference(long, '2028-09-20', '2028-10-01')
		);
	});

	test('a one-time request happens on its start date only', () => {
		const once: Occurring = { startDate: '2026-11-12' };
		expect(occurrences(once, '2026-11-01', '2026-11-30')).toEqual(['2026-11-12']);
		expect(occurrences(once, '2026-11-13', '2026-11-30')).toEqual([]);
		expect(occursOn(once, '2026-11-12')).toBe(true);
		expect(nextOccurrence(once, '2026-11-12')).toBe('2026-11-12');
		expect(nextOccurrence(once, '2026-11-13')).toBeNull();
		expect(lastPossibleDate(once)).toBe('2026-11-12');
		expect(firstOccurrences(repeats('2026-11-12', { kind: 'none' }), 5)).toEqual(['2026-11-12']);
	});

	test('is empty before the start and for an empty range', () => {
		const request = stored(repeats('2026-11-12', { kind: 'daily', interval: 1 }));
		expect(occurrences(request, '2026-01-01', '2026-11-11')).toEqual([]);
		expect(occurrences(request, '2026-12-02', '2026-12-01')).toEqual([]);
		expect(lastPossibleDate(request)).toBe(OPEN_END);
	});
});

describe('skips', () => {
	const schedule = repeats('2026-11-12', { kind: 'daily', interval: 9 });
	const request = stored(schedule, { skipDates: ['2026-11-21', '2026-12-09'] });

	test('leave the day out, or flag it with includeSkipped', () => {
		expect(occurrences(request, '2026-11-01', '2026-12-31')).toEqual([
			'2026-11-12',
			'2026-11-30',
			'2026-12-18',
			'2026-12-27'
		]);
		expect(occurrences(request, '2026-11-01', '2026-12-31', { includeSkipped: true })).toEqual(
			reference(schedule, '2026-11-01', '2026-12-31')
		);
		expect(occursOn(request, '2026-11-21')).toBe(false);
		expect(occursOn(request, '2026-11-21', { includeSkipped: true })).toBe(true);
	});

	test('are passed over by the next dates', () => {
		expect(nextOccurrence(request, '2026-11-13')).toBe('2026-11-30');
		expect(nextOccurrences(request, '2026-11-13', 3)).toEqual([
			'2026-11-30',
			'2026-12-18',
			'2026-12-27'
		]);
	});

	test('still use up "after N times", as EXDATE does', () => {
		const counted = stored(
			repeats('2026-11-12', { kind: 'daily', interval: 1 }, { kind: 'count', count: 5 }),
			{
				skipDates: ['2026-11-13', '2026-11-14']
			}
		);
		expect(occurrences(counted, '2026-11-01', '2026-12-31')).toEqual([
			'2026-11-12',
			'2026-11-15',
			'2026-11-16'
		]);
		expect(nextOccurrences(counted, '2026-11-12', 10)).toEqual([
			'2026-11-12',
			'2026-11-15',
			'2026-11-16'
		]);
	});
});

describe('answered', () => {
	const request = stored(repeats('2026-11-12', { kind: 'daily', interval: 1 }), {
		answeredOn: '2026-11-15'
	});

	test('stops after the day it was answered', () => {
		expect(occurrences(request, '2026-11-01', '2026-11-30')).toEqual([
			'2026-11-12',
			'2026-11-13',
			'2026-11-14',
			'2026-11-15'
		]);
		expect(nextOccurrence(request, '2026-11-15')).toBe('2026-11-15');
		expect(nextOccurrence(request, '2026-11-16')).toBeNull();
		expect(nextOccurrences(request, '2026-11-14', 10)).toEqual(['2026-11-14', '2026-11-15']);
		expect(lastPossibleDate(request)).toBe('2026-11-15');
	});

	test('a one-time request answered before its day never happens', () => {
		const once: Occurring = { startDate: '2026-11-20', answeredOn: '2026-11-15' };
		expect(occurrences(once, '2026-11-01', '2026-11-30')).toEqual([]);
		expect(nextOccurrence(once, '2026-11-01')).toBeNull();
		expect(lastPossibleDate(once)).toBe('2026-11-15');
	});
});

describe('far from the start', () => {
	test('far in the future, quickly', () => {
		const schedule = repeats('2000-01-01', { kind: 'daily', interval: 9 });
		const started = performance.now();
		const dates = occurrences(stored(schedule), '2400-02-01', '2400-03-31');
		expect(performance.now() - started).toBeLessThan(100);
		expect(dates.length).toBeGreaterThan(5);
		for (const date of dates) expect(daysBetween('2000-01-01', date) % 9).toBe(0);
		expect(nextOccurrence(stored(schedule), '2400-02-01')).toBe(dates[0]);
	});

	test('started long ago, asked about now', () => {
		const schedules = [
			repeats('1950-06-15', { kind: 'yearly', interval: 1 }),
			repeats('1950-01-31', { kind: 'monthly', interval: 1 }),
			repeats('1950-01-04', { kind: 'weekly', interval: 2, weekdays: ['WE', 'SA'] }),
			repeats('1950-01-01', { kind: 'daily', interval: 7 })
		];
		for (const schedule of schedules)
			expect(occurrences(stored(schedule), '2026-01-01', '2026-12-31')).toEqual(
				reference(schedule, '2026-01-01', '2026-12-31')
			);
	});

	test('a range far in the past, before it started', () => {
		const schedule = repeats('2026-11-12', { kind: 'daily', interval: 1 });
		expect(occurrences(stored(schedule), '1900-01-01', '1900-12-31')).toEqual([]);
		expect(occurrences(stored(schedule), '1900-01-01', '2026-11-13')).toEqual([
			'2026-11-12',
			'2026-11-13'
		]);
	});
});

describe('daylight saving time', () => {
	const original = process.env.TZ;
	afterEach(() => {
		process.env.TZ = original;
	});

	// Days around 2026's changes: US Mar 8 / Nov 1, Europe Mar 29 / Oct 25, NZ Apr 5 / Sep 27, Lord Howe's
	// half-hour shift, and the zones furthest either side of UTC.
	const zones = [
		'UTC',
		'America/New_York',
		'America/Los_Angeles',
		'Europe/London',
		'Europe/Berlin',
		'Pacific/Auckland',
		'Australia/Lord_Howe',
		'Pacific/Kiritimati',
		'Pacific/Pago_Pago'
	];
	const schedules = [
		repeats('2026-03-06', { kind: 'daily', interval: 1 }),
		repeats('2026-02-26', { kind: 'daily', interval: 9 }),
		repeats('2026-03-01', { kind: 'weekly', interval: 1, weekdays: ['SU', 'MO'] }),
		repeats('2026-01-31', { kind: 'monthly', interval: 1 }),
		repeats('2026-03-29', { kind: 'yearly', interval: 1 })
	];
	const ranges: [YMD, YMD][] = [
		['2026-03-01', '2026-04-10'],
		['2026-09-20', '2026-11-05'],
		['2027-03-10', '2027-03-31']
	];

	function everything() {
		return schedules.map((schedule) => ({
			rule: toRRule(schedule),
			ranges: ranges.map(([from, to]) => occurrences(stored(schedule), from, to)),
			next: nextOccurrences(stored(schedule), '2026-03-07', 10),
			last: lastPossibleDate(stored(schedule)),
			text: describeSchedule(schedule)
		}));
	}

	test('changes nothing: every zone gives the same days', () => {
		process.env.TZ = 'UTC';
		const expected = everything();
		// What a UTC machine gives is what the slow reference gives.
		expect(expected[0].ranges[0]).toEqual(reference(schedules[0], ...ranges[0]));
		const offsets = new Set<number>();
		for (const zone of zones) {
			process.env.TZ = zone;
			// The zone really changed (the timezone is read again when TZ changes).
			offsets.add(new Date('2026-07-01T00:00:00Z').getTimezoneOffset());
			expect(everything(), zone).toEqual(expected);
		}
		expect(offsets.size).toBeGreaterThan(5);
	});

	test('no day is lost or doubled where the clocks change', () => {
		process.env.TZ = 'America/New_York';
		const daily = stored(repeats('2026-03-01', { kind: 'daily', interval: 1 }));
		const march = occurrences(daily, '2026-03-01', '2026-03-31');
		expect(march).toHaveLength(31);
		expect(new Set(march).size).toBe(31);
		const autumn = occurrences(daily, '2026-10-30', '2026-11-03');
		expect(autumn).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03']);
	});
});

describe('words', () => {
	const today = '2026-11-12';
	test.each([
		[repeats('2026-11-12', { kind: 'none' }), 'Once · Nov 12'],
		[repeats('2027-01-05', { kind: 'none' }), 'Once · Jan 5, 2027'],
		[repeats('2026-11-12', { kind: 'daily', interval: 1 }), 'Every day'],
		[repeats('2026-11-12', { kind: 'daily', interval: 2 }), 'Every other day'],
		[repeats('2026-11-12', { kind: 'daily', interval: 9 }), 'Every 9 days'],
		[
			repeats('2026-11-12', { kind: 'weekly', interval: 1, weekdays: ['TH', 'MO'] }),
			'Weekly on Mon, Thu'
		],
		[
			repeats('2026-11-12', { kind: 'weekly', interval: 2, weekdays: ['SU'] }),
			'Every other week on Sun'
		],
		[
			repeats('2026-11-12', { kind: 'weekly', interval: 3, weekdays: ['SA', 'SU'] }, never, 'MO'),
			'Every 3 weeks on Sat, Sun'
		],
		[
			repeats('2026-11-12', {
				kind: 'weekly',
				interval: 1,
				weekdays: ['MO', 'TU', 'WE', 'TH', 'FR']
			}),
			'Weekly on weekdays'
		],
		[repeats('2026-11-12', { kind: 'weekly', interval: 1, weekdays: [...WEEKDAYS] }), 'Every day'],
		[repeats('2026-11-12', { kind: 'monthly', interval: 1 }), 'Monthly on the 12th'],
		[repeats('2026-11-01', { kind: 'monthly', interval: 2 }), 'Every other month on the 1st'],
		[repeats('2026-01-31', { kind: 'monthly', interval: 1 }), 'Monthly on the 31st (or last day)'],
		[repeats('2026-11-22', { kind: 'monthly', interval: 4 }), 'Every 4 months on the 22nd'],
		[repeats('2026-11-12', { kind: 'yearly', interval: 1 }), 'Yearly on Nov 12'],
		[
			repeats('2028-02-29', { kind: 'yearly', interval: 1 }),
			'Yearly on Feb 29 (Feb 28 in other years)'
		],
		[
			repeats('2026-11-12', { kind: 'daily', interval: 1 }, { kind: 'until', date: '2026-12-31' }),
			'Every day · until Dec 31'
		],
		[
			repeats('2026-11-12', { kind: 'daily', interval: 1 }, { kind: 'until', date: '2027-12-31' }),
			'Every day · until Dec 31, 2027'
		],
		[
			repeats('2026-11-12', { kind: 'daily', interval: 3 }, { kind: 'count', count: 10 }),
			'Every 3 days · 10 times'
		]
	])('%j is "%s"', (schedule, text) => {
		expect(describeSchedule(schedule, today)).toBe(text);
	});

	test('without today, dates carry their year', () => {
		expect(describeSchedule(repeats('2026-11-12', { kind: 'none' }))).toBe('Once · Nov 12, 2026');
	});
});

test('isDate accepts only real calendar days', () => {
	expect(isDate('2028-02-29')).toBe(true);
	expect(isDate('2026-02-29')).toBe(false);
	expect(isDate('2026-13-01')).toBe(false);
	expect(isDate('2026-1-01')).toBe(false);
	expect(isDate(20261112)).toBe(false);
});

describe('the last day it happens', () => {
	test('is the last occurrence, not the UNTIL date', () => {
		// Mondays until Wed Nov 11: the last Monday is Nov 9.
		const mondays = stored(
			repeats(
				'2026-10-05',
				{ kind: 'weekly', interval: 1, weekdays: ['MO'] },
				{ kind: 'until', date: '2026-11-11' }
			)
		);
		expect(lastPossibleDate(mondays)).toBe('2026-11-11');
		expect(lastOccurrence(mondays)).toBe('2026-11-09');
		// The 15th until Dec 31: Dec 15.
		const monthly = stored(
			repeats('2026-01-15', { kind: 'monthly', interval: 1 }, { kind: 'until', date: '2026-12-31' })
		);
		expect(lastOccurrence(monthly)).toBe('2026-12-15');
	});

	test('passes over skipped days', () => {
		const daily = repeats(
			'2026-11-01',
			{ kind: 'daily', interval: 1 },
			{ kind: 'until', date: '2026-11-14' }
		);
		const skipped = stored(daily, { skipDates: ['2026-11-12', '2026-11-13', '2026-11-14'] });
		expect(lastOccurrence(skipped)).toBe('2026-11-11');
		expect(nextOccurrence(skipped, '2026-11-12')).toBeNull();
		// Every day skipped: it never happens.
		const all = Array.from({ length: 14 }, (_, i) => addDays('2026-11-01', i));
		expect(lastOccurrence(stored(daily, { skipDates: all }))).toBeNull();
	});

	test('honors COUNT, skips and the answer', () => {
		const counted = repeats(
			'2026-11-11',
			{ kind: 'weekly', interval: 1, weekdays: ['MO', 'TH'] },
			{ kind: 'count', count: 5 }
		);
		expect(lastOccurrence(stored(counted))).toBe('2026-11-26');
		expect(lastOccurrence(stored(counted, { skipDates: ['2026-11-26'] }))).toBe('2026-11-23');
		expect(lastOccurrence(stored(counted, { answeredOn: '2026-11-22' }))).toBe('2026-11-19');
	});

	test('is null when open-ended, and the day itself for a one-time request', () => {
		expect(
			lastOccurrence(stored(repeats('2026-11-12', { kind: 'daily', interval: 9 })))
		).toBeNull();
		expect(
			lastOccurrence(
				stored(repeats('2026-11-12', { kind: 'daily', interval: 9 }), { answeredOn: '2026-11-25' })
			)
		).toBe('2026-11-21');
		expect(lastOccurrence({ startDate: '2026-11-12' })).toBe('2026-11-12');
		expect(lastOccurrence({ startDate: '2026-11-20', answeredOn: '2026-11-15' })).toBeNull();
	});

	test('works far from the start', () => {
		const every9 = stored(
			repeats('1901-03-04', { kind: 'daily', interval: 9 }, { kind: 'until', date: '2399-12-31' })
		);
		const last = lastOccurrence(every9)!;
		expect(daysBetween('1901-03-04', last) % 9).toBe(0);
		expect(daysBetween(last, '2399-12-31')).toBeLessThan(9);
	});
});

describe('the year 9999', () => {
	test('a COUNT rule ending after it is turned down', () => {
		const cases: Schedule[] = [
			repeats('2026-11-12', { kind: 'yearly', interval: 999 }, { kind: 'count', count: 10 }),
			repeats('2026-11-12', { kind: 'yearly', interval: 10 }, { kind: 'count', count: 1000 }),
			repeats(
				'2026-11-12',
				{ kind: 'weekly', interval: 999, weekdays: ['TH'] },
				{ kind: 'count', count: 1000 }
			),
			repeats('2026-11-12', { kind: 'monthly', interval: 999 }, { kind: 'count', count: 1000 }),
			repeats('2026-11-12', { kind: 'yearly', interval: 999 }, { kind: 'count', count: 1000 })
		];
		for (const schedule of cases) {
			expect(validateSchedule(schedule)).toMatch(/past the year 9999/);
			expect(() => toRRule(schedule)).toThrow(/past the year 9999/);
		}
	});

	test('one ending in it is fine', () => {
		const schedule = repeats(
			'2026-11-12',
			{ kind: 'yearly', interval: 999 },
			{ kind: 'count', count: 8 }
		);
		expect(validateSchedule(schedule)).toBeNull();
		expect(lastPossibleDate(stored(schedule))).toBe('9019-11-12');
	});

	test('a rule stored before that check counts as open-ended, so ranges still find it', () => {
		const request: Occurring = {
			startDate: '2026-11-12',
			rrule:
				'DTSTART;VALUE=DATE:20261112\nRRULE:FREQ=YEARLY;INTERVAL=999;BYMONTH=11;BYMONTHDAY=12;COUNT=10'
		};
		expect(lastPossibleDate(request)).toBe(OPEN_END);
		expect(isDate(lastPossibleDate(request))).toBe(true);
		expect(occurrences(request, '2026-11-01', '2026-11-30')).toEqual(['2026-11-12']);
	});
});
