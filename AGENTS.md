<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

# Prayer Tracker

What someone is praying for, and what they prayed for each day. Heavily inspired by Meal Tracker
(`~/Projects/meal-tracker`): same stack, layout, helpers and design language. When something here looks like a
Meal Tracker pattern, it is one; check how Meal Tracker does it before inventing something new.

Stack: SvelteKit 3 + Svelte 5 (runes, `experimental.async`: pages `await` live Convex queries), Convex, Clerk
(Google only), Tailwind 4 + shadcn-svelte (bits-ui, vaul), lucide icons, svelte-sonner, the Cloudflare adapter and
a PWA service worker. The app renders only in the browser (`ssr = false`). Svelte is pinned to 5.57.1 for
`patches/svelte@5.57.1.patch` (sveltejs/svelte#18861); drop the patch once a release includes the fix.

## Running it

- `pnpm dev` runs `convex dev` and Vite on port **5191** (`--host 0.0.0.0`; 5173 is Meal Tracker's).
- `pnpm test` (Vitest): `convex/shared/*.test.ts` in Node, the Convex functions (`convex/*.test.ts`) with
  convex-test in the edge runtime.
- `pnpm check` (svelte-check + `tsc` over `convex/`), `pnpm lint`, `pnpm format`.
- Imports use Node subpath aliases: `#lib/...` and `#convex/...`, not `$lib`.

## Signing in to test

Sign-in is Google only, so to use the app in a browser run `pnpm sign-in [who] [path]`. It prints a sign-in
link, good for five minutes, that signs the browser in and then opens the path. `who` defaults to the test user
(Clerk external id `prayer-test`, username `prayer_test`, no email); pass an email to sign in as someone who has
signed in with Google. If the test user is missing, `node scripts/create-test-user.mjs` makes it. Set
`SIGN_IN_ORIGIN` when the dev server isn't on `http://localhost:5191`. Both scripts read `CLERK_SECRET_KEY`
from `.env.local` and only work with Clerk's development instance. Never sign in as, or create, users with real
people's emails.

## How it fits together

- **Data** (`convex/schema.ts`): `users` (Clerk `tokenIdentifier`, optional `weekStart`), `requests` (owned
  by a user; `startDate`, optional RFC 5545 `rrule`, `skipDates`, `answeredOn`, denormalized `lastDate`,
  `prayedCount`, `lastPrayedOn`), `prayers` (one per request and day marked prayed).
- **Auth**: every public function goes through `userQuery` / `userMutation` (`convex/functions.ts`), which
  resolve `ctx.userId`; documents are fetched with `getOwned`. Throw `ConvexError('words for the person')`;
  the client shows `error.data` with `toastError` (`src/lib/errors.ts`).
- **Dates** are the client's local calendar days, `YYYY-MM-DD`. Queries never read the clock: the client passes
  `today` (`src/lib/today.svelte.ts`).
- **Recurrence** lives in one module, `convex/shared/recurrence.ts`, imported by Convex functions and the client.
  It builds the stored rule from the editor's fields (`toRRule`), reads it back (`parseRRule`), expands it
  (`occurrences`, `nextOccurrences`) and says it in words (`describeSchedule`). It uses rrule-temporal, which
  falls back to its bundled Temporal polyfill where there's no global `Temporal` (Convex, most browsers). Rules
  are date-only (`DTSTART;VALUE=DATE`), so time zones and DST never move a day. Monthly on the 29th–31st and
  yearly on Feb 29 fall on the month's last day when it's shorter (`BYMONTHDAY=28,…;BYSETPOS=-1`). Skipped days
  still count toward "after N times", as EXDATE does. Change it with its tests
  (`convex/shared/recurrence.test.ts`).
- **Days tab**: `days.range({from, to})` expands recurrence on the server for at most `MAX_RANGE_DAYS` (120)
  days, so one query reads a bounded number of prayed marks; it throws rather than return partial data when a
  read cap is hit. Build its args with `daysArgs` (`src/lib/tab-queries.ts`) so the app shell's preloads and the
  page share one subscription.
- **Days tab** (`src/routes/+page.svelte`) is Meal Tracker's plan: one list of days that grows a week at a time
  at either end (sentinels 4 screens out), anchored by hand whenever anything above the screen changes height,
  holding changes at the top until the page is still, and opening where it was left
  (`src/lib/days-view.svelte.ts`; kept in sessionStorage too, so a reload of the tab opens there as well). At `MAX_RANGE_DAYS` it lets go of a week at the far end (rows let go of above
  stay until the page is still). `?day=YYYY-MM-DD` opens on a day (a request page's upcoming days link to it);
  Back to it opens where it was left. The header's Today button and date picker keep the day they jump to in
  page state, not the URL. Pass the person's week start to every `dayName`/`weekLabel` (it's required).
  Items: `src/lib/components/days/`.
- **Requests** (`/requests`, `/requests/[requestId]`) and the request editor sheet
  (`src/lib/components/requests/request-editor.svelte`, used for adding and editing everywhere).
- **Optimistic updates** for the request mutations are in `src/lib/optimistic.ts`; `src/lib/request-actions.ts`
  wraps the quick actions (prayed, skip a day, answer, delete) with them and with toasts.
- **Query cache** (`src/lib/cache.svelte.ts`): each cached query is made in an effect root of its own. Made in
  whichever page or derived asked first, its deriveds died with that page, and every later page sharing it
  stopped hearing updates.

## Design

Meal Tracker's look in an evening palette ("Vespers", `src/routes/layout.css`): dark only, Young Serif for
titles, Atkinson Hyperlegible Next for text. The one warm accent is `candle` (`text-candle`, `bg-candle/12`;
it is also `primary`), used sparingly as Meal Tracker uses saffron. `sage` marks prayed, `lavender` answered,
`tomato` destructive. Touch targets are `h-11`; sheets are `AdaptiveSheet` (a drawer on phones, a dialog on
desktop).

## Releases

Release only with `pnpm release`, which runs the Deploy production GitHub Actions workflow on `main` (Cloudflare Worker staged, Convex deployed, then the Worker promoted). Never release by running `convex deploy` or `wrangler deploy` directly. Production is https://prayer.tpetrov.dev.
