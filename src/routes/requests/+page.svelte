<script lang="ts">
	import type { Snippet } from 'svelte';
	import { slide } from 'svelte/transition';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import HandHeart from '@lucide/svelte/icons/hand-heart';
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';
	import { api } from '#convex/_generated/api.js';
	import type { RequestView } from '#convex/model/requests.js';
	import PageHeader from '#lib/components/page-header.svelte';
	import RequestEditor from '#lib/components/requests/request-editor.svelte';
	import RequestRow from '#lib/components/requests/request-row.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Collapsible from '#lib/components/ui/collapsible/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import * as InputGroup from '#lib/components/ui/input-group/index.js';
	import { convexQuery } from '#lib/convex-query.svelte.js';
	import { requestsArgs } from '#lib/tab-queries.js';
	import { today } from '#lib/today.svelte.js';
	import { cn } from '#lib/utils.js';

	// Kept subscribed by the app shell, so the tab opens at once.
	const [list, me] = $derived(
		await Promise.all([
			convexQuery(api.requests.list, requestsArgs(today.current)),
			convexQuery(api.users.me, {})
		])
	);
	const requests = $derived(list.rows);

	// The list is one person's, so it's searched here, as typed: sections stay in place while filtering.
	let query = $state('');
	let search = $state('');
	let timer: ReturnType<typeof setTimeout> | undefined;
	function debounceSearch() {
		clearTimeout(timer);
		timer = setTimeout(() => (search = query.trim()), 200);
	}
	function clearSearch() {
		clearTimeout(timer);
		query = '';
		search = '';
	}

	const matches = $derived.by(() => {
		const words = search.toLocaleLowerCase().split(/\s+/).filter(Boolean);
		if (!words.length) return requests;
		return requests.filter((request) => {
			const text = `${request.title} ${request.notes ?? ''}`.toLocaleLowerCase();
			return words.every((word) => text.includes(word));
		});
	});
	const active = $derived(matches.filter((r) => r.section === 'active'));
	const past = $derived(matches.filter((r) => r.section === 'past'));
	const answered = $derived(matches.filter((r) => r.section === 'answered'));

	let pastOpen = $state(false);
	let answeredOpen = $state(true);
	let editorOpen = $state(false);
</script>

<PageHeader title="Requests">
	{#snippet actions()}
		{#if requests.length}
			<Button class="h-11 px-3" onclick={() => (editorOpen = true)}><Plus />New request</Button>
		{/if}
	{/snippet}
</PageHeader>

{#snippet rowList(rows: RequestView[])}
	<ul class="grid gap-2 md:grid-cols-2">
		{#each rows as request (request.requestId)}
			<li transition:slide={{ duration: 200 }}><RequestRow {request} /></li>
		{/each}
	</ul>
{/snippet}

{#snippet folded(
	title: string,
	rows: RequestView[],
	open: boolean,
	setOpen: (open: boolean) => void,
	note: Snippet | undefined
)}
	<!-- While searching, matches show whatever's folded. -->
	<Collapsible.Root open={open || !!search} onOpenChange={setOpen} class="mt-8">
		<Collapsible.Trigger
			class="flex min-h-11 w-full items-center justify-between gap-3 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
		>
			<span class="font-display text-xl">
				{title}
				<span class="font-sans text-base text-muted-foreground">({rows.length})</span>
			</span>
			<ChevronDown
				class={cn(
					'size-5 shrink-0 text-muted-foreground transition-transform',
					(open || search) && 'rotate-180'
				)}
			/>
		</Collapsible.Trigger>
		<Collapsible.Content>
			{@render note?.()}
			<div class="pt-2">{@render rowList(rows)}</div>
		</Collapsible.Content>
	</Collapsible.Root>
{/snippet}

<div class="page-column pb-10">
	{#if !requests.length}
		<Empty.Root class="mt-4 border md:mt-8">
			<Empty.Header>
				<Empty.Media variant="icon"><HandHeart /></Empty.Media>
				<Empty.Title class="font-display text-xl">Nothing to pray for yet</Empty.Title>
				<Empty.Description>
					Add who and what you're praying for, once or on a schedule: every day, every few days, on
					certain weekdays, or monthly.
				</Empty.Description>
			</Empty.Header>
			<Empty.Content class="flex-row flex-wrap justify-center gap-2">
				<Button class="h-11 px-4" onclick={() => (editorOpen = true)}><Plus />New request</Button>
			</Empty.Content>
		</Empty.Root>
	{:else}
		<InputGroup.Root class="mb-4 h-11 md:max-w-md">
			<InputGroup.Input
				type="search"
				bind:value={query}
				oninput={debounceSearch}
				placeholder="Search requests"
				aria-label="Search requests"
				enterkeyhint="search"
				class="h-full [&::-webkit-search-cancel-button]:appearance-none"
			/>
			<InputGroup.Addon><Search /></InputGroup.Addon>
			{#if query}
				<InputGroup.Addon align="inline-end">
					<InputGroup.Button
						size="icon-sm"
						class="size-11 md:size-8"
						aria-label="Clear search"
						onclick={clearSearch}
					>
						<X />
					</InputGroup.Button>
				</InputGroup.Addon>
			{/if}
		</InputGroup.Root>

		{#if !matches.length}
			<Empty.Root class="mt-4 border">
				<Empty.Header>
					<Empty.Media variant="icon"><Search /></Empty.Media>
					<Empty.Title class="font-display text-xl">Nothing matches “{search}”</Empty.Title>
				</Empty.Header>
				<Empty.Content>
					<Button variant="outline" class="h-11 px-4" onclick={clearSearch}>Clear search</Button>
				</Empty.Content>
			</Empty.Root>
		{:else}
			<section aria-label="Active">
				<h2
					class="sticky top-[env(safe-area-inset-top)] z-10 -mx-4 flex h-11 items-end justify-between bg-background/95 px-4 pb-1.5 font-sans text-sm font-medium tracking-normal text-muted-foreground backdrop-blur md:-mx-8 md:px-8"
				>
					Active<span class="tabular font-normal">{active.length}</span>
				</h2>
				{#if active.length}
					<div class="pt-1">{@render rowList(active)}</div>
				{:else if !search}
					<p class="rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground">
						Nothing coming up. Add a request, or bring back an answered one.
					</p>
				{:else}
					<p class="py-3 text-sm text-muted-foreground">No active matches.</p>
				{/if}
			</section>

			{#if past.length}
				{@render folded('Past', past, pastOpen, (open) => (pastOpen = open), pastNote)}
			{/if}
			{#if answered.length}
				{@render folded(
					'Answered',
					answered,
					answeredOpen,
					(open) => (answeredOpen = open),
					undefined
				)}
			{/if}
		{/if}
		{#if list.olderHidden}
			<p class="mt-8 text-sm text-muted-foreground">
				The oldest past and answered requests aren't listed here, or found by search: there are too
				many to show at once.
			</p>
		{/if}
	{/if}
</div>

{#snippet pastNote()}
	<p class="pt-1 text-sm text-muted-foreground">
		One-time requests whose day has gone by, and schedules that have ended.
	</p>
{/snippet}

<RequestEditor
	bind:open={editorOpen}
	target={{ kind: 'add', day: today.current }}
	weekStart={me.weekStart}
/>
