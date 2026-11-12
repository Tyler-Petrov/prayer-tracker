// Optimistic updates for the request mutations, as Meal Tracker's plan does it: every loaded copy of a query
// (each days.range window the Days tab and the app shell hold, the Requests list, a request's page) is patched
// at once, so checks and skips don't wait for the server. The server's answer replaces all of it moments later.
//
// Usage: useMutation(api.prayers.set)(args, { optimisticUpdate: optimisticPrayed(requestId, date, true) })
//   .catch(toastError)
import type { OptimisticLocalStore } from 'convex/browser';
import type { FunctionReturnType } from 'convex/server';
import { api } from '#convex/_generated/api.js';
import type { Id } from '#convex/_generated/dataModel.js';

type RequestId = Id<'requests'>;
type Item = FunctionReturnType<typeof api.days.range>[number]['items'][number];

const daysOf = (store: OptimisticLocalStore) => store.getAllQueries(api.days.range);

/** Rewrites the items of `requestId` on the days `on` picks, in every loaded days.range. */
function patchDays(
	store: OptimisticLocalStore,
	requestId: RequestId,
	on: (date: string) => boolean,
	patch: (item: Item, date: string) => Item | null
) {
	for (const { args, value } of daysOf(store)) {
		if (!value) continue;
		let changed = false;
		const next = value
			.map((day) => {
				if (!on(day.date) || !day.items.some((item) => item.requestId === requestId)) return day;
				changed = true;
				const items = day.items.flatMap((item) => {
					if (item.requestId !== requestId) return [item];
					const patched = patch(item, day.date);
					return patched ? [patched] : [];
				});
				return { ...day, items };
			})
			.filter((day) => day.items.length > 0);
		if (changed) store.setQuery(api.days.range, args, next);
	}
}

/** Rewrites `requestId`'s row in the loaded Requests list(s) and its loaded page(s). */
function patchRequest(
	store: OptimisticLocalStore,
	requestId: RequestId,
	patch: <Row extends { requestId: RequestId }>(row: Row) => Row | null
) {
	for (const { args, value } of store.getAllQueries(api.requests.list)) {
		if (!value) continue;
		store.setQuery(api.requests.list, args, {
			...value,
			rows: value.rows.flatMap((row) => {
				if (row.requestId !== requestId) return [row];
				const patched = patch(row);
				return patched ? [patched] : [];
			})
		});
	}
	for (const { args, value } of store.getAllQueries(api.requests.get)) {
		if (!value || args.requestId !== requestId) continue;
		store.setQuery(api.requests.get, args, patch(value));
	}
}

/** Whether it's marked prayed on `date`, as far as anything loaded knows. */
function wasPrayed(store: OptimisticLocalStore, requestId: RequestId, date: string) {
	for (const { value } of daysOf(store))
		for (const day of value ?? [])
			if (day.date === date)
				for (const item of day.items) if (item.requestId === requestId) return item.prayed;
	for (const { args, value } of store.getAllQueries(api.requests.get))
		if (value && args.requestId === requestId) return value.prayedDates.includes(date);
	return undefined;
}

/** prayers.set */
export function optimisticPrayed(requestId: RequestId, date: string, prayed: boolean) {
	return (store: OptimisticLocalStore) => {
		const was = wasPrayed(store, requestId, date);
		patchDays(
			store,
			requestId,
			(d) => d === date,
			(item) => ({ ...item, prayed })
		);
		if (was === prayed) return;
		patchRequest(store, requestId, (row) => {
			const r = row as typeof row & {
				prayedCount: number;
				lastPrayedOn: string | null;
				prayedDates?: string[];
			};
			const prayedDates = r.prayedDates && {
				prayedDates: prayed
					? [...r.prayedDates, date].sort().reverse()
					: r.prayedDates.filter((d) => d !== date)
			};
			const lastPrayedOn = prayed
				? r.lastPrayedOn && r.lastPrayedOn > date
					? r.lastPrayedOn
					: date
				: r.lastPrayedOn === date
					? (prayedDates?.prayedDates[0] ?? r.lastPrayedOn)
					: r.lastPrayedOn;
			return {
				...row,
				prayedCount: Math.max(0, r.prayedCount + (prayed ? 1 : -1)),
				lastPrayedOn,
				...prayedDates
			};
		});
	};
}

/** requests.skip: the day stays, flagged `skipped` (and no longer prayed), so it can be brought back. */
export function optimisticSkipped(requestId: RequestId, date: string, skipped: boolean) {
	return (store: OptimisticLocalStore) => {
		const was = skipped ? wasPrayed(store, requestId, date) : false;
		patchDays(
			store,
			requestId,
			(d) => d === date,
			(item) => ({ ...item, skipped, prayed: skipped ? false : item.prayed })
		);
		patchRequest(store, requestId, (row) => {
			const r = row as typeof row & {
				nextDate: string | null;
				skipDates?: string[];
				upcoming?: string[];
				prayedCount: number;
			};
			const next: Record<string, unknown> = {};
			if (r.skipDates)
				next.skipDates = skipped
					? [...r.skipDates, date].sort()
					: r.skipDates.filter((d) => d !== date);
			if (skipped && r.upcoming) next.upcoming = r.upcoming.filter((d) => d !== date);
			if (skipped && r.nextDate === date)
				next.nextDate = r.upcoming?.find((d) => d !== date) ?? null;
			if (was) next.prayedCount = Math.max(0, r.prayedCount - 1);
			return { ...row, ...next };
		});
	};
}

/** requests.answer: gone from the days after `answeredOn`, and into the Answered section. */
export function optimisticAnswered(requestId: RequestId, answeredOn: string, answerNote?: string) {
	return (store: OptimisticLocalStore) => {
		patchDays(
			store,
			requestId,
			() => true,
			(item, date) => (date > answeredOn && !item.prayed ? null : { ...item, answeredOn })
		);
		patchRequest(store, requestId, (row) => ({
			...row,
			answeredOn,
			answerNote: answerNote?.trim() || null,
			section: 'answered',
			nextDate: null
		}));
	};
}

/**
 * requests.unanswer: only clears the answer; the days it comes back on, and its section, arrive with the
 * server's answer.
 */
export function optimisticUnanswered(requestId: RequestId) {
	return (store: OptimisticLocalStore) => {
		patchDays(
			store,
			requestId,
			() => true,
			(item) => ({ ...item, answeredOn: null })
		);
		patchRequest(store, requestId, (row) => ({ ...row, answeredOn: null, answerNote: null }));
	};
}

/** requests.remove: gone everywhere. */
export function optimisticRemoved(requestId: RequestId) {
	return (store: OptimisticLocalStore) => {
		patchDays(
			store,
			requestId,
			() => true,
			() => null
		);
		patchRequest(store, requestId, () => null);
	};
}
