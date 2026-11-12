<script lang="ts">
	import type { Snippet } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as Drawer from '#lib/components/ui/drawer/index.js';

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
	<Drawer.Root bind:open>
		<Drawer.Content class={['pb-[env(safe-area-inset-bottom)]', tall && 'h-[80dvh]']}>
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
