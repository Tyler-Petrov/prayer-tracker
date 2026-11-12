// What someone is praying for: each request happens once or on a schedule (shared/recurrence.ts), can have
// single days skipped, and can be marked answered.
import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import { internalMutation } from './_generated/server';
import { assertDate, getOwned, userMutation, userQuery } from './functions';
import {
	cleanText,
	deletePrayerBatch,
	derived,
	requestView,
	ruleFor,
	SKIPS_MAX,
	startsAfterAnswer,
	upcomingDates
} from './model/requests';
import { vSchedule } from './schema';
import { setPrayed } from './model/prayers';
import { occursOn } from './shared/recurrence';

/** Rows the Requests list holds: every current request, then the latest ended and answered ones. */
const LIST_MAX = 1000;
const HISTORY_MAX = 400;
const ANSWER_NOTE_MAX = 2000;

/**
 * Everything the caller is praying for, for the Requests tab, as of `today` (their local day). Each row's
 * `section` says where it goes: 'active' (happens today or later), 'past' (a one-time day gone by, or a schedule
 * that has ended) or 'answered'. Sorted: active by next date, past by last date (latest first), answered by
 * answer date (latest first); then by title.
 *
 * Bounded: those still going today or later come first (all of them, up to LIST_MAX), then those that ended
 * before today, latest first, as many as fit. `olderHidden` says some ended or answered ones didn't.
 */
export const list = userQuery({
	args: { today: v.string() },
	handler: async (ctx, { today }) => {
		assertDate(today);
		const current = await ctx.db
			.query('requests')
			.withIndex('by_userId_and_lastDate', (q) => q.eq('userId', ctx.userId).gte('lastDate', today))
			.take(LIST_MAX);
		const room = LIST_MAX - current.length;
		const ended = await ctx.db
			.query('requests')
			.withIndex('by_userId_and_lastDate', (q) => q.eq('userId', ctx.userId).lt('lastDate', today))
			.order('desc')
			.take(room + 1);
		const olderHidden = current.length === LIST_MAX || ended.length > room;
		const rows = [...current, ...ended.slice(0, room)].map((request) =>
			requestView(request, today)
		);
		const key = (row: (typeof rows)[number]) =>
			row.section === 'active'
				? `0 ${row.nextDate}`
				: row.section === 'past'
					? `1 ${invert(row.endDate ?? row.startDate)}`
					: `2 ${invert(row.answeredOn ?? '')}`;
		rows.sort((a, b) => key(a).localeCompare(key(b)) || a.title.localeCompare(b.title));
		return { rows, olderHidden };
	}
});

/** A date string that sorts backwards. */
const invert = (date: string) => date.replace(/\d/g, (d) => String(9 - Number(d)));

/**
 * One request for its page, as of `today`: the list row plus the next few days it happens on (`upcoming`), the
 * days it was marked prayed (`prayedDates`, latest first, the last 400), its skipped days and its stored rule.
 * Null when it's gone, someone else's, or `requestId` (straight from the page's URL) isn't a request id at all.
 */
export const get = userQuery({
	args: { requestId: v.string(), today: v.string() },
	handler: async (ctx, args) => {
		const { today } = args;
		assertDate(today);
		const requestId = ctx.db.normalizeId('requests', args.requestId);
		if (!requestId) return null;
		const request = await ctx.db.get('requests', requestId);
		if (!request || request.userId !== ctx.userId) return null;
		const prayers = await ctx.db
			.query('prayers')
			.withIndex('by_requestId_and_date', (q) => q.eq('requestId', requestId))
			.order('desc')
			.take(HISTORY_MAX);
		return {
			...requestView(request, today),
			rrule: request.rrule ?? null,
			skipDates: request.skipDates,
			upcoming: upcomingDates(request, today),
			prayedDates: prayers.map((prayer) => prayer.date)
		};
	}
});

export const create = userMutation({
	args: { title: v.string(), notes: v.optional(v.string()), schedule: vSchedule },
	returns: v.id('requests'),
	handler: async (ctx, { schedule, ...text }) => {
		const { title, notes } = cleanText(text);
		const rrule = ruleFor(schedule, ctx.user.weekStart ?? 'SU');
		const now = Date.now();
		const fields = { startDate: schedule.startDate, rrule, skipDates: [] };
		return ctx.db.insert('requests', {
			userId: ctx.userId,
			title,
			notes,
			...fields,
			...derived(fields),
			prayedCount: 0,
			createdAt: now,
			updatedAt: now
		});
	}
});

/**
 * Change the title, notes and schedule. Skipped days the new schedule no longer has are dropped; prayed marks
 * stay (days.range still shows them, as unscheduled).
 */
