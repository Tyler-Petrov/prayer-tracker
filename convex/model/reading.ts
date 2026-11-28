import { ConvexError } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import {
	chapterCount,
	planReadings,
	planSchedule,
	validatePlan,
	type MissedReadings,
	type ReadingPlanFields
} from '../shared/bible';
import { describeSchedule, parseRRule, toRRule, type YMD } from '../shared/recurrence';

/**
 * The most readings one plan keeps. A plan makes at most 150 (Psalms, a chapter a day); the rest are readings
 * checked off before it was changed, which it keeps.
 */
export const PLAN_READINGS_MAX = 2000;

const chapters = (reading: { from: number; to: number }) => reading.to - reading.from + 1;

/** A stored plan back into the editor's fields. */
export function planFields(plan: Doc<'readingPlans'>): ReadingPlanFields {
	const schedule = parseRRule(plan.rrule, plan.startDate);
	const { repeat } = schedule;
	if (repeat.kind !== 'daily' && repeat.kind !== 'weekly')
		throw new Error(`A reading plan with a ${repeat.kind} rule`);
	return {
		fromChapter: plan.fromChapter,
		chaptersPerDay: plan.chaptersPerDay,
		startDate: plan.startDate,
		repeat,
		...(schedule.weekStart ? { weekStart: schedule.weekStart } : {})
	};
}

/** "2 chapters a day", "1 chapter · Weekly on Mon, Wed, Fri", "3 chapters · Every other day". */
export function planSummary(fields: ReadingPlanFields, today?: YMD) {
	const { repeat, chaptersPerDay } = fields;
	if (repeat.kind === 'daily' && repeat.interval === 1)
		return `${chapterCount(chaptersPerDay)} a day`;
	return `${chapterCount(chaptersPerDay)} · ${describeSchedule(planSchedule(fields), today)}`;
}

/**
 * A plan as the app shows it, for `today`: `next` is its first reading not checked off (null once it's all
 * read), `behind` how many readings before today aren't, `lastDate` the day of its last reading.
 */
export async function planView(ctx: QueryCtx, plan: Doc<'readingPlans'>, today: YMD) {
	const next = await ctx.db
		.query('readings')
		.withIndex('by_planId_and_read_and_date', (q) => q.eq('planId', plan._id).eq('read', false))
		.first();
	const missed = await ctx.db
		.query('readings')
		.withIndex('by_planId_and_read_and_date', (q) =>
			q.eq('planId', plan._id).eq('read', false).lt('date', today)
		)
		.take(PLAN_READINGS_MAX);
	const last = await ctx.db
		.query('readings')
		.withIndex('by_planId_and_date', (q) => q.eq('planId', plan._id))
		.order('desc')
		.first();
	const fields = planFields(plan);
	return {
		planId: plan._id,
		book: plan.book,
		fields,
		summary: planSummary(fields, today),
		/** How often it's read, in words ("Every day", "Weekly on Mon, Wed, Fri"). */
		repeats: describeSchedule(planSchedule(fields), today),
		chaptersRead: plan.chaptersRead,
		chaptersTotal: plan.chaptersTotal,
		next: next && { readingId: next._id, date: next.date, from: next.from, to: next.to },
		behind: missed.length,
		lastDate: last?.date ?? null,
		createdAt: plan.createdAt,
		updatedAt: plan.updatedAt
	};
}
export type PlanView = Awaited<ReturnType<typeof planView>>;

/** A plan's fields checked: the stored rule, or a ConvexError the person can read. */
export function checkPlan(book: string, fields: ReadingPlanFields, weekStart: 'SU' | 'MO') {
	const withWeekStart = { ...fields, weekStart: fields.weekStart ?? weekStart };
	const problem = validatePlan(book, withWeekStart);
	if (problem) throw new ConvexError(problem);
	return { fields: withWeekStart, rrule: toRRule(planSchedule(withWeekStart))! };
}

/**
 * Plans the rest of the book again from `fields`: the readings already checked off stay as they are, the others
 * go, and new ones take the plan's days from its start date on, leaving out the days and chapters already read.
 */
export async function replan(
	ctx: MutationCtx,
	plan: Doc<'readingPlans'>,
	fields: ReadingPlanFields,
	rrule: string
) {
	const readings = await ctx.db
		.query('readings')
		.withIndex('by_planId_and_date', (q) => q.eq('planId', plan._id))
		.take(PLAN_READINGS_MAX + 1);
	if (readings.length > PLAN_READINGS_MAX)
		throw new ConvexError('This plan has too many readings to change; start a new one');
	const kept = readings.filter((reading) => reading.read);
	for (const reading of readings) if (!reading.read) await ctx.db.delete('readings', reading._id);
	const planned = planReadings(plan.book, fields, kept);
	if (kept.length + planned.length > PLAN_READINGS_MAX)
		throw new ConvexError('This plan has too many readings to change; start a new one');
	for (const reading of planned)
		await ctx.db.insert('readings', {
			userId: plan.userId,
			planId: plan._id,
			book: plan.book,
			...reading,
			read: false
		});
	const chaptersRead = kept.reduce((sum, reading) => sum + chapters(reading), 0);
	await ctx.db.patch('readingPlans', plan._id, {
		chaptersPerDay: fields.chaptersPerDay,
		fromChapter: fields.fromChapter,
		startDate: fields.startDate,
		rrule,
		chaptersRead,
		chaptersTotal: chaptersRead + planned.reduce((sum, reading) => sum + chapters(reading), 0),
		updatedAt: Date.now()
	});
}

/**
 * A plan's readings whose day went by unread, as of `today`, dealt with as the person says (`missed`): left
 * where they are, moved to today, or the rest of the book planned again from the first of them, from today.
 */
export async function catchUp(
	ctx: MutationCtx,
	plan: Doc<'readingPlans'>,
	today: YMD,
	missed: MissedReadings
) {
	if (missed === 'leave') return;
	const late = await ctx.db
		.query('readings')
		.withIndex('by_planId_and_read_and_date', (q) =>
			q.eq('planId', plan._id).eq('read', false).lt('date', today)
		)
		.take(PLAN_READINGS_MAX);
	if (!late.length) return;
	if (missed === 'double') {
		for (const reading of late) await ctx.db.patch('readings', reading._id, { date: today });
		return;
	}
	const first = Math.min(...late.map((reading) => reading.from));
	const { fields, rrule } = checkPlan(
		plan.book,
		{ ...planFields(plan), startDate: today, fromChapter: first },
		'SU'
	);
	await replan(ctx, plan, fields, rrule);
}

/** Marks a reading read or not, keeping its plan's `chaptersRead` in step. Idempotent. */
export async function setReadingRead(ctx: MutationCtx, reading: Doc<'readings'>, read: boolean) {
	if (reading.read === read) return;
	const plan = await ctx.db.get('readingPlans', reading.planId);
	await ctx.db.patch('readings', reading._id, { read });
	if (!plan) return;
	const change = read ? chapters(reading) : -chapters(reading);
	await ctx.db.patch('readingPlans', plan._id, {
		chaptersRead: Math.max(0, plan.chaptersRead + change)
	});
}

/** Deletes up to `batch` of a plan's readings; true when there are none left. */
export async function deleteReadingBatch(
	ctx: MutationCtx,
	planId: Id<'readingPlans'>,
	batch = 1000
) {
	const readings = await ctx.db
		.query('readings')
		.withIndex('by_planId_and_date', (q) => q.eq('planId', planId))
		.take(batch);
	for (const reading of readings) await ctx.db.delete('readings', reading._id);
	return readings.length < batch;
}
