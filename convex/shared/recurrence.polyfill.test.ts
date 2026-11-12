// Convex's V8 runtime and most browsers have no Temporal, so rrule-temporal falls back to the polyfill it bundles.
// This file takes Node's Temporal away before loading anything (vitest runs each file in its own module graph)
// and checks the shared module gives the same days.
import { expect, test } from 'vitest';

test('works without a global Temporal', async () => {
	const builtIn = (globalThis as { Temporal?: { ZonedDateTime: unknown } }).Temporal;
	delete (globalThis as { Temporal?: unknown }).Temporal;
	try {
		const { RRuleTemporal } = await import('rrule-temporal');
		const {
			lastOccurrence,
			lastPossibleDate,
			occurrences,
			nextOccurrences,
			toRRule,
			validateSchedule
		} = await import('./recurrence');
		expect('Temporal' in globalThis).toBe(false);

		const rrule = toRRule({
			startDate: '2026-01-31',
			repeat: { kind: 'monthly', interval: 1 },
			ends: { kind: 'never' }
		})!;
		// Occurrences come from the bundled polyfill, not Node's Temporal.
		const [first] = new RRuleTemporal({ rruleString: rrule }).all((_, i) => i < 1);
		if (builtIn)
			expect(first instanceof (builtIn.ZonedDateTime as abstract new () => unknown)).toBe(false);
		expect(occurrences({ startDate: '2026-01-31', rrule }, '2026-01-01', '2026-04-30')).toEqual([
			'2026-01-31',
			'2026-02-28',
			'2026-03-31',
			'2026-04-30'
		]);
		expect(nextOccurrences({ startDate: '2026-01-31', rrule }, '2400-02-01', 2)).toEqual([
			'2400-02-29',
			'2400-03-31'
		]);
		// Past the year 9999 the polyfill behaves too: turned down, or open-ended when already stored.
		expect(
			validateSchedule({
				startDate: '2026-11-12',
				repeat: { kind: 'yearly', interval: 999 },
				ends: { kind: 'count', count: 1000 }
			})
		).toMatch(/past the year 9999/);
		expect(
			lastPossibleDate({
				startDate: '2026-11-12',
				rrule:
					'DTSTART;VALUE=DATE:20261112\nRRULE:FREQ=YEARLY;INTERVAL=999;BYMONTH=11;BYMONTHDAY=12;COUNT=10'
			})
		).toBe('9999-12-31');
		expect(
			lastOccurrence({
				startDate: '2026-10-05',
				rrule: 'DTSTART;VALUE=DATE:20261005\nRRULE:FREQ=WEEKLY;BYDAY=MO;WKST=SU;UNTIL=20261111'
			})
		).toBe('2026-11-09');
	} finally {
		if (builtIn) (globalThis as { Temporal?: unknown }).Temporal = builtIn;
	}
});
