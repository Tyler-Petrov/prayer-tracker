/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

async function signedIn(t: ReturnType<typeof convexTest>, name: string) {
	const as = t.withIdentity({ subject: name, email: `${name}@example.com` });
	await as.mutation(api.users.ensure, {});
	return as;
}

const daily = (startDate: string) => ({
	startDate,
	repeat: { kind: 'daily' as const, interval: 1 },
	ends: { kind: 'never' as const }
});
const once = (startDate: string) => ({
	startDate,
	repeat: { kind: 'none' as const },
	ends: { kind: 'never' as const }
});

test('the overview counts answers, prayed days and chapters read', async () => {
	const t = convexTest(schema, modules);
	const ann = await signedIn(t, 'ann');
	const today = '2026-11-27';

	const family = await ann.mutation(api.requests.create, {
		title: 'Family',
		schedule: daily('2026-10-01')
	});
	const job = await ann.mutation(api.requests.create, {
		title: 'Job',
		schedule: once('2026-03-01')
	});
	const move = await ann.mutation(api.requests.create, {
		title: 'Move',
		schedule: once('2025-05-01')
	});
	const visit = await ann.mutation(api.requests.create, {
		title: 'Visit',
		schedule: daily('2026-11-01')
	});
	await ann.mutation(api.requests.answer, { requestId: job, answeredOn: '2026-03-10' });
	await ann.mutation(api.requests.answer, { requestId: move, answeredOn: '2025-05-02' });
	await ann.mutation(api.requests.answer, { requestId: visit, answeredOn: '2026-11-20' });
	// Answered on a day still to come: not this year's yet.
	const trip = await ann.mutation(api.requests.create, {
		title: 'Trip',
		schedule: once('2027-01-01')
	});
	await ann.mutation(api.requests.answer, { requestId: trip, answeredOn: '2027-01-02' });
	// Two days running up to yesterday (today not yet: the run isn't broken), one before, one too long ago.
	for (const date of ['2026-10-01', '2026-11-20', '2026-11-25', '2026-11-26'])
		await ann.mutation(api.prayers.set, { requestId: family, date, prayed: true });
	await ann.mutation(api.prayers.set, { requestId: visit, date: '2026-11-26', prayed: true });

	// Ruth read through; one chapter of Jonah.
	const fields = {
		fromChapter: 1,
		chaptersPerDay: 1,
		startDate: '2026-11-26',
		repeat: { kind: 'daily' as const, interval: 1 }
	};
	for (const book of ['Ruth', 'Jonah']) {
		const planId = await ann.mutation(api.reading.create, { book, fields });
		const plan = await ann.query(api.reading.get, { planId, today });
		for (const reading of plan!.readings.slice(0, book === 'Ruth' ? 4 : 1))
			await ann.mutation(api.reading.setRead, { readingId: reading.readingId, read: true });
	}

	const stats = await ann.query(api.overview.stats, { today });
	expect(stats).toMatchObject({
		answered: 4,
		answeredThisYear: 2,
		praying: 1,
		daysPrayed: 3,
		streak: 2,
		streakFull: false,
		chaptersRead: 5,
		booksFinished: ['Ruth'],
		requestsCapped: false
	});
	expect(stats.recentAnswered.map((r) => [r.title, r.answeredOn])).toEqual([
		['Trip', '2027-01-02'],
		['Visit', '2026-11-20'],
		['Job', '2026-03-10']
	]);
	expect(stats.days).toHaveLength(30);
	expect(stats.days[0]).toEqual({ date: '2026-10-29', prayed: false });
	expect(stats.days.filter((d) => d.prayed).map((d) => d.date)).toEqual([
		'2026-11-20',
		'2026-11-25',
		'2026-11-26'
	]);

	// Praying today too: the run reaches today.
	await ann.mutation(api.prayers.set, { requestId: family, date: today, prayed: true });
	expect(await ann.query(api.overview.stats, { today })).toMatchObject({ streak: 3 });

	// Someone else's numbers are their own.
	const bob = await signedIn(t, 'bob');
	expect(await bob.query(api.overview.stats, { today })).toMatchObject({
		answered: 0,
		praying: 0,
		daysPrayed: 0,
		streak: 0,
		chaptersRead: 0,
		booksFinished: []
	});
});

test('a run of prayed days that fills the window says so', async () => {
	const t = convexTest(schema, modules);
	const ann = await signedIn(t, 'ann');
	const requestId = await ann.mutation(api.requests.create, {
		title: 'Family',
		schedule: daily('2026-10-01')
	});
	for (let day = 1; day <= 26; day++) {
		const date = `2026-11-${String(day).padStart(2, '0')}`;
		await ann.mutation(api.prayers.set, { requestId, date, prayed: true });
	}
	for (const date of ['2026-10-29', '2026-10-30', '2026-10-31'])
		await ann.mutation(api.prayers.set, { requestId, date, prayed: true });
	expect(await ann.query(api.overview.stats, { today: '2026-11-27' })).toMatchObject({
		streak: 29,
		streakFull: true
	});
});
