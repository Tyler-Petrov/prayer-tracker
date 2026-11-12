<script lang="ts">
	import { page } from '$app/state';
	import { SignIn } from 'svelte-clerk/client';
	import { clerkAppearance } from '#lib/clerk-appearance.js';

	/** Where they were going, without Clerk's own #/… steps. */
	const returnTo = $derived(page.url.origin + page.url.pathname + page.url.search);
</script>

<svelte:head>
	<title>Sign in · Prayer Tracker</title>
</svelte:head>

<main class="flex min-h-dvh flex-col items-center justify-center gap-6 p-4">
	<h1 class="text-3xl text-candle">Prayer Tracker</h1>
	<!-- Google only, set in the Clerk dashboard. Hash routing: the Google round trip comes back to this same page, wherever the person was going.
	     withSignUp: a first-time Google account finishes signing up right here too. -->
	<SignIn
		routing="hash"
		withSignUp
		forceRedirectUrl={returnTo}
		signUpForceRedirectUrl={returnTo}
		appearance={clerkAppearance}
	/>
</main>
