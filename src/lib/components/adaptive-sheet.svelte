<script lang="ts">
	import type { Snippet } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as Drawer from '#lib/components/ui/drawer/index.js';
	import { keyboard } from '#lib/keyboard.svelte.js';

	let {
		open = $bindable(false),
		title,
		description,
		children,
		footer,
		tall = false
	}: {
		open: boolean;
		title: string;
		description?: string;
		children: Snippet;
		footer?: Snippet;
		/** Always 80% of the screen tall, so a list that grows or shrinks doesn't resize it. */
		tall?: boolean;
	} = $props();

	const desktop = new MediaQuery('min-width: 768px');

	// With the keyboard up, the drawer sits on top of it and fits in what's left of the screen, so the header and
	// the field being typed in stay visible and the body scrolls. Browsers either shrink only the visual viewport
	// (the keyboard covers the page: `inset`) or the whole page (`height` shrinks and `80vh` may not), so both are
	// handled. Vaul's own handling of this (`repositionInputs`) kept the drawer as tall as it was before the
	// keyboard opened, and on Android pushed its top off the screen.
	let drawer = $state<HTMLElement | null>(null);
	const phone = $derived(open && !desktop.current);
	const inset = $derived(phone ? keyboard.inset : 0);
	const height = $derived(phone ? keyboard.height : 0);
	const fitted = $derived(
		phone
			? [
					`max-height: min(80vh, calc(${height}px - env(safe-area-inset-top) - 0.5rem))`,
					inset && `bottom: ${inset}px; padding-bottom: 0`
				]
					.filter(Boolean)
					.join('; ')
			: undefined
	);

	$effect(() => {
		if (!height) return;
		const focused = document.activeElement;
		if (focused instanceof HTMLElement && drawer?.contains(focused)) {
			focused.scrollIntoView({ block: 'nearest' });
		}
	});
</script>

{#if desktop.current}
	<Dialog.Root bind:open>
		<!-- Anchored to the top, not centered, so the dialog stays put as its content grows or shrinks.
		     The header stays while the body scrolls. -->
		<Dialog.Content
			class={[
				'top-[10dvh] flex max-h-[85dvh] translate-y-0 flex-col overflow-hidden',
				tall && 'h-[80dvh]'
			]}
		>
			<Dialog.Header>
				<Dialog.Title class="font-display text-xl">{title}</Dialog.Title>
				{#if description}
					<Dialog.Description>{description}</Dialog.Description>
				{/if}
			</Dialog.Header>
			<div class="-mx-6 -my-1 min-h-0 flex-1 overflow-y-auto px-6 py-1">{@render children()}</div>
			{#if footer}
				<Dialog.Footer>{@render footer()}</Dialog.Footer>
			{/if}
		</Dialog.Content>
	</Dialog.Root>
{:else}
	<Drawer.Root bind:open repositionInputs={false}>
		<Drawer.Content
			bind:ref={drawer}
			class={['pb-[env(safe-area-inset-bottom)]', tall && 'h-[80dvh]']}
			style={fitted}
		>
			<Drawer.Header>
				<Drawer.Title class="font-display text-xl">{title}</Drawer.Title>
				{#if description}
					<Drawer.Description>{description}</Drawer.Description>
				{/if}
			</Drawer.Header>
			<div class="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{@render children()}</div>
			{#if footer}
				<Drawer.Footer class="border-t border-border">{@render footer()}</Drawer.Footer>
			{/if}
		</Drawer.Content>
	</Drawer.Root>
{/if}
