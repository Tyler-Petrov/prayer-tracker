/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';
import type { ReadingPlanFields } from './shared/bible';

const modules = import.meta.glob('./**/*.ts');

async function signedIn(t: ReturnType<typeof convexTest>, name: string) {
	const as = t.withIdentity({ subject: name, email: `${name}@example.com` });
	await as.mutation(api.users.ensure, {});
	return as;
}

const twoADay: ReadingPlanFields = {
	fromChapter: 1,
	chaptersPerDay: 2,
	startDate: '2026-11-26',
	repeat: { kind: 'daily', interval: 1 }
};

describe('reading plans', () => {
	test('make a reading on each day until the book ends, shown on the Days tab', async () => {
		const t = convexTest(schema, modules);
		const ann = await signedIn(t, 'ann');
		const planId = await ann.mutation(api.reading.create, { book: 'Philippians', fields: twoADay });

		const days = await ann.query(api.days.range, { from: '2026-11-20', to: '2026-12-10' });
		expect(days.map((d) => [d.date, d.items, d.readings.map((r) => [r.from, r.to])])).toEqual([
			['2026-11-26', [], [[1, 2]]],
			['2026-11-27', [], [[3, 4]]]
		]);

		const [plan] = await ann.query(api.reading.list, { today: '2026-11-26' });
		expect(plan).toMatchObject({
			planId,
			book: 'Philippians',
			summary: '2 chapters a day',
			chaptersRead: 0,
			chaptersTotal: 4,
			next: { date: '2026-11-26', from: 1, to: 2 },
			behind: 0,
			lastDate: '2026-11-27'
		});
	});

	test('count what was read, and say when they fall behind', async () => {
		const t = convexTest(schema, modules);
		const ann = await signedIn(t, 'ann');
		const planId = await ann.mutation(api.reading.create, { book: 'Ruth', fields: twoADay });
		const before = await ann.query(api.reading.get, { planId, today: '2026-11-28' });
		expect(before).toMatchObject({ behind: 2, next: { date: '2026-11-26' } });

		await ann.mutation(api.reading.setRead, {
			readingId: before!.readings[0].readingId,
			read: true
		});
		// Twice is the same as once.
		await ann.mutation(api.reading.setRead, {
			readingId: before!.readings[0].readingId,
			read: true
		});
		const after = await ann.query(api.reading.get, { planId, today: '2026-11-28' });
		expect(after).toMatchObject({ chaptersRead: 2, behind: 1, next: { from: 3, to: 4 } });

		await ann.mutation(api.reading.setRead, {
			readingId: before!.readings[1].readingId,
			read: true
		});
		const done = await ann.query(api.reading.get, { planId, today: '2026-11-28' });
		expect(done).toMatchObject({ chaptersRead: 4, chaptersTotal: 4, behind: 0, next: null });
	});

	test('plan again around chapters read ahead, without reading them twice', async () => {
		const t = convexTest(schema, modules);
		const ann = await signedIn(t, 'ann');
		const oneADay = { ...twoADay, chaptersPerDay: 1 };
		const planId = await ann.mutation(api.reading.create, { book: 'Ruth', fields: oneADay });
		const plan = await ann.query(api.reading.get, { planId, today: '2026-11-28' });
		// Read Ruth 2 ahead of Ruth 1, then carry on from today.
		await ann.mutation(api.reading.setRead, { readingId: plan!.readings[1].readingId, read: true });
		await ann.mutation(api.reading.update, {
			planId,
			fields: { ...oneADay, startDate: '2026-11-28', fromChapter: 1 }
		});
		const changed = await ann.query(api.reading.get, { planId, today: '2026-11-28' });
		expect(changed!.readings.map((r) => [r.date, r.from, r.read])).toEqual([
			['2026-11-27', 2, true],
			['2026-11-28', 1, false],
			['2026-11-29', 3, false],
			['2026-11-30', 4, false]
		]);
		expect(changed).toMatchObject({ chaptersRead: 1, chaptersTotal: 4 });
	});

	test('plan again when changed, keeping what was read', async () => {
		const t = convexTest(schema, modules);
		const ann = await signedIn(t, 'ann');
		const planId = await ann.mutation(api.reading.create, { book: 'Ephesians', fields: twoADay });
		const plan = await ann.query(api.reading.get, { planId, today: '2026-11-26' });
		await ann.mutation(api.reading.setRead, { readingId: plan!.readings[0].readingId, read: true });

		// Fell behind: carry on from today, one a day, at chapter 3.
		await ann.mutation(api.reading.update, {
			planId,
			fields: { ...twoADay, startDate: '2026-11-30', fromChapter: 3, chaptersPerDay: 1 }
		});
		const changed = await ann.query(api.reading.get, { planId, today: '2026-11-30' });
		expect(changed!.readings.map((r) => [r.date, r.from, r.to, r.read])).toEqual([
			['2026-11-26', 1, 2, true],
			['2026-11-30', 3, 3, false],
			['2026-12-01', 4, 4, false],
			['2026-12-02', 5, 5, false],
			['2026-12-03', 6, 6, false]
		]);
		expect(changed).toMatchObject({
			chaptersRead: 2,
			chaptersTotal: 6,
			summary: '1 chapter a day'
		});

		// Planned from before a day already read: that day keeps its reading.
		await ann.mutation(api.reading.update, {
			planId,
			fields: { ...twoADay, startDate: '2026-11-25', fromChapter: 3 }
		});
		const again = await ann.query(api.reading.get, { planId, today: '2026-11-30' });
		expect(again!.readings.map((r) => [r.date, r.from, r.to])).toEqual([
			['2026-11-25', 3, 4],
			['2026-11-26', 1, 2],
			['2026-11-27', 5, 6]
		]);
	});

	test("are each person's own, and go with their readings when deleted", async () => {
		const t = convexTest(schema, modules);
		const ann = await signedIn(t, 'ann');
		const bob = await signedIn(t, 'bob');
		const planId = await ann.mutation(api.reading.create, { book: 'Jonah', fields: twoADay });
		const { readings } = (await ann.query(api.reading.get, { planId, today: '2026-11-26' }))!;

		expect(await bob.query(api.reading.list, { today: '2026-11-26' })).toEqual([]);
		expect(await bob.query(api.reading.get, { planId, today: '2026-11-26' })).toBeNull();
		for (const attempt of [
			() => bob.mutation(api.reading.setRead, { readingId: readings[0].readingId, read: true }),
			() => bob.mutation(api.reading.update, { planId, fields: twoADay }),
			() => bob.mutation(api.reading.remove, { planId })
		])
			await expect(attempt()).rejects.toThrow(/Not found/);

		await ann.mutation(api.reading.remove, { planId });
		expect(await ann.query(api.reading.list, { today: '2026-11-26' })).toEqual([]);
		expect(await ann.query(api.days.range, { from: '2026-11-20', to: '2026-12-10' })).toEqual([]);
	});

	test('check their fields', async () => {
		const t = convexTest(schema, modules);
		const ann = await signedIn(t, 'ann');
		await expect(
			ann.mutation(api.reading.create, { book: 'Enoch', fields: twoADay })
		).rejects.toThrow(/Pick a book/);
		await expect(
			ann.mutation(api.reading.create, { book: 'Jude', fields: { ...twoADay, fromChapter: 3 } })
		).rejects.toThrow(/chapter from 1 to 1/);
	});
});
