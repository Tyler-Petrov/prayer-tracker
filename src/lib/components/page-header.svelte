<script lang="ts">
	import type { Snippet } from 'svelte';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import { afterNavigate } from '$app/navigation';

	let {
		title,
		description,
		back,
		actions,
		centerActions = false
	}: {
		title: string;
		description?: string;
		/** A link to the page this one sits under, shown above the title. */
		back?: { href: string; label: string };
		/** Buttons shown on the right, next to the title. */
		actions?: Snippet;
		/** Centers the actions against the whole header (Back, title and description) instead of the top. */
		centerActions?: boolean;
	} = $props();

	// Coming from the page it links to, Back steps back in history instead, so that page is as it was left
	// (where it was scrolled to, say). Opened directly, it's a plain link.
	let from = $state<string>();
	afterNavigate((navigation) => {
		from = navigation.type === 'enter' ? undefined : navigation.from?.url.pathname;
	});

	function onclick(event: MouseEvent) {
		if (!back || from !== new URL(back.href, location.href).pathname) return;
		if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		event.preventDefault();
		history.back();
	}
</script>

<svelte:head>
	<title>{title} · Prayer Tracker</title>
</svelte:head>

<!-- Below the status bar in the installed app (viewport-fit=cover draws the page under it). -->
<header
	class="page-column flex items-start justify-between gap-3 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-4 md:pt-[calc(2.5rem+env(safe-area-inset-top))]"
>
	<div class="min-w-0">
		{#if back}
			<a
				href={back.href}
				{onclick}
				class="mb-1 -ml-1 inline-flex min-h-8 items-center gap-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
			>
				<ChevronLeft class="size-4" />
				{back.label}
			</a>
		{/if}
		<h1 class="truncate text-3xl md:text-4xl">{title}</h1>
		{#if description}
			<p class="mt-1 text-sm text-muted-foreground">{description}</p>
		{/if}
	</div>
	<div class={['flex shrink-0 items-center gap-2', centerActions && 'self-center']}>
		{@render actions?.()}
	</div>
</header>
