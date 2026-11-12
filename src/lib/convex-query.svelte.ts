// Convex queries you can `await` in a component: the first answer once, then live updates, shared by
// everything asking for the same query and args. From Jairus.
import type { ConvexClient } from 'convex/browser';
import { useConvexClient } from 'convex-svelte';
import { getFunctionName, type FunctionReference } from 'convex/server';
import { convexToJson } from 'convex/values';
import { createContext, tick } from 'svelte';
import { cacheResource, type Cache } from './cache.svelte';

export class ConvexQuery<
	Query extends FunctionReference<'query', 'public'>,
	QueryResult = Query['_returnType']
> {
	unsubscribe: (() => void) | undefined = undefined;
	initialized = $state(false);
	/** Convex ends a subscription that errors: the next ask for this query makes a fresh one (convexQuery). */
	failed = false;
	#args: Query['_args'];

	#promise: Promise<QueryResult>;
	#current: Query['_returnType'] | undefined = $state.raw(undefined);

	constructor({ query, args }: { query: Query; args: Query['_args'] }) {
		const client = useConvexClient();

		this.#args = args;

		// The app renders only in the browser (+layout.ts), so the browser client always answers.
		const initialQuery = async () => {
			try {
				const result = await client.query(query, this.#args);
				this.#current = result;
				return result;
			} finally {
				this.initialized = true;
			}
		};
		this.#promise = $state.raw(initialQuery());

		this.unsubscribe = client.onUpdate(
			query,
			this.#args,
			(result: Query['_returnType']) => {
				// The first value is resolved by the promise, so we don't need to update the query here
				if (!this.initialized) return;

				this.#current = result;
				this.#promise = Promise.resolve(result);
			},
			async (error) => {
				this.failed = true;
				this.#current = undefined;
				this.#promise = Promise.reject(error);
			}
		);
	}

	#then = $derived.by(() => {
		const promise = this.#promise;

		return async (resolve: (value: QueryResult) => void, reject: (reason: unknown) => void) => {
			const result = promise.then(tick).then(() => this.#current as QueryResult);

			if (resolve || reject) {
				return result.then(resolve, reject);
			}

			return result;
		};
	});

	get then() {
		return this.#then;
	}

	get current() {
		return this.#current;
	}

	get isLoading() {
		return !this.initialized;
	}
}

export function generateCacheKey<Query extends FunctionReference<'query', 'public'>>(
	query: Query,
	args: Query['_args']
) {
	try {
		convexToJson(args);
	} catch {
		const argsTypes = Object.fromEntries(
			Object.entries(args).map(([key, value]) => [key, typeof value])
		);
		throw new Error(
			`Invalid arguments for query ${getFunctionName(query)}: ${JSON.stringify(argsTypes)}`
		);
	}
	return `${getFunctionName(query)}-${JSON.stringify(args)}`;
}

export function convexQuery<Query extends FunctionReference<'query', 'public'>>(
	query: Query,
	args: Query['_args']
) {
	return cacheResource(
		getConvexQueryCache() as unknown as Cache<ConvexQuery<Query>>,
		generateCacheKey(query, args),
		() => new ConvexQuery<Query>({ query, args }),
		{
			unsubscribe: (entry) => entry.resource.unsubscribe?.(),
			// One that errored never recovers: a boundary's "Try again" (or the next page) starts it over.
			shouldRecompute: (entry) => entry.resource.failed
		}
	);
}

/**
 * Starts a query before the page that awaits it mounts (on hover, or as a tap starts), holding it for a
 * few seconds: the page's own request then joins this one, or finds the answer already in the client.
 */
export function prefetchQuery<Query extends FunctionReference<'query', 'public'>>(
	client: ConvexClient,
	query: Query,
	args: Query['_args'],
	holdMs = 5000
) {
	const unsubscribe = client.onUpdate(
		query,
		args,
		() => {},
		() => {}
	);
	setTimeout(unsubscribe, holdMs);
}

/** Every query in use, set up once in the root layout. */
type AnyQuery = ConvexQuery<FunctionReference<'query', 'public'>, unknown>;
export const [getConvexQueryCache, setConvexQueryCache] = createContext<Cache<AnyQuery>>();
