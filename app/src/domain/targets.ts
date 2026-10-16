import { kdpMinimumInside, printWordsPerPage, TRIM_SIZES } from '../importExport/publish';
import { countWords } from './text';

/**
 * Word targets, a finish-by projection, the writing streak, and estimated page counts, for the Home dashboard.
 * All derived from the chapters' word counts and the per-day word log; nothing here is stored.
 */

// ---------------------------------------------------------------- page estimates

export interface PageSize {
  id: string;
  label: string;
  /** Print sizes: trim and text size, laid out like the paperback export. */
  trim?: { width: number; height: number };
  fontSize?: number;
  /** A fixed words-per-page: the standard manuscript page, or mass-market paperbacks' tight margins and small type. */
  wordsPerPage?: number;
}

/** The most common print sizes for novels, plus the standard manuscript page agents and editors count in. */
export const PAGE_SIZES: PageSize[] = [
  { id: 'mass-market', label: 'Mass-market paperback (4.25 × 6.87 in)', trim: { width: 4.25, height: 6.87 }, fontSize: 9.5, wordsPerPage: 260 },
  ...TRIM_SIZES.map((t) => ({ id: t.id, label: `${t.id === '6x9' ? 'Trade paperback' : t.id === '6.14x9.21' ? 'Hardcover' : 'Paperback'} (${t.width} × ${t.height} in)`, trim: t, fontSize: 11 })),
  { id: 'manuscript', label: 'Manuscript (US Letter, double-spaced, 12 pt)', wordsPerPage: 250 },
];

export const DEFAULT_PAGE_SIZE = '6x9';

export interface PageEstimate {
  /** Pages for each chapter's text (including its opening page). */
  perChapter: number[];
  /** The chapters' pages plus the book pages that exist (dedication, about the author…), nothing that hasn't been written. */
  total: number;
  /**
   * The finished paperback as the export lays it out: also a title page, copyright and contents, and a blank page
   * wherever one is needed so chapters open on the right. Null for a manuscript page.
   */
  printed: number | null;
  wordsPerPage: number;
}

/**
 * Estimated pages for a book whose chapters have these word counts, plus the texts of its book pages (dedication,
 * epigraph, acknowledgements, about the author, also by) that exist. Print sizes follow the paperback export: a
 * chapter opens a third of the way down the page, and KDP's gutter is allowed for.
 */
export function estimatePages(chapterWords: number[], sizeId: string, bookPages: readonly string[] = []): PageEstimate {
  const size = PAGE_SIZES.find((s) => s.id === sizeId) ?? PAGE_SIZES.find((s) => s.id === DEFAULT_PAGE_SIZE)!;
  const extras = bookPages.filter((t) => t.trim());
  const extraPages = (wpp: number) => extras.reduce((n, t) => n + Math.max(1, Math.ceil(countWords(t) / wpp)), 0);
  if (!size.trim) {
    const perChapter = chapterWords.map((w) => (w > 0 ? Math.ceil(w / size.wordsPerPage!) : 0));
    return { perChapter, total: perChapter.reduce((a, b) => a + b, 0) + extraPages(size.wordsPerPage!), printed: null, wordsPerPage: size.wordsPerPage! };
  }
  const layout = (inside: number) => {
    const wpp = size.wordsPerPage ?? printWordsPerPage(size.trim!, size.fontSize!, inside);
    const perChapter = chapterWords.map((w) => (w > 0 ? Math.ceil(w / wpp + 0.35) : 0));
    const written = perChapter.filter((n) => n > 0);
    const text = written.reduce((a, b) => a + b, 0);
    // A blank left-hand page after each odd-length chapter, so the next one opens on the right.
    const blanks = written.slice(0, -1).filter((n) => n % 2 === 1).length;
    const front = written.length ? 6 : 0; // title and its back, copyright, a blank, two contents pages
    // In print each book page starts on a right-hand page too.
    const printedExtras = extras.reduce((n, t) => n + 2 * Math.ceil(Math.max(1, Math.ceil(countWords(t) / wpp)) / 2), 0);
    return { perChapter, total: text + extraPages(wpp), printed: front + text + blanks + printedExtras, wordsPerPage: Math.round(wpp) };
  };
  const first = layout(0.75);
  return layout(kdpMinimumInside(first.printed!) + 0.25);
}

// ---------------------------------------------------------------- targets and projection

export interface Projection {
  /** Average net words per day over the window (days without writing count as zero). */
  perDay: number;
  days: number;
  remaining: number;
  /** When the target is reached at that pace; null when it's already reached or the pace is zero or negative. */
  finishBy: Date | null;
}

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The day keys (YYYY-MM-DD, local) of the `days` days ending today. */
export function recentDays(days: number, today = new Date()): string[] {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (days - 1 - i));
    return dayKey(d);
  });
}

export function projectFinish(log: Record<string, number>, current: number, target: number, today = new Date(), window = 14): Projection {
  const total = recentDays(window, today).reduce((n, k) => n + (log[k] ?? 0), 0);
  const perDay = Math.round(total / window);
  const remaining = Math.max(0, target - current);
  let finishBy: Date | null = null;
  if (remaining > 0 && perDay > 0) {
    finishBy = new Date(today);
    finishBy.setHours(12, 0, 0, 0);
    finishBy.setDate(finishBy.getDate() + Math.ceil(remaining / perDay));
  }
  return { perDay, days: window, remaining, finishBy };
}

/** Days in a row with words written, ending today (or yesterday, when today hasn't started yet). */
export function writingStreak(log: Record<string, number>, today = new Date()): number {
  const d = new Date(today);
  if (!((log[dayKey(d)] ?? 0) > 0)) d.setDate(d.getDate() - 1);
  let n = 0;
  while ((log[dayKey(d)] ?? 0) > 0) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

/** Splits a book target over its chapters, rounded to the nearest 100 words. */
export function evenChapterTarget(bookTarget: number, chapters: number): number {
  if (!chapters || bookTarget <= 0) return 0;
  return Math.max(100, Math.round(bookTarget / chapters / 100) * 100);
}

/** Calendar weeks (Monday first) covering the last `weeks` weeks, for the streak calendar. Future days are null. */
export function calendarWeeks(weeks: number, today = new Date()): (string | null)[][] {
  const start = new Date(today);
  const weekday = (start.getDay() + 6) % 7; // Monday = 0
  start.setDate(start.getDate() - weekday - (weeks - 1) * 7);
  const todayKey = dayKey(today);
  const out: (string | null)[][] = [];
  let past = true;
  for (let w = 0; w < weeks; w++) {
    const week: (string | null)[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + w * 7 + i);
      const k = dayKey(d);
      week.push(past ? k : null);
      if (k === todayKey) past = false;
    }
    out.push(week);
  }
  return out;
}
