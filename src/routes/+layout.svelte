<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import { PUBLIC_CLERK_PUBLISHABLE_KEY, PUBLIC_CONVEX_URL } from '$app/env/public';
	import { page } from '$app/state';
	import { setupConvex } from 'convex-svelte';
	import { ClerkProvider } from 'svelte-clerk';
	import AuthGate from '#lib/components/auth-gate.svelte';
	import ConvexClerk from '#lib/components/convex-clerk.svelte';
	import SignedIn from '#lib/components/signed-in.svelte';
	import { setConvexQueryCache } from '#lib/convex-query.svelte.js';
	import { Toaster } from '#lib/components/ui/sonner/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import AppShell from '#lib/components/app-shell.svelte';
	import SignIn from './sign-in.svelte';
	import type { Snippet } from 'svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	setupConvex(PUBLIC_CONVEX_URL);
	setConvexQueryCache(new Map());
	// A sign-in link's page (scripts/sign-in.mjs) changes who's signed in itself, so it stays out of the gate: the
	// gate switching views partway would start it over, and its token only works once.
	const isSignInLink = $derived(page.route.id === '/sign-in-token/[token]');
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{#snippet loading()}
	<div class="flex min-h-dvh items-center justify-center">
		<Spinner class="size-6 text-muted-foreground" />
	</div>
{/snippet}

<!-- Pages can `await` their queries (convexQuery). The first load shows `pending`; after that, a
     navigation keeps the current page up until the next one's awaits are ready, so pages never flash
     half-loaded. Inside the shell, so the rail stays put meanwhile. -->
{#snippet awaited(content: Snippet)}
	<svelte:boundary onerror={console.error}>
		{@render content()}
		{#snippet pending()}
			{@render loading()}
		{/snippet}
		{#snippet failed(error, reset)}
			<div class="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
				<p class="text-muted-foreground">
					Something went wrong{error instanceof Error ? `: ${error.message}` : ''}
				</p>
				<button
					type="button"
					class="text-candle underline-offset-4 hover:underline"
					onclick={reset}
				>
					Try again
				</button>
			</div>
		{/snippet}
	</svelte:boundary>
{/snippet}

<!-- Sign-in and sign-up both happen in the app (sign-in.svelte, shown wherever a signed-out person is), never on
     Clerk's hosted pages: those won't send people back to an origin they don't know, and leaving mid-load breaks the
     Google round trip. -->
<ClerkProvider
	publishableKey={PUBLIC_CLERK_PUBLISHABLE_KEY}
	allowedRedirectOrigins={[location.origin]}
	signInUrl="/"
	signUpUrl="/"
>
	<ConvexClerk>
		{#if isSignInLink}
			{@render awaited(children)}
		{:else}
			<AuthGate {loading} signIn={signInPage} {app} />
		{/if}
	</ConvexClerk>
</ClerkProvider>

{#snippet signInPage()}
	{@render awaited(signIn)}
{/snippet}

{#snippet app()}
	{#snippet signedIn()}
		<SignedIn><AppShell>{@render children()}</AppShell></SignedIn>
	{/snippet}
	{@render awaited(signedIn)}
{/snippet}

{#snippet signIn()}
	<SignIn />
{/snippet}

<Toaster position="top-center" />
