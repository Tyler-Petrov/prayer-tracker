// The Overview tab: how praying and Bible reading have gone, in a few numbers.
import { ConvexError, v } from 'convex/values';
import { assertDate, userQuery } from './functions';
import { requestView } from './model/requests';
import { addDays } from './shared/weeks';
import type { YMD } from './shared/recurrence';

/** Days the prayed strip and the streak look back over, today included. */
export const OVERVIEW_DAYS = 30;
/** Requests read, latest-ending first: the Requests list's cap. More than this and the counts leave the oldest out. */
const REQUESTS_MAX = 1000;
/** Prayed marks read for OVERVIEW_DAYS: about 66 a day, as on Days. Past it the query fails rather than undercount. */
const PRAYERS_MAX = 2000;
const PLANS_MAX = 100;
/** Answered requests listed, latest first. */
const RECENT_ANSWERED = 3;

/**
 * The caller's numbers as of `today` (their local day). Prayer: requests answered (ever, and this calendar
 * year) and the latest few, requests still happening (`praying`), and for the last OVERVIEW_DAYS days which were
 * marked prayed (`days`, oldest first), how many, and the run of them up to today (`streak`; today not yet
 * prayed doesn't break it). `streakFull` says the run reaches back past the window. Bible reading: chapters
 * checked off across the plans they have, and the books finished (latest first).
 */
export const stats = userQuery({
	args: { today: v.string() },
	handler: async (ctx, { today }) => {
		assertDate(today);
		const requests = await ctx.db
			.query('requests')
			.withIndex('by_userId_and_lastDate', (q) => q.eq('userId', ctx.userId))
			.order('desc')
			.take(REQUESTS_MAX + 1);
		const capped = requests.length > REQUESTS_MAX;
		if (capped) requests.pop();
		const answered = requests
			.filter((r) => r.answeredOn)
			.sort((a, b) => b.answeredOn!.localeCompare(a.answeredOn!));
		const yearStart = `${today.slice(0, 4)}-01-01`;
		const praying = requests.filter((r) => requestView(r, today).section === 'active').length;

		const from = addDays(today, 1 - OVERVIEW_DAYS);
		const prayers = await ctx.db
			.query('prayers')
			.withIndex('by_userId_and_date', (q) =>
				q.eq('userId', ctx.userId).gte('date', from).lte('date', today)
			)
			.take(PRAYERS_MAX + 1);
		if (prayers.length > PRAYERS_MAX)
			throw new ConvexError('Too many prayed marks in the last month to count them');
		const prayed = new Set(prayers.map((p) => p.date));
		const days: { date: YMD; prayed: boolean }[] = [];
		for (let i = 0; i < OVERVIEW_DAYS; i++) {
			const date = addDays(from, i);
			days.push({ date, prayed: prayed.has(date) });
		}
		let streak = 0;
		for (let i = days.length - (prayed.has(today) ? 1 : 2); i >= 0 && days[i].prayed; i--) streak++;
		const streakFull = streak > 0 && streak >= days.length - (prayed.has(today) ? 0 : 1);

		const plans = await ctx.db
			.query('readingPlans')
			.withIndex('by_userId', (q) => q.eq('userId', ctx.userId))
			.take(PLANS_MAX);
		const finished = plans
			.filter((p) => p.chaptersTotal > 0 && p.chaptersRead >= p.chaptersTotal)
			.sort((a, b) => b.updatedAt - a.updatedAt);

		return {
			answered: answered.length,
			answeredThisYear: answered.filter((r) => r.answeredOn! >= yearStart && r.answeredOn! <= today)
				.length,
			recentAnswered: answered.slice(0, RECENT_ANSWERED).map((r) => ({
				requestId: r._id,
				title: r.title,
				answeredOn: r.answeredOn!
			})),
			praying,
			days,
			daysPrayed: prayed.size,
			streak,
			streakFull,
			chaptersRead: plans.reduce((sum, p) => sum + p.chaptersRead, 0),
			booksFinished: finished.map((p) => p.book),
			/** More requests than were read: the counts leave the oldest out. */
			requestsCapped: capped
		};
	}
});
