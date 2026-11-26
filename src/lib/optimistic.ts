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
			.filter((day) => day.items.length > 0 || day.readings.length > 0);
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

/**
 * reading.setRead: the reading checked (or not) on every loaded day and plan page, and its plan's chapters read
 * and next reading on the Requests tab. Which reading is next, and how far behind, arrive with the server.
 */
export function optimisticRead(
	reading: { readingId: Id<'readings'>; planId: Id<'readingPlans'>; from: number; to: number },
	read: boolean
) {
	const chapters = reading.to - reading.from + 1;
	return (store: OptimisticLocalStore) => {
		let was: boolean | undefined;
		for (const { args, value } of daysOf(store)) {
			if (!value) continue;
			let changed = false;
			const next = value.map((day) => {
				if (!day.readings.some((r) => r.readingId === reading.readingId)) return day;
				changed = true;
				return {
					...day,
					readings: day.readings.map((r) => {
						if (r.readingId !== reading.readingId) return r;
						was = r.read;
						return { ...r, read };
					})
				};
			});
			if (changed) store.setQuery(api.days.range, args, next);
		}
		for (const { args, value } of store.getAllQueries(api.reading.get)) {
			if (!value || value.planId !== reading.planId) continue;
			was ??= value.readings.find((r) => r.readingId === reading.readingId)?.read;
			const readings = value.readings.map((r) =>
				r.readingId === reading.readingId ? { ...r, read } : r
			);
			const next = readings.find((r) => !r.read);
			store.setQuery(api.reading.get, args, {
				...value,
				readings,
				next: next
					? { readingId: next.readingId, date: next.date, from: next.from, to: next.to }
					: null
			});
		}
		if (was === undefined || was === read) return;
		const change = read ? chapters : -chapters;
		for (const { args, value } of store.getAllQueries(api.reading.list)) {
			if (!value) continue;
			store.setQuery(
				api.reading.list,
				args,
				value.map((plan) =>
					plan.planId === reading.planId
						? { ...plan, chaptersRead: Math.max(0, plan.chaptersRead + change) }
						: plan
				)
			);
		}
		for (const { args, value } of store.getAllQueries(api.reading.get)) {
			if (!value || value.planId !== reading.planId) continue;
			store.setQuery(api.reading.get, args, {
				...value,
				chaptersRead: Math.max(0, value.chaptersRead + change)
			});
		}
	};
}

/** reading.remove: its plan and readings, gone everywhere. */
export function optimisticPlanRemoved(planId: Id<'readingPlans'>) {
	return (store: OptimisticLocalStore) => {
		for (const { args, value } of daysOf(store)) {
			if (!value || !value.some((day) => day.readings.some((r) => r.planId === planId))) continue;
			store.setQuery(
				api.days.range,
				args,
				value
					.map((day) => ({ ...day, readings: day.readings.filter((r) => r.planId !== planId) }))
					.filter((day) => day.items.length > 0 || day.readings.length > 0)
			);
		}
		for (const { args, value } of store.getAllQueries(api.reading.list))
			if (value)
				store.setQuery(
					api.reading.list,
					args,
					value.filter((plan) => plan.planId !== planId)
				);
		for (const { args, value } of store.getAllQueries(api.reading.get))
			if (value?.planId === planId) store.setQuery(api.reading.get, args, null);
	};
}
