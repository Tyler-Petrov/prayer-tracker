// A shared cache of live resources, counted by the components using them. From Jairus.
import { tick } from 'svelte';

export type CacheEntry<T> = { count: number; resource: T; closed: boolean };
export type Cache<T> = Map<string, CacheEntry<T>>;

class Entry<T> implements CacheEntry<T> {
	count = 0;
	#closed = $state(false);
	// Read through a derived: a derived doesn't track state made while it runs, so the one that made this entry
	// wouldn't hear it close (ConvexQuery's `#then` likewise).
	#isClosed = $derived(this.#closed);
	resource: T;
	/** Unsubscribed and out of the cache. Read where it's asked for, so a derived still holding it asks again. */
	get closed() {
		return this.#isClosed;
	}
	set closed(closed) {
		this.#closed = closed;
	}
	constructor(resource: T) {
		this.resource = resource;
	}
}

/**
 * Makes what `create` makes outlive whoever asked for it first. Deriveds belong to the effect they're made in, and
 * stop updating once it's destroyed: an entry made by a page's (or the shell's) derived would freeze for everyone
 * sharing it when that page goes (its `#then`, its `closed`), so a later page awaiting it never heard another
 * update. Inside a root of its own, it lives as long as it's referenced. (A root is never torn down with the
 * component it was made in; it only becomes independent of it.)
 */
function detached<T>(create: () => T): T {
	let made: T | undefined;
	$effect.root(() => {
		made = create();
	});
	return made as T;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function removeUnusedCachedValues<T>(
	cache: Cache<T>,
	cacheKey: string,
	entry: CacheEntry<T>,
	unsubscribe?: (entry: CacheEntry<T>) => boolean | undefined | void
) {
	void tick().then(() => {
		if (entry.count === 0 && entry === cache.get(cacheKey)) {
			const shouldDeleteCacheEntry = unsubscribe?.(entry) ?? true;
			if (shouldDeleteCacheEntry) {
				cache.delete(cacheKey);
				entry.closed = true;
			}
		}
	});
}

export function cacheResource<T, R extends T>(
	cache: Cache<R>,
	cacheKey: string,
	resource: () => T,
	options: {
		unsubscribe?: (entry: CacheEntry<T>) => boolean | undefined | void;
		shouldRecompute?: (cachedEntry: CacheEntry<T>) => boolean;
	} = {}
): T {
	let existing: CacheEntry<R> | undefined;
	try {
		existing = cache.get(cacheKey);
	} catch (error) {
		console.error(error);
	}
	const reuse = existing && !options.shouldRecompute?.(existing) ? existing : undefined;
	// The entry this caller uses, new or shared: its count is what this caller adds to and takes from.
	const used: CacheEntry<R> = reuse ?? detached(() => new Entry(resource() as R));

	let tracking = true;
	try {
		// The creator counts from the start, not when this effect runs: an awaiting page's effects wait for its
		// data, and the entry mustn't look unused (and unsubscribe) before then. Others count once mounted.
		// The effect's first run takes over the creator's count; every later run (Svelte runs it again after
		// tearing it down, when the derived it's in is read again) counts afresh, as its teardown took one off.
		let counted = !reuse;
		if (counted) used.count = 1;
		$effect.pre(() => {
			if (counted) counted = false;
			else used.count++;
			return () => {
				// Kept a moment after the last user goes, so the next page can pick it up.
				void wait(400).then(() => {
					used.count--;
					removeUnusedCachedValues(cache, cacheKey, used, options.unsubscribe);
				});
			};
		});
		// A derived can hold an entry past its last count: Svelte tears down the effects in a derived nobody reads
		// for now (an awaiting reader's re-run that's still loading), and that can outlast the 400ms above. If the
		// entry closes meanwhile, this re-runs the derived, which gets a live one. Only where it's counted: an
		// uncounted entry closes as soon as it's answered, and would be asked for again, endlessly.
		void used.closed;
	} catch {
		// Outside a component (an event handler, say): nothing to count it against.
		tracking = false;
		if (!reuse) used.count = 0;
	}

	if (!reuse) {
		cache.set(cacheKey, used);
		const thenable = used.resource as { then?: unknown };
		if (typeof thenable?.then === 'function') {
			(used.resource as PromiseLike<unknown>).then(
				() => removeUnusedCachedValues(cache, cacheKey, used, options.unsubscribe),
				() => {
					// Failed: the next ask starts over. It's only closed if nobody uses it any more; those still
					// showing it hear about the failure through their own await.
					if (cache.get(cacheKey) !== used) return;
					cache.delete(cacheKey);
					if (used.count === 0) options.unsubscribe?.(used);
				}
			);
		} else if (!tracking) {
			removeUnusedCachedValues(cache, cacheKey, used, options.unsubscribe);
		}
	}

	return used.resource;
}
