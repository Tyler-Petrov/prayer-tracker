/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';
import { addDays, type Schedule } from './shared/recurrence';

const modules = import.meta.glob('./**/*.ts');

async function signedIn(t: ReturnType<typeof convexTest>, name: string) {
	const as = t.withIdentity({ subject: name, email: `${name}@example.com` });
	await as.mutation(api.users.ensure, {});
	return as;
}

const every9: Schedule = {
	startDate: '2026-11-01',
	repeat: { kind: 'daily', interval: 9 },
	ends: { kind: 'never' }
};
const once = (startDate: string): Schedule => ({
	startDate,
	repeat: { kind: 'none' },
	ends: { kind: 'never' }
});

const itemsOn = (days: { date: string; items: { title: string }[] }[], date: string) =>
	days.find((d) => d.date === date)?.items.map((i) => i.title) ?? [];

describe('requests', () => {
	test('need a signed-in user', async () => {
		const t = convexTest(schema, modules);
		await expect(t.query(api.requests.list, { today: '2026-11-12' })).rejects.toThrow(
			/Not signed in/
		);
		await expect(
			t.withIdentity({ subject: 'nobody' }).query(api.requests.list, { today: '2026-11-12' })
		).rejects.toThrow(/Not signed in/);
	});

	test("are each person's own", async () => {
		const t = convexTest(schema, modules);
		const ann = await signedIn(t, 'ann');
		const bob = await signedIn(t, 'bob');
		const requestId = await ann.mutation(api.requests.create, { title: 'Ann’s', schedule: every9 });

		expect(await bob.query(api.requests.list, { today: '2026-11-12' })).toEqual({
			rows: [],
			olderHidden: false
		});
		expect(await bob.query(api.requests.get, { requestId, today: '2026-11-12' })).toBeNull();
		expect(await bob.query(api.days.range, { from: '2026-11-01', to: '2026-11-30' })).toEqual([]);
		const date = '2026-11-10';
		for (const attempt of [
			() => bob.mutation(api.prayers.set, { requestId, date, prayed: true }),
			() => bob.mutation(api.requests.skip, { requestId, date, skipped: true }),
			() => bob.mutation(api.requests.answer, { requestId, answeredOn: date }),
			() => bob.mutation(api.requests.unanswer, { requestId }),
			() => bob.mutation(api.requests.update, { requestId, title: 'Mine', schedule: every9 }),
			() => bob.mutation(api.requests.remove, { requestId })
		])
			await expect(attempt()).rejects.toThrow(/Not found/);
		expect(await ann.query(api.requests.get, { requestId, today: '2026-11-12' })).toMatchObject({
			title: 'Ann’s',
			prayedCount: 0
		});
	});

	test('check their fields', async () => {
		const t = convexTest(schema, modules);
		const ann = await signedIn(t, 'ann');
		await expect(
			ann.mutation(api.requests.create, { title: '  ', schedule: every9 })
		).rejects.toThrow(/title/);
		await expect(
			ann.mutation(api.requests.create, {
				title: 'x',
				schedule: { ...every9, repeat: { kind: 'weekly', interval: 1, weekdays: [] } }
			})
		).rejects.toThrow(/day of the week/);
		await expect(
			ann.mutation(api.requests.create, { title: 'x', schedule: once('2026-02-30') })
		).rejects.toThrow(/start date/);
		await expect(ann.query(api.requests.list, { today: 'today' })).rejects.toThrow(/Bad date/);
	});

	test('are listed in sections with their next date and summary', async () => {
		const t = convexTest(schema, modules);
		const ann = await signedIn(t, 'ann');
		await ann.mutation(api.requests.create, { title: 'Every 9', schedule: every9 });
		await ann.mutation(api.requests.create, { title: 'Upcoming', schedule: once('2026-11-20') });
		await ann.mutation(api.requests.create, { title: 'Gone by', schedule: once('2026-11-01') });
		const answered = await ann.mutation(api.requests.create, {
			title: 'Answered',
			schedule: {
				startDate: '2026-11-01',
				repeat: { kind: 'weekly', interval: 1, weekdays: ['MO', 'TH'] },
				ends: { kind: 'never' }
			}
		});
		await ann.mutation(api.requests.answer, {
			requestId: answered,
			answeredOn: '2026-11-05',
			answerNote: '  A job offer  '
		});

		const { rows } = await ann.query(api.requests.list, { today: '2026-11-12' });
		expect(
			rows.map(({ title, section, nextDate, summary }) => ({ title, section, nextDate, summary }))
		).toEqual([
			{ title: 'Every 9', section: 'active', nextDate: '2026-11-19', summary: 'Every 9 days' },
			{ title: 'Upcoming', section: 'active', nextDate: '2026-11-20', summary: 'Once · Nov 20' },
			{ title: 'Gone by', section: 'past', nextDate: null, summary: 'Once · Nov 1' },
			{ title: 'Answered', section: 'answered', nextDate: null, summary: 'Weekly on Mon, Thu' }
		]);
		expect(rows[3]).toMatchObject({ answeredOn: '2026-11-05', answerNote: 'A job offer' });

		await ann.mutation(api.requests.unanswer, { requestId: answered });
		const back = await ann.query(api.requests.get, { requestId: answered, today: '2026-11-12' });
		expect(back).toMatchObject({
			section: 'active',
			answeredOn: null,
			answerNote: null,
			upcoming: ['2026-11-12', '2026-11-16', '2026-11-19', '2026-11-23', '2026-11-26']
		});
	});
});

