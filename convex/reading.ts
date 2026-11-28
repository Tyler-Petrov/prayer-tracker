// Reading through books of the Bible: a plan reads some chapters at a time, on a schedule, until its book ends.
// Its readings are made up front, one per day (shared/bible.ts planReadings), and show on the Days tab below the
// day's requests (days.range). Changing a plan plans the rest of the book again; readings checked off stay.
import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalMutation } from './_generated/server';
import { assertDate, getOwned, userMutation, userQuery } from './functions';
import {
	catchUp as catchUpPlan,
	checkPlan,
	deleteReadingBatch,
	PLAN_READINGS_MAX,
	planView,
	replan,
	setReadingRead
} from './model/reading';
import { vReadingPlanFields } from './schema';

/** Plans listed on Overview. */
const PLANS_MAX = 100;

/**
 * The caller's reading plans, as of `today`: those with readings left first (the next one soonest), then the
 * finished ones, latest first.
 */
export const list = userQuery({
	args: { today: v.string() },
	handler: async (ctx, { today }) => {
		assertDate(today);
		const plans = await ctx.db
			.query('readingPlans')
			.withIndex('by_userId', (q) => q.eq('userId', ctx.userId))
			.order('desc')
			.take(PLANS_MAX);
		const views = await Promise.all(plans.map((plan) => planView(ctx, plan, today)));
		return views.sort((a, b) =>
			a.next && b.next
				? a.next.date.localeCompare(b.next.date) || a.book.localeCompare(b.book)
				: a.next
					? -1
					: b.next
						? 1
						: b.updatedAt - a.updatedAt
		);
	}
});

/**
 * One plan for its page, with all its readings in order. Null when it's gone, someone else's, or `planId`
 * (straight from the page's URL) isn't a plan id at all.
 */
export const get = userQuery({
	args: { planId: v.string(), today: v.string() },
	handler: async (ctx, args) => {
		assertDate(args.today);
		const planId = ctx.db.normalizeId('readingPlans', args.planId);
		if (!planId) return null;
		const plan = await ctx.db.get('readingPlans', planId);
		if (!plan || plan.userId !== ctx.userId) return null;
		const readings = await ctx.db
			.query('readings')
			.withIndex('by_planId_and_date', (q) => q.eq('planId', planId))
			.take(PLAN_READINGS_MAX);
		return {
			...(await planView(ctx, plan, args.today)),
			readings: readings.map((reading) => ({
				readingId: reading._id,
				date: reading.date,
				from: reading.from,
				to: reading.to,
				read: reading.read
			}))
		};
	}
});

/** Starts reading `book`: its readings, from the chapter they're at to the end, go on the plan's days. */
export const create = userMutation({
	args: { book: v.string(), fields: vReadingPlanFields },
	returns: v.id('readingPlans'),
	handler: async (ctx, args) => {
		const { fields, rrule } = checkPlan(args.book, args.fields, ctx.user.weekStart ?? 'SU');
		const now = Date.now();
		const planId = await ctx.db.insert('readingPlans', {
			userId: ctx.userId,
			book: args.book,
			chaptersPerDay: fields.chaptersPerDay,
			fromChapter: fields.fromChapter,
			startDate: fields.startDate,
			rrule,
			chaptersTotal: 0,
			chaptersRead: 0,
			createdAt: now,
			updatedAt: now
		});
		await replan(ctx, (await ctx.db.get('readingPlans', planId))!, fields, rrule);
		return planId;
	}
});

/**
 * Changes how much and how often, and where they are: the readings not checked off are planned again from
 * `fields.startDate`. Also how a plan that's fallen behind catches up (from today, at the first unread chapter).
 */
export const update = userMutation({
	args: { planId: v.id('readingPlans'), fields: vReadingPlanFields },
	returns: v.null(),
	handler: async (ctx, args) => {
		const plan = await getOwned(ctx, ctx.userId, 'readingPlans', args.planId);
		const { fields, rrule } = checkPlan(plan.book, args.fields, ctx.user.weekStart ?? 'SU');
		await replan(ctx, plan, fields, rrule);
		return null;
	}
});

/**
 * Deals with readings whose day went by unread, as of `today`, in each of the caller's plans, as their setting
 * says (`missedReadings`, 'push' when unset). The app calls it when a plan has fallen behind and the setting
 * isn't 'leave'; a second call finds nothing to do.
 */
export const catchUp = userMutation({
	args: { today: v.string() },
	returns: v.null(),
	handler: async (ctx, { today }) => {
		assertDate(today);
		const plans = await ctx.db
			.query('readingPlans')
			.withIndex('by_userId', (q) => q.eq('userId', ctx.userId))
			.order('desc')
			.take(PLANS_MAX);
		const missed = ctx.user.missedReadings ?? 'push';
		for (const plan of plans) await catchUpPlan(ctx, plan, today, missed);
		return null;
	}
});

/** Read (`read: true`) or not. */
export const setRead = userMutation({
	args: { readingId: v.id('readings'), read: v.boolean() },
	returns: v.null(),
	handler: async (ctx, { readingId, read }) => {
		const reading = await getOwned(ctx, ctx.userId, 'readings', readingId);
		await setReadingRead(ctx, reading, read);
		return null;
	}
});

/** Deletes a plan and all its readings. */
export const remove = userMutation({
	args: { planId: v.id('readingPlans') },
	returns: v.null(),
	handler: async (ctx, { planId }) => {
		await getOwned(ctx, ctx.userId, 'readingPlans', planId);
		await ctx.db.delete('readingPlans', planId);
		if (!(await deleteReadingBatch(ctx, planId)))
			await ctx.scheduler.runAfter(0, internal.reading.deleteReadings, { planId });
		return null;
	}
});

/** The rest of a deleted plan's readings, a batch at a time. */
export const deleteReadings = internalMutation({
	args: { planId: v.id('readingPlans') },
	returns: v.null(),
	handler: async (ctx, { planId }) => {
		if (!(await deleteReadingBatch(ctx, planId)))
			await ctx.scheduler.runAfter(0, internal.reading.deleteReadings, { planId });
		return null;
	}
});
