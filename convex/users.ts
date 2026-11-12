// Who's signed in, as the app knows them. Clerk does the signing in (Google only); this makes each person's user
// the first time, and the app waits for it before showing anything.
import { mutation } from './_generated/server';
import { requireIdentity, userMutation, userQuery } from './functions';
import { vWeekStart } from './schema';

/** The caller's user, made on their first sign-in. */
export const ensure = mutation({
	args: {},
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		const known = await ctx.db
			.query('users')
			.withIndex('by_tokenIdentifier', (q) => q.eq('tokenIdentifier', identity.tokenIdentifier))
			.unique();
		const email = identity.email?.trim().toLowerCase();
		if (known) {
			if (email && known.email !== email) await ctx.db.patch('users', known._id, { email });
			return known._id;
		}
		return ctx.db.insert('users', { tokenIdentifier: identity.tokenIdentifier, email });
	}
});

/** The caller's settings. */
export const me = userQuery({
	args: {},
	handler: async (ctx) => ({
		email: ctx.user.email ?? null,
		weekStart: ctx.user.weekStart ?? 'SU'
	})
});

/** Which day weeks start on: the Days tab's week dividers and new weekly rules' WKST. */
export const setWeekStart = userMutation({
	args: { weekStart: vWeekStart },
	handler: async (ctx, { weekStart }) => {
		await ctx.db.patch('users', ctx.userId, { weekStart });
	}
});
