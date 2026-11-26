// Browser-safe: the books of the Bible, and how a reading plan splits a book into readings. Convex functions and
// the reading editor's preview both use it, so the plan the editor shows is the one that gets saved.
import {
	nextOccurrences,
	toRRule,
	validateSchedule,
	type Schedule,
	type Weekday,
	type YMD
} from './recurrence';

/** The 66 books of the Protestant canon, in order, with how many chapters each has. */
export const BOOKS = [
	// Old Testament
	['Genesis', 50],
	['Exodus', 40],
	['Leviticus', 27],
	['Numbers', 36],
	['Deuteronomy', 34],
	['Joshua', 24],
	['Judges', 21],
	['Ruth', 4],
	['1 Samuel', 31],
	['2 Samuel', 24],
	['1 Kings', 22],
	['2 Kings', 25],
	['1 Chronicles', 29],
	['2 Chronicles', 36],
	['Ezra', 10],
	['Nehemiah', 13],
	['Esther', 10],
	['Job', 42],
	['Psalms', 150],
	['Proverbs', 31],
	['Ecclesiastes', 12],
	['Song of Solomon', 8],
	['Isaiah', 66],
	['Jeremiah', 52],
	['Lamentations', 5],
	['Ezekiel', 48],
	['Daniel', 12],
	['Hosea', 14],
	['Joel', 3],
	['Amos', 9],
	['Obadiah', 1],
	['Jonah', 4],
	['Micah', 7],
	['Nahum', 3],
	['Habakkuk', 3],
	['Zephaniah', 3],
	['Haggai', 2],
	['Zechariah', 14],
	['Malachi', 4],
	// New Testament
	['Matthew', 28],
	['Mark', 16],
	['Luke', 24],
	['John', 21],
	['Acts', 28],
	['Romans', 16],
	['1 Corinthians', 16],
	['2 Corinthians', 13],
	['Galatians', 6],
	['Ephesians', 6],
	['Philippians', 4],
	['Colossians', 4],
	['1 Thessalonians', 5],
	['2 Thessalonians', 3],
	['1 Timothy', 6],
	['2 Timothy', 4],
	['Titus', 3],
	['Philemon', 1],
	['Hebrews', 13],
	['James', 5],
	['1 Peter', 5],
	['2 Peter', 3],
	['1 John', 5],
	['2 John', 1],
	['3 John', 1],
	['Jude', 1],
	['Revelation', 22]
] as const satisfies readonly (readonly [string, number])[];

export type Book = (typeof BOOKS)[number][0];
/** Where the New Testament starts in BOOKS. */
export const NEW_TESTAMENT = BOOKS.findIndex(([name]) => name === 'Matthew');

const CHAPTERS = new Map<string, number>(BOOKS);

export const isBook = (name: string): name is Book => CHAPTERS.has(name);
/** How many chapters `book` has. */
export const chaptersIn = (book: Book) => CHAPTERS.get(book)!;

/** One reading: chapters `from` through `to` of a book, inclusive. */
export type Passage = { from: number; to: number };

/**
 * "Romans 3–4", "Romans 3", "Psalm 23" (one psalm is a Psalm), or just "Jude" for a book of one chapter.
 * `book` is a string so a reading saved under a book's old name still reads.
 */
export function passageLabel(book: string, { from, to }: Passage) {
	if (CHAPTERS.get(book) === 1) return book;
	const name = book === 'Psalms' && from === to ? 'Psalm' : book;
	return from === to ? `${name} ${from}` : `${name} ${from}–${to}`;
}

/** "1 chapter", "3 chapters". */
export const chapterCount = (n: number) => `${n} ${n === 1 ? 'chapter' : 'chapters'}`;

/** How often a plan has a reading: every day, every few days, or on some days of the week. */
export type ReadingRepeat =
	{ kind: 'daily'; interval: number } | { kind: 'weekly'; interval: number; weekdays: Weekday[] };

/** The editor's fields, apart from the book. */
export type ReadingPlanFields = {
	/** The chapter to read next: where they are in the book. */
	fromChapter: number;
	chaptersPerDay: number;
	startDate: YMD;
	repeat: ReadingRepeat;
	weekStart?: Schedule['weekStart'];
};

/** A plan's schedule as a recurrence Schedule: it never ends by date, it ends when the book does. */
export const planSchedule = (fields: ReadingPlanFields): Schedule => ({
	startDate: fields.startDate,
	repeat: fields.repeat,
	ends: { kind: 'never' },
	...(fields.repeat.kind === 'weekly' ? { weekStart: fields.weekStart ?? 'SU' } : {})
});

/** What's wrong with a plan, in words for the person, or null when it's fine. */
export function validatePlan(book: string, fields: ReadingPlanFields): string | null {
	if (!isBook(book)) return 'Pick a book';
	const chapters = chaptersIn(book);
	const { fromChapter, chaptersPerDay } = fields;
	if (!Number.isInteger(fromChapter) || fromChapter < 1 || fromChapter > chapters)
		return `Start at a chapter from 1 to ${chapters}`;
	if (!Number.isInteger(chaptersPerDay) || chaptersPerDay < 1 || chaptersPerDay > chapters)
		return `Read 1 to ${chapters} chapters at a time`;
	return validateSchedule(planSchedule(fields));
}

/**
 * The book from `fromChapter` to its end, cut into readings of `chaptersPerDay` (the last may be shorter),
 * leaving out the chapters in `read`. A reading never spans a chapter left out.
 */
export function splitBook(
	book: Book,
	fromChapter: number,
	chaptersPerDay: number,
	read: ReadonlySet<number> = new Set()
): Passage[] {
	const passages: Passage[] = [];
	let current: Passage | undefined;
	for (let chapter = fromChapter; chapter <= chaptersIn(book); chapter++) {
		if (read.has(chapter)) current = undefined;
		else if (
			current &&
			current.to === chapter - 1 &&
			current.to - current.from + 1 < chaptersPerDay
		)
			current.to = chapter;
		else passages.push((current = { from: chapter, to: chapter }));
	}
	return passages;
}

/**
 * The plan's readings, each on its day: the rest of the book, from `fromChapter`, one reading on each day the
 * schedule has from its start. Readings already checked off (`read`) keep their day and chapters, so the plan
 * goes around both. Throws on a plan validatePlan turns down.
 */
export function planReadings(
	book: string,
	fields: ReadingPlanFields,
	read: readonly (Passage & { date: YMD })[] = []
): (Passage & { date: YMD })[] {
	const problem = validatePlan(book, fields);
	if (problem) throw new Error(problem);
	const readChapters = new Set(
		read.flatMap(({ from, to }) => Array.from({ length: to - from + 1 }, (_, i) => from + i))
	);
	const passages = splitBook(book as Book, fields.fromChapter, fields.chaptersPerDay, readChapters);
	if (!passages.length) return [];
	const rrule = toRRule(planSchedule(fields));
	const skipDates = [...new Set(read.map((reading) => reading.date))];
	const dates = nextOccurrences(
		{ startDate: fields.startDate, rrule, skipDates },
		fields.startDate,
		passages.length
	);
	return passages.slice(0, dates.length).map((passage, i) => ({ ...passage, date: dates[i] }));
}
