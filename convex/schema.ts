import { defineSchema, defineTable } from 'convex/server';
import { v, type Infer } from 'convex/values';
import type { ReadingPlanFields } from './shared/bible';
import type { Schedule } from './shared/recurrence';

/** A day of the week, as RFC 5545 writes it. */
export const vWeekday = v.union(
	v.literal('SU'),
	v.literal('MO'),
	v.literal('TU'),
	v.literal('WE'),
	v.literal('TH'),
	v.literal('FR'),
	v.literal('SA')
);
export const vWeekStart = v.union(v.literal('SU'), v.literal('MO'));

/** A reading plan's editor fields (shared/bible.ts `ReadingPlanFields`). */
export const vReadingPlanFields = v.object({
	fromChapter: v.number(),
	chaptersPerDay: v.number(),
	startDate: v.string(),
	repeat: v.union(
		v.object({ kind: v.literal('daily'), interval: v.number() }),
		v.object({ kind: v.literal('weekly'), interval: v.number(), weekdays: v.array(vWeekday) })
	),
	weekStart: v.optional(vWeekStart)
});

/** The request editor's schedule fields (shared/recurrence.ts `Schedule`), which become the stored rule. */
export const vSchedule = v.object({
	startDate: v.string(),
	repeat: v.union(
		v.object({ kind: v.literal('none') }),
		v.object({ kind: v.literal('daily'), interval: v.number() }),
		v.object({ kind: v.literal('weekly'), interval: v.number(), weekdays: v.array(vWeekday) }),
		v.object({ kind: v.literal('monthly'), interval: v.number() }),
		v.object({ kind: v.literal('yearly'), interval: v.number() })
	),
	ends: v.union(
		v.object({ kind: v.literal('never') }),
		v.object({ kind: v.literal('until'), date: v.string() }),
		v.object({ kind: v.literal('count'), count: v.number() })
	),
	weekStart: v.optional(vWeekStart)
});
// The validator and the shared type must agree, both ways (a type error here when they drift).
type Assert<T extends true> = T;
export type ScheduleMatchesValidator = Assert<
	Infer<typeof vSchedule> extends Schedule
		? Schedule extends Infer<typeof vSchedule>
			? true
			: false
		: false
>;
export type ReadingPlanFieldsMatchValidator = Assert<
	Infer<typeof vReadingPlanFields> extends ReadingPlanFields
		? ReadingPlanFields extends Infer<typeof vReadingPlanFields>
			? true
			: false
		: false
>;

export default defineSchema({
	/** Someone signed in with Clerk; made on their first sign-in (users.ensure). */
	users: defineTable({
		/** The Clerk identity's tokenIdentifier (issuer + subject). */
		tokenIdentifier: v.string(),
		email: v.optional(v.string()),
		/** The first day of the week on the Days tab and for new weekly rules; Sunday when unset. */
		weekStart: v.optional(vWeekStart),
		/** Whether the Days tab keeps this person's screen awake; missing means yes. */
		keepScreenOn: v.optional(v.boolean())
	}).index('by_tokenIdentifier', ['tokenIdentifier']),

	/** Something someone is praying for, once or on a schedule. */
	requests: defineTable({
		userId: v.id('users'),
		title: v.string(),
		notes: v.optional(v.string()),
		/** The first day, YYYY-MM-DD; the only day of a one-time request. */
		startDate: v.string(),
		/** RFC 5545 `DTSTART;VALUE=DATE:…\nRRULE:…` (shared/recurrence.ts toRRule). Absent: one-time. */
		rrule: v.optional(v.string()),
		/** Occurrences taken out one by one ("skip just this day"), YYYY-MM-DD, sorted. */
		skipDates: v.array(v.string()),
		/** Answered on this day: it doesn't happen after it. */
		answeredOn: v.optional(v.string()),
		answerNote: v.optional(v.string()),
		/**
		 * The last day it can happen on (shared/recurrence.ts lastPossibleDate), '9999-12-31' when open-ended:
		 * lets days.range read only the requests that can reach its days.
		 */
		lastDate: v.string(),
		/** How many days it's been marked prayed, and the latest; kept by prayers.set. */
		prayedCount: v.number(),
		lastPrayedOn: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number()
	})
		.index('by_userId_and_lastDate', ['userId', 'lastDate'])
		.index('by_userId_and_startDate', ['userId', 'startDate']),

	/** Marked prayed for a request on a day. One per request and day. */
	prayers: defineTable({
		userId: v.id('users'),
		requestId: v.id('requests'),
		date: v.string()
	})
		.index('by_userId_and_date', ['userId', 'date'])
		.index('by_requestId_and_date', ['requestId', 'date']),

	/**
	 * Reading through a book of the Bible: some chapters at a time, on a schedule, until the book ends. Its readings
	 * (one per day) are made when it's added or changed (shared/bible.ts planReadings).
	 */
	readingPlans: defineTable({
		userId: v.id('users'),
		/** A name from shared/bible.ts BOOKS. */
		book: v.string(),
		chaptersPerDay: v.number(),
		/** Where they were when it was last planned: the chapter its first unread reading starts at. */
		fromChapter: v.number(),
		/** The first day it was last planned from, YYYY-MM-DD. */
		startDate: v.string(),
		/** RFC 5545 rule (shared/recurrence.ts toRRule), daily or weekly, never ending: the book ends it. */
		rrule: v.string(),
		/** Chapters in all its readings, and in the ones checked off; kept by reading.setRead and reading.update. */
		chaptersTotal: v.number(),
		chaptersRead: v.number(),
		createdAt: v.number(),
		updatedAt: v.number()
	}).index('by_userId', ['userId']),

	/** One day's reading in a plan: chapters `from` through `to` of `book`. One per plan and day. */
	readings: defineTable({
		userId: v.id('users'),
		planId: v.id('readingPlans'),
		date: v.string(),
		/** The plan's book, kept here so a day's readings need no other read. */
		book: v.string(),
		from: v.number(),
		to: v.number(),
		read: v.boolean()
	})
		.index('by_userId_and_date', ['userId', 'date'])
		.index('by_planId_and_date', ['planId', 'date'])
		.index('by_planId_and_read_and_date', ['planId', 'read', 'date'])
});
