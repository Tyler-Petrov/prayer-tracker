<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { UserButton } from 'svelte-clerk/client';
	import Settings from '@lucide/svelte/icons/settings';
	import { clerkAppearance } from '#lib/clerk-appearance.js';

	/** Size of the avatar, in CSS. */
	let { size = '1.75rem' }: { size?: string } = $props();

	const appearance = $derived({
		...clerkAppearance,
		// rootBox through appearance, not a `.cl-rootBox` selector: Clerk warns about structural CSS.
		elements: {
			...clerkAppearance.elements,
			rootBox: { display: 'flex' },
			avatarBox: { width: size, height: size }
		}
	});
</script>

<!-- Clerk's account menu, with Settings in it (opened in-app, so the page doesn't reload). -->
<UserButton {appearance}>
	<UserButton.MenuItems>
		<UserButton.Action
			label="Settings"
			labelIcon={settingsIcon}
			onclick={() => goto(resolve('/settings'))}
		/>
		<UserButton.Action label="manageAccount" />
		<UserButton.Action label="signOut" />
	</UserButton.MenuItems>
</UserButton>

{#snippet settingsIcon()}
	<Settings class="size-4" />
{/snippet}
