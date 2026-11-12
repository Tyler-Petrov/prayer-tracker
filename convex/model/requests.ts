import { ConvexError } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import {
	describeSchedule,
	lastOccurrence,
	lastPossibleDate,
	nextOccurrence,
	nextOccurrences,
	parseRRule,
	shortDate,
	toRRule,
	validateSchedule,
	type Schedule,
	type YMD
} from '../shared/recurrence';

export const TITLE_MAX = 200;
export const NOTES_MAX = 5000;
export const SKIPS_MAX = 1000;

/** Which list a request sits in on the Requests tab. */
export type Section = 'active' | 'past' | 'answered';

/**
 * A request as the app shows it, worked out for `today` (the client's local day). `schedule` is the stored rule
 * read back into the editor's fields; `summary` says it in words; `nextDate` is the next day it happens on
 * (today included), null when it won't again; `endDate` is the last day it actually happens on (skips and the
 * answer honored), null when it's open-ended or never happens.
 */
export function requestView(request: Doc<'requests'>, today: YMD) {
	const schedule = parseRRule(request.rrule, request.startDate);
	const nextDate = nextOccurrence(request, today);
	const section: Section = request.answeredOn ? 'answered' : nextDate ? 'active' : 'past';
	return {
		requestId: request._id,
		title: request.title,
		notes: request.notes ?? null,
		startDate: request.startDate,
		recurring: request.rrule !== undefined,
		schedule,
		summary: describeSchedule(schedule, today),
		nextDate,
		endDate: lastOccurrence(request, request.lastDate),
		answeredOn: request.answeredOn ?? null,
		answerNote: request.answerNote ?? null,
		prayedCount: request.prayedCount,
		lastPrayedOn: request.lastPrayedOn ?? null,
		section,
		createdAt: request.createdAt,
		updatedAt: request.updatedAt
	};
}
export type RequestView = ReturnType<typeof requestView>;

/** The upcoming days shown on a request's page. */
export const upcomingDates = (request: Doc<'requests'>, today: YMD, n = 5) =>
	nextOccurrences(request, today, n);

/** Trimmed text fields, or a ConvexError the person can read. */
export function cleanText(fields: { title: string; notes?: string }) {
	const title = fields.title.trim();
	if (!title) throw new ConvexError('Give it a title');
	if (title.length > TITLE_MAX)
		throw new ConvexError(`Keep the title under ${TITLE_MAX} characters`);
	const notes = fields.notes?.trim() || undefined;
	if (notes && notes.length > NOTES_MAX)
		throw new ConvexError(`Keep the notes under ${NOTES_MAX} characters`);
	return { title, notes };
}

/** Why a request answered on `answeredOn` can't start later: say so in the editor and on the server alike. */
export const startsAfterAnswer = (answeredOn: YMD) =>
	`It was answered on ${shortDate(answeredOn)}, so it can't start after that. Mark it not answered first.`;

/** A schedule's stored rule, checked; weekly rules count weeks from the person's first day of the week. */
export function ruleFor(schedule: Schedule, weekStart: 'SU' | 'MO') {
	const problem = validateSchedule(schedule);
	if (problem) throw new ConvexError(problem);
	return toRRule({ ...schedule, weekStart: schedule.weekStart ?? weekStart });
}

/** The fields that follow from a request's schedule, skips and answer. */
export function derived(fields: {
	startDate: YMD;
	rrule?: string;
	skipDates: YMD[];
	answeredOn?: YMD;
}) {
	return { lastDate: lastPossibleDate(fields) };
}

/** Deletes up to `batch` of a request's prayed marks; true when there are none left. */
export async function deletePrayerBatch(ctx: MutationCtx, requestId: Id<'requests'>, batch = 1000) {
	const prayers = await ctx.db
		.query('prayers')
		.withIndex('by_requestId_and_date', (q) => q.eq('requestId', requestId))
		.take(batch);
	for (const prayer of prayers) await ctx.db.delete('prayers', prayer._id);
	return prayers.length < batch;
}
