<script lang="ts">
	import type { Snippet } from 'svelte';
	import { setupAuth } from 'convex-svelte';
	import { useClerkContext } from 'svelte-clerk/client';

	// Hands Clerk's session to Convex: the token comes from Clerk's "convex" JWT template. From Jairus, without
	// the server-rendering half (this app renders in the browser only).
	let { children }: { children: Snippet } = $props();

	const clerk = useClerkContext();
	const loaded = new Promise<void>((resolve) => {
		$effect(() => {
			if (clerk.isLoaded) resolve();
		});
	});

	setupAuth(() => ({
		isLoading: !clerk.isLoaded,
		isAuthenticated: Boolean(clerk.session),
		fetchAccessToken: async () => {
			await loaded;
			return (await clerk.session?.getToken({ template: 'convex' })) ?? null;
		}
	}));
</script>

<!-- Convex's auth state is this component's context: everything that reads it goes inside. -->
{@render children()}
