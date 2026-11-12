import { customCtx, customMutation, customQuery } from 'convex-helpers/server/customFunctions';
import { ConvexError } from 'convex/values';
import type { Doc, Id, TableNames } from './_generated/dataModel';
import { mutation, query, type QueryCtx } from './_generated/server';
import { isDate } from './shared/recurrence';

/** Signed in with Clerk, in any function (actions too): the token's identity, or "Not signed in". */
export async function requireIdentity(ctx: { auth: QueryCtx['auth'] }) {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) throw new ConvexError('Not signed in');
	return identity;
}

/**
 * The one place a caller's user is resolved. It's made on their first sign-in (users.ensure), which the app
 * waits for before showing anything.
 */
export async function requireUser(ctx: QueryCtx) {
	const { tokenIdentifier } = await requireIdentity(ctx);
	const user = await ctx.db
		.query('users')
		.withIndex('by_tokenIdentifier', (q) => q.eq('tokenIdentifier', tokenIdentifier))
		.unique();
	if (!user) throw new ConvexError('Not signed in');
	return { userId: user._id, user };
}

/** Public functions for signed-in users: `ctx.userId` (and `ctx.user`) are the caller's. */
export const userQuery = customQuery(query, customCtx(requireUser));
export const userMutation = customMutation(mutation, customCtx(requireUser));

type UserTable = {
	[T in TableNames]: Doc<T> extends { userId: Id<'users'> } ? T : never;
}[TableNames];

/** A document of the caller's, or "Not found" if it is missing or someone else's. */
export async function getOwned<T extends UserTable>(
	ctx: QueryCtx,
	userId: Id<'users'>,
	table: T,
	id: Id<T>
) {
	const doc = await ctx.db.get(table, id);
	if (!doc || doc.userId !== userId) throw new ConvexError('Not found');
	return doc;
}

/** Dates are the client's local calendar days, YYYY-MM-DD. Queries never read the clock. */
export function assertDate(date: string) {
	if (!isDate(date)) throw new ConvexError(`Bad date ${date}; use YYYY-MM-DD`);
}
