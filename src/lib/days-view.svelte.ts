import { daysArgs } from '#lib/tab-queries.js';
import { today } from '#lib/today.svelte.js';

type Spot = { day: string; top: number };
type Kept = Spot & { on: string };

/** Where the spot is kept for this tab, so a reload opens there too. */
const KEY = 'days-view';

/**
 * Where the Days tab was left: the row at the top of the screen and how far up it sat. Arriving on it
 * any way but a `?day=` link opens there, not on today. It's for the day it was left on: on a new day,
 * it opens on today again. (Meal Tracker's plan-view, which keeps it in memory only; here it's also kept in
 * sessionStorage, so reloading the tab opens where it was too, while a new tab or a fresh launch opens on today.)
 */
class DaysView {
	#spot = $state.raw<Kept | undefined>(read());

	/** The spot to open on, unless it's from an earlier day. */
	get spot(): Spot | undefined {
		return this.#spot?.on === today.current ? this.#spot : undefined;
	}

	/**
	 * The days the tab opens with: those around its spot. The app shell keeps them subscribed, so the
	 * page has them as it opens and can scroll straight there.
	 */
	get range() {
		return daysArgs(this.spot?.day ?? today.current);
	}

	leave(spot: Spot | undefined) {
		this.#spot = spot && { ...spot, on: today.current };
		try {
			if (this.#spot) sessionStorage.setItem(KEY, JSON.stringify(this.#spot));
			else sessionStorage.removeItem(KEY);
		} catch {
			// Storage blocked: it's kept in memory still.
		}
	}
}

function read(): Kept | undefined {
	try {
		const kept: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
		if (
			kept &&
			typeof kept === 'object' &&
			'day' in kept &&
			'top' in kept &&
			'on' in kept &&
			typeof kept.day === 'string' &&
			typeof kept.top === 'number' &&
			typeof kept.on === 'string'
		)
			return { day: kept.day, top: kept.top, on: kept.on };
	} catch {
		// Blocked or garbled: open on today.
	}
	return undefined;
}

export const daysView = new DaysView();
