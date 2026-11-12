// Marking a request prayed on a day.
import { v } from 'convex/values';
import { assertDate, getOwned, userMutation } from './functions';
import { setPrayed } from './model/prayers';

/**
 * Prayed for `requestId` on `date` (`prayed: true`), or not. Sets rather than toggles, so a repeated tap or an
 * optimistic retry lands where the person meant. Any day works, scheduled or not: an unscheduled day's mark
 * shows on that day too (days.range `scheduled: false`).
 */
export const set = userMutation({
	args: { requestId: v.id('requests'), date: v.string(), prayed: v.boolean() },
	returns: v.null(),
	handler: async (ctx, { requestId, date, prayed }) => {
		assertDate(date);
		const request = await getOwned(ctx, ctx.userId, 'requests', requestId);
		await setPrayed(ctx, request, date, prayed);
		return null;
	}
});
