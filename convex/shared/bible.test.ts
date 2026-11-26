import { describe, expect, test } from 'vitest';
import {
	BOOKS,
	chaptersIn,
	NEW_TESTAMENT,
	passageLabel,
	planReadings,
	splitBook,
	validatePlan,
	type ReadingPlanFields
} from './bible';

const daily = (fields: Partial<ReadingPlanFields> = {}): ReadingPlanFields => ({
	fromChapter: 1,
	chaptersPerDay: 1,
	startDate: '2026-11-26',
	repeat: { kind: 'daily', interval: 1 },
	...fields
});

describe('books', () => {
	test('are the 66, with 1,189 chapters', () => {
		expect(BOOKS).toHaveLength(66);
		const sum = (books: readonly (readonly [string, number])[]) =>
			books.reduce((total, [, n]) => total + n, 0);
		expect(sum(BOOKS.slice(0, NEW_TESTAMENT))).toBe(929);
		expect(sum(BOOKS.slice(NEW_TESTAMENT))).toBe(260);
		expect(chaptersIn('Psalms')).toBe(150);
	});
});

describe('passageLabel', () => {
	test('names chapters, psalms and one-chapter books', () => {
		expect(passageLabel('Romans', { from: 3, to: 4 })).toBe('Romans 3–4');
		expect(passageLabel('Romans', { from: 16, to: 16 })).toBe('Romans 16');
		expect(passageLabel('Psalms', { from: 23, to: 23 })).toBe('Psalm 23');
		expect(passageLabel('Psalms', { from: 1, to: 2 })).toBe('Psalms 1–2');
		expect(passageLabel('Jude', { from: 1, to: 1 })).toBe('Jude');
	});
});

describe('splitBook', () => {
	test('cuts the rest of the book into readings, the last one shorter', () => {
		expect(splitBook('Philippians', 1, 3)).toEqual([
			{ from: 1, to: 3 },
			{ from: 4, to: 4 }
		]);
		expect(splitBook('Romans', 15, 1)).toEqual([
			{ from: 15, to: 15 },
			{ from: 16, to: 16 }
		]);
	});
});

describe('planReadings', () => {
	test('puts a reading on each day of the schedule until the book ends', () => {
		expect(planReadings('Romans', daily({ fromChapter: 11, chaptersPerDay: 2 }))).toEqual([
			{ date: '2026-11-26', from: 11, to: 12 },
			{ date: '2026-11-27', from: 13, to: 14 },
			{ date: '2026-11-28', from: 15, to: 16 }
		]);
	});

	test('follows weekly days and every few days', () => {
		const weekly = planReadings(
			'Ephesians',
			daily({
				chaptersPerDay: 2,
				// Thursday the 26th: Mon, Wed, Fri from there.
				repeat: { kind: 'weekly', interval: 1, weekdays: ['MO', 'WE', 'FR'] }
			})
		);
		expect(weekly.map((r) => r.date)).toEqual(['2026-11-27', '2026-11-30', '2026-12-02']);
		const everyThree = planReadings(
			'Jonah',
			daily({ chaptersPerDay: 2, repeat: { kind: 'daily', interval: 3 } })
		);
		expect(everyThree).toEqual([
			{ date: '2026-11-26', from: 1, to: 2 },
			{ date: '2026-11-29', from: 3, to: 4 }
		]);
	});

	test('leaves out days already taken', () => {
		const readings = planReadings('Ruth', daily(), [{ date: '2026-11-27', from: 4, to: 4 }]);
		expect(readings).toEqual([
			{ date: '2026-11-26', from: 1, to: 1 },
			{ date: '2026-11-28', from: 2, to: 2 },
			{ date: '2026-11-29', from: 3, to: 3 }
		]);
	});

	test('leaves out chapters already read, and never reads across them', () => {
		const readings = planReadings('Ruth', daily({ chaptersPerDay: 2 }), [
			{ date: '2026-11-20', from: 2, to: 2 }
		]);
		expect(readings).toEqual([
			{ date: '2026-11-26', from: 1, to: 1 },
			{ date: '2026-11-27', from: 3, to: 4 }
		]);
	});

	test('turns down plans that make no sense', () => {
		expect(validatePlan('Hezekiah', daily())).toMatch(/book/);
		expect(validatePlan('Jude', daily({ fromChapter: 2 }))).toMatch(/1 to 1/);
		expect(validatePlan('Romans', daily({ chaptersPerDay: 0 }))).toMatch(/1 to 16/);
		expect(
			validatePlan('Romans', daily({ repeat: { kind: 'weekly', interval: 1, weekdays: [] } }))
		).toMatch(/day of the week/);
		expect(() => planReadings('Romans', daily({ startDate: '2026-02-30' }))).toThrow();
	});
});
