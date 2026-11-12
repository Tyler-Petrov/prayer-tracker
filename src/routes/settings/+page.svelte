<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import LogOut from '@lucide/svelte/icons/log-out';
	import { useMutation } from 'convex-svelte';
	import { useClerkContext } from 'svelte-clerk/client';
	import { api } from '#convex/_generated/api.js';
	import type { WeekStart } from '#convex/shared/recurrence.js';
	import PageHeader from '#lib/components/page-header.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';
	import { convexQuery } from '#lib/convex-query.svelte.js';
	import { toastError } from '#lib/errors.js';

	const WEEK_STARTS: { value: WeekStart; label: string }[] = [
		{ value: 'SU', label: 'Sunday' },
		{ value: 'MO', label: 'Monday' }
	];

	const clerk = useClerkContext();
	const me = $derived(await convexQuery(api.users.me, {}));
	const saveWeekStart = useMutation(api.users.setWeekStart);

	function setWeekStart(weekStart: string) {
		if (weekStart !== 'SU' && weekStart !== 'MO') return; // a second tap on the chosen one clears it
		saveWeekStart(
			{ weekStart },
			{
				optimisticUpdate: (store) => {
					const current = store.getQuery(api.users.me, {});
					if (current) store.setQuery(api.users.me, {}, { ...current, weekStart });
				}
			}
		).catch(toastError);
	}

	async function signOut() {
		await clerk.clerk?.signOut();
		await goto(resolve('/'));
	}
</script>

<PageHeader title="Settings" />

<div class="page-column flex flex-col gap-5 pb-10">
	<Card.Root>
		<Card.Header>
			<Card.Title class="font-display text-xl">Days</Card.Title>
		</Card.Header>
		<Card.Content class="gap-6">
			<div class="flex flex-col gap-2">
				<Label id="week-start-label">Weeks start on</Label>
				<ToggleGroup.Root
					type="single"
					variant="outline"
					bind:value={() => me.weekStart, setWeekStart}
					aria-labelledby="week-start-label"
				>
					{#each WEEK_STARTS as option (option.value)}
						<ToggleGroup.Item
							value={option.value}
							class="h-11 min-w-24 px-4 text-muted-foreground data-[state=on]:text-candle"
						>
							{option.label}
						</ToggleGroup.Item>
					{/each}
				</ToggleGroup.Root>
				<p class="text-sm text-muted-foreground">
					Where the Days tab divides weeks, and how "every other week" counts them for new requests.
				</p>
			</div>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="font-display text-xl">Account</Card.Title>
			{#if me.email}
				<Card.Description>Signed in as {me.email}</Card.Description>
			{/if}
		</Card.Header>
		<Card.Content class="gap-6">
			<div>
				<Button variant="outline" class="h-11" onclick={signOut}>
					<LogOut />
					Sign out
				</Button>
			</div>
		</Card.Content>
	</Card.Root>
</div>
