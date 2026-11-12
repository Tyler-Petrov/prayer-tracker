<script lang="ts">
	import type { Snippet } from 'svelte';
	import { navigating, page } from '$app/state';
	import { resolve } from '$app/paths';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import HandHeart from '@lucide/svelte/icons/hand-heart';
	import { api } from '#convex/_generated/api.js';
	import { convexQuery } from '#lib/convex-query.svelte.js';
	import { daysView } from '#lib/days-view.svelte.js';
	import { daysArgs, requestsArgs } from '#lib/tab-queries.js';
	import { today } from '#lib/today.svelte.js';
	import { cn } from '#lib/utils.js';
	import AccountButton from './account-button.svelte';

	let { children }: { children: Snippet } = $props();

	// Keep each tab's default view subscribed (convexQuery's shared cache), so switching to it finds the
	// answer already here and the page's `await` doesn't wait. The Days tab's are the days around today and
	// those around where it was left (the same query when that's today).
	const preloads = $derived([
		convexQuery(api.days.range, daysArgs(today.current)),
		convexQuery(api.days.range, daysView.range),
		convexQuery(api.requests.list, requestsArgs(today.current)),
		convexQuery(api.users.me, {})
	]);
	// Read, so the deriveds (and with them the subscriptions) stay alive.
	$effect(() => void preloads);

	const tabs = [
		{ href: resolve('/'), label: 'Days', icon: CalendarDays },
		{ href: resolve('/requests'), label: 'Requests', icon: HandHeart }
	];

	// The tab being navigated to lights up on click, not when its page has rendered.
	const path = $derived((navigating.to?.url ?? page.url).pathname);

	function isActive(href: string) {
		return href === resolve('/') ? path === href : path.startsWith(href);
	}
</script>

<div class="min-h-dvh md:grid md:grid-cols-[13rem_1fr]">
	<nav
		aria-label="Main"
		data-sveltekit-preload-code="eager"
		class="sticky top-0 hidden h-dvh flex-col gap-1 border-r border-border bg-sidebar p-3 md:flex"
	>
		<a href={resolve('/')} class="mb-6 px-3 pt-2 font-display text-xl text-candle">Prayer Tracker</a
		>
		{#each tabs as tab (tab.href)}
			<a
				href={tab.href}
				aria-current={isActive(tab.href) ? 'page' : undefined}
				class={cn(
					'flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
					isActive(tab.href) && 'bg-accent text-foreground'
				)}
			>
				<tab.icon class={cn('size-4', isActive(tab.href) && 'text-candle')} />
				{tab.label}
			</a>
		{/each}
		<!-- The account menu, which holds Settings. -->
		<div class="mt-auto flex justify-end px-2 py-1">
			<AccountButton />
		</div>
	</nav>

	<main class="min-w-0 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">
		{@render children()}
	</main>

	<!-- In the installed app the page runs under the status bar (viewport-fit=cover): keep what scrolls up from
	     showing through it. Nothing on a desktop or in a browser tab, where the inset is 0. -->
	<div
		aria-hidden="true"
		class="pointer-events-none fixed inset-x-0 top-0 z-30 h-[env(safe-area-inset-top)] bg-background/95 backdrop-blur md:hidden"
	></div>

	<nav
		aria-label="Main"
		data-sveltekit-preload-code="eager"
		class="fixed inset-x-0 bottom-0 z-40 grid h-[calc(4.5rem+env(safe-area-inset-bottom))] grid-cols-3 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
	>
		{#each tabs as tab (tab.href)}
			<a
				href={tab.href}
				aria-current={isActive(tab.href) ? 'page' : undefined}
				class={cn(
					'flex flex-col items-center justify-center gap-1 py-2.5 text-[0.7rem] text-muted-foreground',
					isActive(tab.href) && 'text-foreground'
				)}
			>
				<tab.icon class={cn('size-5', isActive(tab.href) && 'text-candle')} />
				{tab.label}
			</a>
		{/each}
		<!-- The account menu, which holds Settings. -->
		<div
			class={cn(
				'flex flex-col items-center justify-center gap-1 py-2.5 text-[0.7rem] text-muted-foreground',
				isActive(resolve('/settings')) && 'text-foreground'
			)}
		>
			<!-- The same box as the tab icons, so the labels line up. -->
			<div class="flex size-5 items-center justify-center">
				<AccountButton size="1.5rem" />
			</div>
			Account
		</div>
	</nav>
</div>
