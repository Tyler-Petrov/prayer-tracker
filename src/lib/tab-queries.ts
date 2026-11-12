import { addDays } from '#convex/shared/weeks.js';

// Args of the tabs' main queries. The app shell keeps each tab's default view subscribed, and
// Convex only shares a subscription when the args serialize identically, so both build them here.

/** Days: the days around `day`, which the page opens on; scrolling widens them (at most MAX_RANGE_DAYS). */
export const daysArgs = (day: string) => ({ from: addDays(day, -7), to: addDays(day, 14) });

/** Requests: every request, as of today (which sets each one's next date and section). */
export const requestsArgs = (today: string) => ({ today });

/** A request's page, as of today. */
export const requestArgs = <Id extends string>(requestId: Id, today: string) => ({
	requestId,
	today
});
