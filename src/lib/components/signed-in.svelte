<script lang="ts">
	import type { Snippet } from 'svelte';
	import { useConvexClient } from 'convex-svelte';
	import { api } from '#convex/_generated/api.js';
	import { errorMessage } from '#lib/errors.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';

	let { children }: { children: Snippet } = $props();

	// Nothing renders (and so no query runs) until the caller's user exists: made on their first sign-in.
	const client = useConvexClient();
	let ready = $state(false);
	let failed = $state<string>();

	function ensure() {
		failed = undefined;
		client
			.mutation(api.users.ensure, {})
			.then(() => (ready = true))
			.catch((error: unknown) => (failed = errorMessage(error)));
	}
	ensure();
</script>

{#if ready}
	{@render children()}
{:else if failed}
	<div class="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
		<p class="text-muted-foreground">Couldn't set up your account: {failed}</p>
		<Button variant="outline" class="h-11 px-4" onclick={ensure}>Try again</Button>
	</div>
{:else}
	<div class="flex min-h-dvh items-center justify-center">
		<Spinner class="size-6 text-muted-foreground" />
	</div>
{/if}