export const update = userMutation({
	args: {
		requestId: v.id('requests'),
		title: v.string(),
		notes: v.optional(v.string()),
		schedule: vSchedule
	},
	returns: v.null(),
	handler: async (ctx, { requestId, schedule, ...text }) => {
		const request = await getOwned(ctx, ctx.userId, 'requests', requestId);
		const { title, notes } = cleanText(text);
		const rrule = ruleFor(schedule, ctx.user.weekStart ?? 'SU');
		const startDate = schedule.startDate;
		// The same rule answer() keeps: never answered before it starts (it would have no days at all).
		if (request.answeredOn && startDate > request.answeredOn)
			throw new ConvexError(startsAfterAnswer(request.answeredOn));
		const skipDates = rrule
			? request.skipDates.filter((date) =>
					occursOn({ startDate, rrule }, date, { includeSkipped: true })
				)
			: [];
		const fields = { startDate, rrule, skipDates, answeredOn: request.answeredOn };
		await ctx.db.replace('requests', requestId, {
			...request,
			title,
			notes,
			startDate,
			rrule,
			skipDates,
			...derived(fields),
			updatedAt: Date.now()
		});
	}
});

/** Deletes a request and every day it was marked prayed. */
export const remove = userMutation({
	args: { requestId: v.id('requests') },
	returns: v.null(),
	handler: async (ctx, { requestId }) => {
		await getOwned(ctx, ctx.userId, 'requests', requestId);
		await ctx.db.delete('requests', requestId);
		if (!(await deletePrayerBatch(ctx, requestId)))
			await ctx.scheduler.runAfter(0, internal.requests.deletePrayers, { requestId });
	}
});

/** The rest of a deleted request's prayed marks, a batch at a time. */
export const deletePrayers = internalMutation({
	args: { requestId: v.id('requests') },
	returns: v.null(),
	handler: async (ctx, { requestId }) => {
		if (!(await deletePrayerBatch(ctx, requestId)))
			await ctx.scheduler.runAfter(0, internal.requests.deletePrayers, { requestId });
	}
});

/**
 * Skip one day of a recurring request (`skipped: true`), or bring it back. Skipping also clears that day's
 * prayed mark. Like EXDATE, a skipped day still counts toward "after N times".
 */
export const skip = userMutation({
	args: { requestId: v.id('requests'), date: v.string(), skipped: v.boolean() },
	returns: v.null(),
	handler: async (ctx, { requestId, date, skipped }) => {
		assertDate(date);
		const request = await getOwned(ctx, ctx.userId, 'requests', requestId);
		if (!request.rrule) throw new ConvexError("A one-time request can't skip its day");
		const has = request.skipDates.includes(date);
		if (skipped === has) return;
		if (skipped) {
			if (!occursOn(request, date)) throw new ConvexError("It isn't scheduled that day");
			if (request.skipDates.length >= SKIPS_MAX)
				throw new ConvexError('Too many skipped days; change the schedule instead');
		}
		const skipDates = skipped
			? [...request.skipDates, date].sort()
			: request.skipDates.filter((d) => d !== date);
		await ctx.db.patch('requests', requestId, {
			skipDates,
			...derived({ ...request, skipDates }),
			updatedAt: Date.now()
		});
		if (skipped) await setPrayed(ctx, request, date, false);
	}
});

/** Mark it answered on `answeredOn` (with an optional note): it stops happening after that day. */
export const answer = userMutation({
	args: { requestId: v.id('requests'), answeredOn: v.string(), answerNote: v.optional(v.string()) },
	returns: v.null(),
	handler: async (ctx, { requestId, answeredOn, answerNote }) => {
		assertDate(answeredOn);
		const request = await getOwned(ctx, ctx.userId, 'requests', requestId);
		if (answeredOn < request.startDate)
			throw new ConvexError("It can't be answered before it starts");
		const note = answerNote?.trim() || undefined;
		if (note && note.length > ANSWER_NOTE_MAX)
			throw new ConvexError(`Keep the note under ${ANSWER_NOTE_MAX} characters`);
		await ctx.db.patch('requests', requestId, {
			answeredOn,
			answerNote: note,
			...derived({ ...request, answeredOn }),
			updatedAt: Date.now()
		});
	}
});

/** Back to unanswered: it happens on its schedule again. */
export const unanswer = userMutation({
	args: { requestId: v.id('requests') },
	returns: v.null(),
	handler: async (ctx, { requestId }) => {
		const request = await getOwned(ctx, ctx.userId, 'requests', requestId);
		await ctx.db.patch('requests', requestId, {
			answeredOn: undefined,
			answerNote: undefined,
			...derived({ ...request, answeredOn: undefined }),
			updatedAt: Date.now()
		});
	}
});
