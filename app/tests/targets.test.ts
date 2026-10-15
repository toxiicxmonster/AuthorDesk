import { calendarWeeks, estimatePages, evenChapterTarget, PAGE_SIZES, projectFinish, recentDays, writingStreak } from '../src/domain/targets';
import { parseTarget } from '../src/ui/components/BookProgress';

const today = new Date(2026, 9, 14, 15, 0); // Wed 14 Oct 2026
const logOf = (entries: [number, number][]) => Object.fromEntries(entries.map(([ago, n]) => [recentDays(ago + 1, today)[0], n]));

describe('page estimates', () => {
  it('offers the common print sizes and a manuscript page', () => {
    const ids = PAGE_SIZES.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['mass-market', '5x8', '5.5x8.5', '6x9', 'manuscript']));
  });

  it('counts a standard manuscript at 250 words a page', () => {
    const e = estimatePages([1084, 78, 0, 2500], 'manuscript');
    expect(e.perChapter).toEqual([5, 1, 0, 10]);
    expect(e.total).toBe(17); // plus a title page
  });

  it('gives more pages on smaller trims, and a full novel lands in the usual range', () => {
    const novel = Array.from({ length: 30 }, () => 3000); // 90,000 words
    const big = estimatePages(novel, '6x9').total;
    const mid = estimatePages(novel, '5.5x8.5').total;
    const small = estimatePages(novel, '5x8').total;
    expect(big).toBeLessThan(mid);
    expect(mid).toBeLessThan(small);
    // A 90k-word novel with 30 chapters, each opening on a right-hand page, is roughly 300–380 pages at 6 × 9 in.
    expect(big).toBeGreaterThan(300);
    expect(big).toBeLessThan(380);
    const mm = estimatePages(novel, 'mass-market').total;
    expect(mm).toBeGreaterThan(small - 150);
    expect(mm).toBeLessThan(450);
  });

  it('adds a blank page after an odd-length chapter so the next opens on the right', () => {
    const e = estimatePages([100, 100], '6x9'); // one page each
    expect(e.perChapter).toEqual([1, 1]);
    expect(e.total).toBe(6 + 1 + 1 + 1);
    expect(estimatePages([], '6x9').total).toBe(0);
  });
});

describe('targets', () => {
  it('projects the finish date from the 14-day average', () => {
    const log = logOf([[0, 700], [1, 700], [3, 700], [5, 700]]); // 2,800 in 14 days = 200/day
    const p = projectFinish(log, 10_000, 12_000, today);
    expect(p.perDay).toBe(200);
    expect(p.remaining).toBe(2000);
    expect(p.finishBy!.toDateString()).toBe(new Date(2026, 9, 24).toDateString());
  });

  it('has no date when nothing was written lately, or the target is reached', () => {
    expect(projectFinish({}, 100, 1000, today).finishBy).toBeNull();
    expect(projectFinish(logOf([[0, 500]]), 2000, 1000, today)).toMatchObject({ remaining: 0, finishBy: null });
  });

  it('counts the streak up to today, or up to yesterday before today’s writing', () => {
    expect(writingStreak(logOf([[0, 10], [1, 10], [2, 10], [4, 10]]), today)).toBe(3);
    expect(writingStreak(logOf([[1, 10], [2, 10]]), today)).toBe(2);
    expect(writingStreak(logOf([[2, 10]]), today)).toBe(0);
    expect(writingStreak(logOf([[0, -40]]), today)).toBe(0);
  });

  it('splits a book target evenly in round numbers', () => {
    expect(evenChapterTarget(80_000, 24)).toBe(3300);
    expect(evenChapterTarget(0, 12)).toBe(0);
  });

  it('reads targets typed in different ways', () => {
    expect(parseTarget('80,000')).toBe(80000);
    expect(parseTarget('80k')).toBe(80000);
    expect(parseTarget('2.5k')).toBe(2500);
    expect(parseTarget('')).toBeUndefined();
    expect(parseTarget('lots')).toBeNull();
  });

  it('lays out the calendar in Monday-first weeks ending this week', () => {
    const weeks = calendarWeeks(12, today);
    expect(weeks).toHaveLength(12);
    expect(weeks[0][0]).toBe('2026-07-27'); // a Monday
    expect(weeks[11]).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', null, null, null, null]);
  });
});
