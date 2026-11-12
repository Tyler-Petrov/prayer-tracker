<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import CircleX from '@lucide/svelte/icons/circle-x';
	import { useClerkContext } from 'svelte-clerk/client';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';

	// Redeems a sign-in link from scripts/sign-in.mjs (a Clerk sign-in token), then goes on to where the link
	// points (?url=, only ever on this site). From Jairus. The layout shows this page outside its sign-in gate.
	const clerk = useClerkContext();
	let failed = $state<string>();
	let started = false;

	const successUrl = $derived.by(() => {
		const url = new URL(page.url.searchParams.get('url') ?? '/', page.url.origin);
		return url.origin === page.url.origin ? url.href : '/';
	});

	$effect(() => {
		if (clerk.isLoaded && !started) {
			started = true;
			signIn();
		}
	});

	async function signIn() {
		try {
			// Whoever's signed in now goes first, so the browser ends up as the link's person.
			if (clerk.session) await clerk.clerk?.signOut({ redirectUrl: page.url.href });
			const attempt = await clerk.clerk?.client?.signIn.create({
				strategy: 'ticket',
				ticket: page.params.token ?? ''
			});
			if (attempt?.status !== 'complete' || !attempt.createdSessionId) {
				failed = "The sign-in couldn't be completed.";
				return;
			}
			await clerk.clerk?.setActive({ session: attempt.createdSessionId });
			await goto(successUrl, { replace: true });
		} catch (error) {
			failed =
				error instanceof Error ? error.message : 'This sign-in link is invalid or has expired.';
		}
	}
</script>

<svelte:head>
	<title>Signing in</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="flex min-h-dvh items-center justify-center p-4">
	<Empty.Root>
		<Empty.Header>
			<Empty.Media variant="icon">
				{#if failed}
					<CircleX />
				{:else}
					<Spinner />
				{/if}
			</Empty.Media>
			<Empty.Title>{failed ? "Couldn't sign you in" : 'Signing you in…'}</Empty.Title>
			{#if failed}
				<Empty.Description>{failed}</Empty.Description>
			{/if}
		</Empty.Header>
	</Empty.Root>
</main>