describe('days.range', () => {
	test('expands each request over the days, with prayed and skipped marks', async () => {
		const t = convexTest(schema, modules);
		const ann = await signedIn(t, 'ann');
		const nine = await ann.mutation(api.requests.create, { title: 'Every 9', schedule: every9 });
		await ann.mutation(api.requests.create, { title: 'Once', schedule: once('2026-11-10') });
		await ann.mutation(api.prayers.set, { requestId: nine, date: '2026-11-10', prayed: true });
		await ann.mutation(api.requests.skip, { requestId: nine, date: '2026-11-19', skipped: true });

		const days = await ann.query(api.days.range, { from: '2026-11-01', to: '2026-11-30' });
		expect(days.map((d) => d.date)).toEqual([
			'2026-11-01',
			'2026-11-10',
			'2026-11-19',
			'2026-11-28'
		]);
		expect(itemsOn(days, '2026-11-10')).toEqual(['Every 9', 'Once']);
		expect(days[1].items[0]).toMatchObject({ prayed: true, scheduled: true, skipped: false });
		expect(days[1].items[1]).toMatchObject({ prayed: false, recurring: false });
		expect(days[2].items[0]).toMatchObject({ skipped: true, prayed: false });

		// Narrow ranges see the same.
		expect(await ann.query(api.days.range, { from: '2026-11-10', to: '2026-11-10' })).toEqual([
			days[1]
		]);
	});

	test('shows a mark on a day the schedule no longer has', async () => {
		const t = convexTest(schema, modules);
		const ann = await signedIn(t, 'ann');
		const requestId = await ann.mutation(api.requests.create, {
			title: 'Moved',
			schedule: once('2026-11-10')
		});
		await ann.mutation(api.prayers.set, { requestId, date: '2026-11-10', prayed: true });
		await ann.mutation(api.requests.update, {
			requestId,
			title: 'Moved',
			schedule: once('2026-11-12')
		});
		const days = await ann.query(api.days.range, { from: '2026-11-01', to: '2026-11-30' });
		expect(days).toEqual([
			{ date: '2026-11-10', items: [expect.objectContaining({ prayed: true, scheduled: false })] },
			{ date: '2026-11-12', items: [expect.objectContaining({ prayed: false, scheduled: true })] }
		]);
	});

	test('stops after the answer', async () => {
		const t = convexTest(schema, modules);
		const ann = await signedIn(t, 'ann');
		const requestId = await ann.mutation(api.requests.create, {
			title: 'Daily',
			schedule: {
				startDate: '2026-11-01',
				repeat: { kind: 'daily', interval: 1 },
				ends: { kind: 'never' }
			}
		});
		await ann.mutation(api.requests.answer, { requestId, answeredOn: '2026-11-03' });
		const days = await ann.query(api.days.range, { from: '2026-11-01', to: '2026-11-30' });
		expect(days.map((d) => d.date)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
		expect(days[0].items[0].answeredOn).toBe('2026-11-03');
		// Nothing later even reads it.
		expect(await ann.query(api.days.range, { from: '2026-11-04', to: '2026-12-30' })).toEqual([]);
		await expect(
			ann.mutation(api.requests.answer, { requestId, answeredOn: '2026-10-01' })
		).rejects.toThrow(/before it starts/);
	});

	test('is bounded', async () => {
		const t = convexTest(schema, modules);
		const ann = await signedIn(t, 'ann');
		await expect(
			ann.query(api.days.range, { from: '2026-01-01', to: '2027-01-02' })
		).rejects.toThrow(/at most 120/);
		await expect(
			ann.query(api.days.range, { from: '2026-01-02', to: '2026-01-01' })
		).rejects.toThrow(/ends before/);
		expect(await ann.query(api.days.range, { from: '2026-01-01', to: '2026-04-30' })).toEqual([]);
		await expect(
			ann.query(api.days.range, { from: '2026-01-01', to: '2026-05-01' })
		).rejects.toThrow(/at most 120/);
	});
});

describe('prayed marks', () => {
	test('set (not toggle), keeping the count and the latest', async () => {
		const t = convexTest(schema, modules);
		const ann = await signedIn(t, 'ann');
		const requestId = await ann.mutation(api.requests.create, {
			title: 'Every 9',
			schedule: every9
		});
		const set = (date: string, prayed: boolean) =>
			ann.mutation(api.prayers.set, { requestId, date, prayed });
		const get = () => ann.query(api.requests.get, { requestId, today: '2026-11-12' });

		await set('2026-11-01', true);
		await set('2026-11-10', true);
		await set('2026-11-10', true);
		expect(await get()).toMatchObject({
			prayedCount: 2,
			lastPrayedOn: '2026-11-10',
			prayedDates: ['2026-11-10', '2026-11-01']
		});
		await set('2026-11-10', false);
		expect(await get()).toMatchObject({ prayedCount: 1, lastPrayedOn: '2026-11-01' });
		await set('2026-11-01', false);
		await set('2026-11-01', false);
		expect(await get()).toMatchObject({ prayedCount: 0, lastPrayedOn: null, prayedDates: [] });
	});

	test('go when the day is skipped, and the day comes back unmarked', async () => {
		const t = convexTest(schema, modules);
		const ann = await signedIn(t, 'ann');
		const requestId = await ann.mutation(api.requests.create, {
			title: 'Every 9',
			schedule: every9
		});
		await ann.mutation(api.prayers.set, { requestId, date: '2026-11-10', prayed: true });
		await ann.mutation(api.requests.skip, { requestId, date: '2026-11-10', skipped: true });
		let request = await ann.query(api.requests.get, { requestId, today: '2026-11-01' });
		expect(request).toMatchObject({ prayedCount: 0, skipDates: ['2026-11-10'] });
		expect(request!.upcoming).toEqual([
			'2026-11-01',
			'2026-11-19',
			'2026-11-28',
			'2026-12-07',
			'2026-12-16'
		]);

		await ann.mutation(api.requests.skip, { requestId, date: '2026-11-10', skipped: false });
		request = await ann.query(api.requests.get, { requestId, today: '2026-11-01' });
		expect(request).toMatchObject({ skipDates: [], prayedCount: 0 });

		await expect(
			ann.mutation(api.requests.skip, { requestId, date: '2026-11-11', skipped: true })
		).rejects.toThrow(/isn't scheduled/);
		const one = await ann.mutation(api.requests.create, {
			title: 'Once',
			schedule: once('2026-11-10')
		});
		await expect(
			ann.mutation(api.requests.skip, { requestId: one, date: '2026-11-10', skipped: true })
		).rejects.toThrow(/one-time/);
	});

	test('are deleted with their request', async () => {
		const t = convexTest(schema, modules);
		const ann = await signedIn(t, 'ann');
		const requestId = await ann.mutation(api.requests.create, {
			title: 'Daily',
			schedule: {
				startDate: '2026-01-01',
				repeat: { kind: 'daily', interval: 1 },
				ends: { kind: 'never' }
			}
		});
		for (let day = 1; day <= 20; day++)
			await ann.mutation(api.prayers.set, {
				requestId,
				date: `2026-01-${String(day).padStart(2, '0')}`,
				prayed: true
			});
		await ann.mutation(api.requests.remove, { requestId });
		expect(await ann.query(api.requests.get, { requestId, today: '2026-01-01' })).toBeNull();
		const left = await t.run((ctx) =>
			ctx.db
				.query('prayers')
				.withIndex('by_requestId_and_date', (q) => q.eq('requestId', requestId as Id<'requests'>))
				.collect()
		);
		expect(left).toEqual([]);
	});
});

describe('editing', () => {
	test('keeps the skips the new schedule still has', async () => {
		const t = convexTest(schema, modules);
		const ann = await signedIn(t, 'ann');
		const requestId = await ann.mutation(api.requests.create, {
			title: 'Daily',
			schedule: {
				startDate: '2026-11-01',
				repeat: { kind: 'daily', interval: 1 },
				ends: { kind: 'never' }
			}
		});
		await ann.mutation(api.requests.skip, { requestId, date: '2026-11-03', skipped: true });
		await ann.mutation(api.requests.skip, { requestId, date: '2026-11-05', skipped: true });
		await ann.mutation(api.requests.update, {
			requestId,
			title: ' Every other day ',
			notes: 'For the family',
			schedule: {
				startDate: '2026-11-01',
				repeat: { kind: 'daily', interval: 2 },
				ends: { kind: 'count', count: 10 }
			}
		});
		const request = await ann.query(api.requests.get, { requestId, today: '2026-11-01' });
		expect(request).toMatchObject({
			title: 'Every other day',
			notes: 'For the family',
			skipDates: ['2026-11-03', '2026-11-05'],
			summary: 'Every other day · 10 times',
			endDate: '2026-11-19',
			rrule: 'DTSTART;VALUE=DATE:20261101\nRRULE:FREQ=DAILY;INTERVAL=2;COUNT=10'
		});
		await ann.mutation(api.requests.update, {
			requestId,
			title: 'Every 4',
			schedule: {
				startDate: '2026-11-01',
				repeat: { kind: 'daily', interval: 4 },
				ends: { kind: 'never' }
			}
		});
		expect(await ann.query(api.requests.get, { requestId, today: '2026-11-01' })).toMatchObject({
			skipDates: ['2026-11-05'],
			notes: null,
			endDate: null
		});
	});

	test('weekly rules count weeks from the person’s first day', async () => {
		const t = convexTest(schema, modules);
		const ann = await signedIn(t, 'ann');
		expect(await ann.query(api.users.me, {})).toEqual({
			email: 'ann@example.com',
			weekStart: 'SU'
		});
		await ann.mutation(api.users.setWeekStart, { weekStart: 'MO' });
		const requestId = await ann.mutation(api.requests.create, {
			title: 'Biweekly',
			schedule: {
				startDate: '2026-03-01',
				repeat: { kind: 'weekly', interval: 2, weekdays: ['SU', 'TU'] },
				ends: { kind: 'never' }
			}
		});
		const request = await ann.query(api.requests.get, { requestId, today: '2026-03-01' });
		expect(request!.rrule).toContain('WKST=MO');
		expect(request!.upcoming).toEqual([
			'2026-03-01',
			'2026-03-10',
			'2026-03-15',
			'2026-03-24',
			'2026-03-29'
		]);
	});
});

describe('edge cases', () => {
	test('an answered request can’t move its start after the answer', async () => {
		const t = convexTest(schema, modules);
		const ann = await signedIn(t, 'ann');
		const requestId = await ann.mutation(api.requests.create, {
			title: 'Once',
			schedule: once('2026-11-12')
		});
		await ann.mutation(api.requests.answer, { requestId, answeredOn: '2026-11-12' });
		await expect(
			ann.mutation(api.requests.update, {
				requestId,
				title: 'Once',
				schedule: once('2026-12-01')
			})
		).rejects.toThrow(/answered on Nov 12/);
		// Up to the answer day is fine.
		await ann.mutation(api.requests.update, {
			requestId,
			title: 'Once',
			schedule: once('2026-11-10')
		});
		expect(
			itemsOn(
				await ann.query(api.days.range, { from: '2026-11-01', to: '2026-11-30' }),
				'2026-11-10'
			)
		).toEqual(['Once']);
		// Not answered any more, it can move anywhere.
		await ann.mutation(api.requests.unanswer, { requestId });
		await ann.mutation(api.requests.update, {
			requestId,
			title: 'Once',
			schedule: once('2026-12-01')
		});
	});

	test('a request page with a malformed id is simply not there', async () => {
		const t = convexTest(schema, modules);
		const ann = await signedIn(t, 'ann');
		for (const requestId of ['abc', '', 'not-an-id-at-all'])
			expect(await ann.query(api.requests.get, { requestId, today: '2026-11-12' })).toBeNull();
		// An id from another table isn't a request either.
		const userId = await ann.mutation(api.users.ensure, {});
		expect(
			await ann.query(api.requests.get, { requestId: userId, today: '2026-11-12' })
		).toBeNull();
	});

	test('endDate is the last day it actually happens on', async () => {
		const t = convexTest(schema, modules);
		const ann = await signedIn(t, 'ann');
		const mondays = await ann.mutation(api.requests.create, {
			title: 'Mondays',
			schedule: {
				startDate: '2026-10-05',
				repeat: { kind: 'weekly', interval: 1, weekdays: ['MO'] },
				ends: { kind: 'until', date: '2026-11-11' }
			}
		});
		const daily = await ann.mutation(api.requests.create, {
			title: 'Daily',
			schedule: {
				startDate: '2026-11-01',
				repeat: { kind: 'daily', interval: 1 },
				ends: { kind: 'until', date: '2026-11-14' }
			}
		});
		for (const date of ['2026-11-12', '2026-11-13', '2026-11-14'])
			await ann.mutation(api.requests.skip, { requestId: daily, date, skipped: true });
		const { rows } = await ann.query(api.requests.list, { today: '2026-11-12' });
		expect(rows.map(({ title, section, endDate }) => ({ title, section, endDate }))).toEqual([
			{ title: 'Daily', section: 'past', endDate: '2026-11-11' },
			{ title: 'Mondays', section: 'past', endDate: '2026-11-09' }
		]);
		expect(
			await ann.query(api.requests.get, { requestId: mondays, today: '2026-11-01' })
		).toMatchObject({ section: 'active', endDate: '2026-11-09' });
	});

	test('a COUNT schedule ending after the year 9999 is turned down', async () => {
		const t = convexTest(schema, modules);
		const ann = await signedIn(t, 'ann');
		await expect(
			ann.mutation(api.requests.create, {
				title: 'Far',
				schedule: {
					startDate: '2026-11-12',
					repeat: { kind: 'yearly', interval: 999 },
					ends: { kind: 'count', count: 10 }
				}
			})
		).rejects.toThrow(/past the year 9999/);
	});

	test('days.range finds open-ended requests however many others there are, and says when there are too many', async () => {
		const t = convexTest(schema, modules);
		const ann = await signedIn(t, 'ann');
		const userId = await ann.mutation(api.users.ensure, {});
		const daily = await ann.mutation(api.requests.create, {
			title: 'Daily',
			schedule: {
				startDate: '2026-01-01',
				repeat: { kind: 'daily', interval: 1 },
				ends: { kind: 'never' }
			}
		});
		// Lots of one-time requests from the range's first day on.
		const addOnce = (n: number, startDate: string) =>
			t.run(async (ctx) => {
				for (let i = 0; i < n; i++)
					await ctx.db.insert('requests', {
						userId,
						title: `Once ${i}`,
						startDate,
						skipDates: [],
						lastDate: startDate,
						prayedCount: 0,
						createdAt: i,
						updatedAt: i
					});
			});
		await addOnce(1000, '2027-06-01');
		const days = await ann.query(api.days.range, { from: '2026-11-01', to: '2026-11-03' });
		expect(days.map((day) => day.items.map((i) => i.requestId))).toEqual([
			[daily],
			[daily],
			[daily]
		]);
		await addOnce(1, '2027-06-02');
		await expect(
			ann.query(api.days.range, { from: '2026-11-01', to: '2026-11-03' })
		).rejects.toThrow(/Too many requests/);
	});

	test('days.range fails rather than drop prayed marks', async () => {
		const t = convexTest(schema, modules);
		const ann = await signedIn(t, 'ann');
		const userId = await ann.mutation(api.users.ensure, {});
		const requestId = await ann.mutation(api.requests.create, {
			title: 'Daily',
			schedule: {
				startDate: '2026-01-01',
				repeat: { kind: 'daily', interval: 1 },
				ends: { kind: 'never' }
			}
		});
		// 8001 marks over the range (more than one a day only as data; the cap is what's tested).
		await t.run(async (ctx) => {
			for (let i = 0; i < 8001; i++)
				await ctx.db.insert('prayers', {
					userId,
					requestId,
					date: addDays('2026-01-01', i % 120)
				});
		});
		await expect(
			ann.query(api.days.range, { from: '2026-01-01', to: '2026-04-30' })
		).rejects.toThrow(/Too many prayed marks/);
		// A smaller range reads fewer.
		const days = await ann.query(api.days.range, { from: '2026-01-01', to: '2026-01-07' });
		expect(days.every((day) => day.items[0].prayed)).toBe(true);
	});

	test('the Requests list keeps every current request when there are too many to hold', async () => {
		const t = convexTest(schema, modules);
		const ann = await signedIn(t, 'ann');
		const userId = await ann.mutation(api.users.ensure, {});
		await t.run(async (ctx) => {
			for (let i = 0; i < 1000; i++)
				await ctx.db.insert('requests', {
					userId,
					title: `Old ${i}`,
					startDate: '2025-01-01',
					skipDates: [],
					lastDate: '2025-01-01',
					prayedCount: 0,
					createdAt: i,
					updatedAt: i
				});
		});
		await ann.mutation(api.requests.create, { title: 'New', schedule: once('2026-11-20') });
		const { rows, olderHidden } = await ann.query(api.requests.list, { today: '2026-11-12' });
		expect(olderHidden).toBe(true);
		expect(rows).toHaveLength(1000);
		expect(rows[0]).toMatchObject({ title: 'New', section: 'active' });
	});
});
