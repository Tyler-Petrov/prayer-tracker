// The Days tab: what's prayed for on each day of a range.
//
// Recurrence is expanded here on the server (shared/recurrence.ts), not in the browser: the client gets plain
// rows per day that optimistic updates can patch (lib/optimistic.ts), skips and answers are applied in one
// place, and a subscription re-runs only when the caller's requests or marks change. The range is bounded
// (MAX_RANGE_DAYS, about four months) and only requests that can reach it are read (requests.lastDate), so the
// work is bounded too: the client holds one window at most that long and lets go of the far end as it scrolls.
import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { assertDate, userQuery } from './functions';
import { daysBetween, MAX_RANGE_DAYS, occurrences, OPEN_END, type YMD } from './shared/recurrence';

/** Requests read per index range: more than this many reaching one range is an error, not a cut. */
const REQUESTS_MAX = 1000;
/**
 * Prayed marks read for one range: about 66 a day across MAX_RANGE_DAYS. Past it the query fails rather than
 * leave the latest days looking unprayed.
 */
const PRAYERS_MAX = 8000;

export type DayItem = {
	requestId: Id<'requests'>;
	title: string;
	/** Marked prayed that day. */
	prayed: boolean;
	/** Its schedule has this day. False for a mark left on a day the schedule no longer has. */
	scheduled: boolean;
	/** Skipped just this day ("skip just this day"): shown so it can be brought back. */
	skipped: boolean;
	recurring: boolean;
	/** The day it was answered, when it was; it doesn't happen after it. */
	answeredOn: YMD | null;
};

/**
 * The days `from` through `to` (YYYY-MM-DD, inclusive, at most MAX_RANGE_DAYS) that have anything on them, in
 * order, each with its requests in the order they were added: those scheduled that day (skipped ones flagged)
 * plus any marked prayed on a day their schedule doesn't have. Days with nothing are left out.
 */
export const range = userQuery({
	args: { from: v.string(), to: v.string() },
	handler: async (ctx, { from, to }) => {
		assertDate(from);
		assertDate(to);
		if (to < from) throw new ConvexError('The range ends before it starts');
		if (daysBetween(from, to) >= MAX_RANGE_DAYS)
			throw new ConvexError(`Ask for at most ${MAX_RANGE_DAYS} days at a time`);

		// Every request still going on `from` or later, read in two index ranges: those that end (one-time, until,
		// count, answered) and those that don't. One range sorted by lastDate would put the open-ended ones last,
		// first to go at any cap. Those starting after `to` are dropped below.
		const ending = await ctx.db
			.query('requests')
			.withIndex('by_userId_and_lastDate', (q) =>
				q.eq('userId', ctx.userId).gte('lastDate', from).lt('lastDate', OPEN_END)
			)
			.take(REQUESTS_MAX + 1);
		const openEnded = await ctx.db
			.query('requests')
			.withIndex('by_userId_and_lastDate', (q) =>
				q.eq('userId', ctx.userId).eq('lastDate', OPEN_END)
			)
			.take(REQUESTS_MAX + 1);
		if (ending.length > REQUESTS_MAX || openEnded.length > REQUESTS_MAX)
			throw new ConvexError('Too many requests reach these days to show them');
		const requests = [...ending, ...openEnded].filter((request) => request.startDate <= to);
		const prayers = await ctx.db
			.query('prayers')
			.withIndex('by_userId_and_date', (q) =>
				q.eq('userId', ctx.userId).gte('date', from).lte('date', to)
			)
			.take(PRAYERS_MAX + 1);
		if (prayers.length > PRAYERS_MAX)
			throw new ConvexError('Too many prayed marks on these days to show them; ask for fewer days');

		const byId = new Map<Id<'requests'>, Doc<'requests'>>(requests.map((r) => [r._id, r]));
		// Marks on requests outside the range's requests (prayed after it was answered, say).
		for (const prayer of prayers) {
			if (byId.has(prayer.requestId)) continue;
			const request = await ctx.db.get('requests', prayer.requestId);
			if (request) byId.set(request._id, request);
		}
		const prayed = new Set(prayers.map((p) => `${p.requestId} ${p.date}`));
		const marksOf = new Map<Id<'requests'>, YMD[]>();
		for (const p of prayers) {
			let marks = marksOf.get(p.requestId);
			if (!marks) marksOf.set(p.requestId, (marks = []));
			marks.push(p.date);
		}

		const days = new Map<YMD, DayItem[]>();
		const add = (date: YMD, request: Doc<'requests'>, scheduled: boolean, skipped: boolean) => {
			let items = days.get(date);
			if (!items) days.set(date, (items = []));
			items.push({
				requestId: request._id,
				title: request.title,
				prayed: prayed.has(`${request._id} ${date}`),
				scheduled,
				skipped,
				recurring: request.rrule !== undefined,
				answeredOn: request.answeredOn ?? null
			});
		};
		const ordered = [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
		for (const request of ordered) {
			const skips = new Set(request.skipDates);
			const scheduled = new Set(occurrences(request, from, to, { includeSkipped: true }));
			for (const date of scheduled) add(date, request, true, skips.has(date));
			for (const date of marksOf.get(request._id) ?? [])
				if (!scheduled.has(date)) add(date, request, false, false);
		}
		return [...days.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([date, items]) => ({ date, items }));
	}
});
