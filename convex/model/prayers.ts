import type { Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type { YMD } from '../shared/recurrence';

/**
 * Marks `request` prayed on `date`, or clears the mark, keeping its `prayedCount` and `lastPrayedOn` in step.
 * Idempotent: setting what's already there changes nothing.
 */
export async function setPrayed(
	ctx: MutationCtx,
	request: Doc<'requests'>,
	date: YMD,
	prayed: boolean
) {
	const existing = await ctx.db
		.query('prayers')
		.withIndex('by_requestId_and_date', (q) => q.eq('requestId', request._id).eq('date', date))
		.unique();
	if (prayed === !!existing) return;
	if (prayed) {
		await ctx.db.insert('prayers', { userId: request.userId, requestId: request._id, date });
		await ctx.db.patch('requests', request._id, {
			prayedCount: request.prayedCount + 1,
			lastPrayedOn:
				request.lastPrayedOn && request.lastPrayedOn > date ? request.lastPrayedOn : date
		});
		return;
	}
	await ctx.db.delete('prayers', existing!._id);
	const latest =
		request.lastPrayedOn === date
			? await ctx.db
					.query('prayers')
					.withIndex('by_requestId_and_date', (q) => q.eq('requestId', request._id))
					.order('desc')
					.first()
			: undefined;
	await ctx.db.patch('requests', request._id, {
		prayedCount: Math.max(0, request.prayedCount - 1),
		lastPrayedOn: latest === undefined ? request.lastPrayedOn : latest?.date
	});
}
