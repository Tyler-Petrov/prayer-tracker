<script lang="ts">
	import { afterNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { slide } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import { useMutation } from 'convex-svelte';
	import BookOpen from '@lucide/svelte/icons/book-open';
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash from '@lucide/svelte/icons/trash';
	import { api } from '#convex/_generated/api.js';
	import type { Id } from '#convex/_generated/dataModel.js';
	import { passageLabel } from '#convex/shared/bible.js';
	import { daysBetween } from '#convex/shared/recurrence.js';
	import CheckMark from '#lib/components/check-mark.svelte';
	import PageHeader from '#lib/components/page-header.svelte';
	import ReadingEditor from '#lib/components/reading/reading-editor.svelte';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { convexQuery } from '#lib/convex-query.svelte.js';
	import { dateLabel, dayName } from '#lib/dates.js';
	import { toastError } from '#lib/errors.js';
	import { readingActions } from '#lib/reading-actions.js';
	import { readingPlanArgs } from '#lib/tab-queries.js';
	import { today } from '#lib/today.svelte.js';

	const planId = $derived(page.params.planId as Id<'readingPlans'>);
	const [plan, me] = $derived(
		await Promise.all([
			convexQuery(api.reading.get, readingPlanArgs(planId, today.current)),
			convexQuery(api.users.me, {})
		])
	);
	const actions = readingActions();

	// Back goes where it came from: the Days tab, or the Requests tab (also when opened directly).
	let fromDays = $state(false);
	afterNavigate(({ from, type }) => {
		if (type === 'enter') fromDays = false;
		else if (from?.route.id) fromDays = from.route.id === '/';
	});
	const back = $derived(
		fromDays
			? { href: resolve('/'), label: 'Days' }
			: { href: resolve('/requests'), label: 'Requests' }
	);

	const description = $derived.by(() => {
		if (!plan) return undefined;
		if (!plan.next) return `${plan.summary} · finished`;
		const last = plan.lastDate && dateLabel(plan.lastDate, today.current);
		return last ? `${plan.summary} · finishes ${last}` : plan.summary;
	});
	const share = $derived(plan?.chaptersTotal ? plan.chaptersRead / plan.chaptersTotal : 0);
	const readings = $derived(
		plan?.readings.map((reading) => ({ ...reading, planId, book: plan.book })) ?? []
	);
	const editorTarget = $derived(
		plan && {
			kind: 'edit' as const,
			plan,
			read: plan.readings.filter((r) => r.read)
		}
	);
	let editorOpen = $state(false);

	// Behind: the rest of the book from today, at the first chapter not read, on the same schedule.
	const update = useMutation(api.reading.update);
	let catchingUp = $state(false);
	async function catchUp() {
		if (!plan?.next || catchingUp) return;
		catchingUp = true;
		try {
			await update({
				planId,
				fields: { ...plan.fields, startDate: today.current, fromChapter: plan.next.from }
			});
			toast.success(`${plan.book} carries on from today`);
		} catch (error) {
			toastError(error);
		} finally {
			catchingUp = false;
		}
	}

	let confirmOpen = $state(false);
	let deleting = $state(false);
	async function deletePlan() {
		if (!plan) return;
		deleting = true;
		const href = back.href;
		if (await actions.remove(plan)) {
			confirmOpen = false;
			await goto(href);
		} else deleting = false;
	}

	const dayHref = (day: string) => `${resolve('/')}?day=${day}`;
</script>

{#if plan}
	{#snippet toolButtons(phone: boolean)}
		<Button
			variant={phone ? 'ghost' : 'outline'}
			size={phone ? 'icon' : 'default'}
			class={phone ? 'size-11' : 'h-10 px-3'}
			aria-label={phone ? 'Change plan' : undefined}
			onclick={() => (editorOpen = true)}
		>
			<Pencil />
			{#if !phone}Change{/if}
		</Button>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						variant="ghost"
						size="icon"
						class={phone ? 'size-11' : 'size-10'}
						aria-label="More"
					>
						<Ellipsis />
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="end" class="w-auto min-w-44">
				<DropdownMenu.Item
					variant="destructive"
					class="min-h-10"
					onSelect={() => (confirmOpen = true)}
				>
					<Trash />
					Delete plan
				</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	{/snippet}

	<PageHeader title={plan.book} {back} {description} centerActions>
		{#snippet actions()}
			<div class="flex items-center gap-1 md:hidden">{@render toolButtons(true)}</div>
			<div class="hidden items-center gap-2 md:flex">{@render toolButtons(false)}</div>
		{/snippet}
	</PageHeader>

	<div class="page-column flex flex-col gap-6 pb-10">
		<section aria-label="Progress">
			<div class="flex items-baseline justify-between gap-3 text-sm">
				<span>
					<span class="tabular">{plan.chaptersRead}</span> of
					<span class="tabular">{plan.chaptersTotal}</span>
					{plan.chaptersTotal === 1 ? 'chapter' : 'chapters'} read
				</span>
				<span class="tabular text-muted-foreground">{Math.round(share * 100)}%</span>
			</div>
			<div
				class="mt-2 h-2 overflow-hidden rounded-full bg-muted"
				role="progressbar"
				aria-label="Chapters read"
				aria-valuemin={0}
				aria-valuemax={plan.chaptersTotal}
				aria-valuenow={plan.chaptersRead}
			>
				<div
					class="h-full rounded-full bg-sage transition-[width] duration-300"
					style:width="{share * 100}%"
				></div>
			</div>
		</section>

		{#if plan.behind && plan.next}
			<section
				class="flex flex-col gap-3 rounded-xl border border-candle/30 bg-candle/8 px-4 py-3 sm:flex-row sm:items-center"
				aria-label="Behind"
				transition:slide={{ duration: 200 }}
			>
				<p class="flex-1 text-sm">
					{plan.behind === 1 ? 'One reading' : `${plan.behind} readings`} behind. Carry on from {passageLabel(
						plan.book,
						plan.next
					)} today, and the rest of the book moves along with it.
				</p>
				<Button class="h-11 shrink-0 px-4" disabled={catchingUp} onclick={catchUp}>
					{#if catchingUp}<Spinner />{:else}<CalendarClock />{/if}
					Carry on from today
				</Button>
			</section>
		{/if}

		<section aria-labelledby="readings-heading">
			<h2
				id="readings-heading"
				class="mb-2 font-sans text-xs font-medium tracking-wide text-muted-foreground uppercase"
			>
				Readings
			</h2>
			<!-- Every reading, any of them checkable: reading ahead counts. -->
			<ul class="divide-y overflow-hidden rounded-xl border bg-card">
				{#each readings as reading (reading.readingId)}
					{@const isToday = reading.date === today.current}
					{@const label = passageLabel(plan.book, reading)}
					<li class={['flex items-stretch', reading.read && 'bg-sage/5']}>
						<button
							type="button"
							aria-pressed={reading.read}
							aria-label="Read {label}"
							class="group grid w-14 shrink-0 place-items-center focus-visible:outline-none [&:focus-visible>span]:ring-3 [&:focus-visible>span]:ring-ring/50"
							onclick={() => void actions.read(reading, !reading.read)}
						>
							<CheckMark checked={reading.read} />
						</button>
						<a
							href={dayHref(reading.date)}
							class="flex min-h-12 min-w-0 flex-1 items-center justify-between gap-3 pr-4 text-sm transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none"
						>
							<span class={['truncate', reading.read && 'text-muted-foreground']}>{label}</span>
							<span
								class={[
									'shrink-0',
									isToday
										? 'text-candle'
										: !reading.read && reading.date < today.current
											? 'text-foreground/75'
											: 'text-muted-foreground'
								]}
							>
								{Math.abs(daysBetween(today.current, reading.date)) <= 1
									? dayName(reading.date, today.current, me.weekStart)
									: dateLabel(reading.date, today.current)}
							</span>
						</a>
					</li>
				{/each}
			</ul>
		</section>
	</div>

	{#if editorTarget}
		<ReadingEditor bind:open={editorOpen} target={editorTarget} weekStart={me.weekStart} />
	{/if}

	<AlertDialog.Root bind:open={confirmOpen}>
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title class="font-display text-xl"
					>Delete reading {plan.book}?</AlertDialog.Title
				>
				<AlertDialog.Description>
					This permanently deletes the plan and every reading in it, read or not.
				</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Cancel class="h-11" disabled={deleting}>Cancel</AlertDialog.Cancel>
				<AlertDialog.Action
					variant="destructive"
					class="h-11"
					disabled={deleting}
					onclick={deletePlan}
				>
					{#if deleting}<Spinner />{/if}
					Delete plan
				</AlertDialog.Action>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>
{:else if !deleting}
	<PageHeader title="Reading" back={{ href: resolve('/requests'), label: 'Requests' }} />
	<div class="page-column">
		<Empty.Root class="border">
			<Empty.Header>
				<Empty.Media variant="icon"><BookOpen /></Empty.Media>
				<Empty.Title class="font-display text-xl">This reading plan isn't here</Empty.Title>
				<Empty.Description>It may have been deleted, or the link is wrong.</Empty.Description>
			</Empty.Header>
			<Empty.Content>
				<Button href={resolve('/requests')} variant="outline" class="h-11 px-4">All requests</Button
				>
			</Empty.Content>
		</Empty.Root>
	</div>
{/if}
