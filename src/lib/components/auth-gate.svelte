<script lang="ts">
	import type { Snippet } from 'svelte';
	import { useAuth } from 'convex-svelte';

	/** Which of the layout's views shows, by Convex's view of the sign-in (it waits for the token to be accepted). */
	let { loading, signIn, app }: { loading: Snippet; signIn: Snippet; app: Snippet } = $props();

	const auth = useAuth();
</script>

{#if auth.isLoading}
	{@render loading()}
{:else if !auth.isAuthenticated}
	{@render signIn()}
{:else}
	{@render app()}
{/if}
