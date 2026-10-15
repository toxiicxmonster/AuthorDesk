import type { PlacedFact } from './continuity';

/**
 * Ages against the timeline: a character's age written in two dated scenes should differ by the time between them
 * ("17 in Ch. 3, set two years later, but 16 in Ch. 12"), and match their birth date or the Age on their entry.
 * Scenes get their dates from timeline events linked to the scene or its chapter: calendar dates ("March 2019") or
 * story time ("Day 12", "Year 2"), which are only compared with each other. Pure.
 */

export interface StoryDate {
  /** Years, with the month and day as a fraction (2019.5 is about July 2019). */
  years: number;
  /** Only the year is known, so ages can be a year either way. */
  yearOnly: boolean;
  /** As the author wrote it ("March 2019"). */
  label: string;
  /** Story time ("Day 12"): counted from the story's start, not a calendar date. */
  relative?: boolean;
}

/** Whether two dates can be compared (both calendar dates, or both story time). */
export const comparable = (a: StoryDate, b: StoryDate) => !!a.relative === !!b.relative;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const SEASONS: Record<string, number> = { spring: 3, summer: 6, autumn: 9, fall: 9, winter: 0 };

const at = (year: number, month = 0, day = 1) => year + month / 12 + (day - 1) / 365;

/**
 * A date in a timeline event's "when" or an entry's "Born:" line: "2019-03-14", "14 March 2019", "March 2019",
 * "summer 2019", "1998", or story time: "Day 12", "day 1 7:32 P.M.", "Week 3", "Month 2", "Year 2".
 */
export function parseStoryDate(text: string): StoryDate | null {
  const t = text.trim();
  if (!t) return null;
  const label = t;
  let m = /\b(\d{4})-(\d{1,2})(?:-(\d{1,2}))?\b/.exec(t);
  if (m) return { years: at(+m[1], +m[2] - 1, m[3] ? +m[3] : 1), yearOnly: false, label };
  m = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH},?\\s+(\\d{4})\\b`, 'i').exec(t);
  if (m) return { years: at(+m[3], MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()), +m[1]), yearOnly: false, label };
  m = new RegExp(`\\b${MONTH}\\.?\\s+(?:(\\d{1,2})(?:st|nd|rd|th)?,?\\s+)?(\\d{4})\\b`, 'i').exec(t);
  if (m) return { years: at(+m[3], MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()), m[2] ? +m[2] : 1), yearOnly: false, label };
  m = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(t); // month first (US style)
  if (m) return { years: at(+m[3], +m[1] - 1, +m[2]), yearOnly: false, label };
  m = /\b(spring|summer|autumn|fall|winter)\s+(?:of\s+)?(\d{4})\b/i.exec(t);
  if (m) return { years: at(+m[2], SEASONS[m[1].toLowerCase()]), yearOnly: false, label };
  m = /(?:^|[^\d])(1[5-9]\d\d|2[01]\d\d)(?![\d])/.exec(t);
  if (m) return { years: at(+m[1], 6), yearOnly: true, label };
  m = /\b(day|week|month|year)\s+(\d{1,4})\b/i.exec(t);
  if (m) {
    const n = +m[2] - 1;
    const unit = m[1].toLowerCase();
    const years = unit === 'day' ? n / 365.25 : unit === 'week' ? (n * 7) / 365.25 : unit === 'month' ? n / 12 : n;
    return { years, yearOnly: unit === 'year', label, relative: true };
  }
  return null;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

export function ageNumber(value: string): number | null {
  const v = value.trim().toLowerCase();
  if (/^\d{1,3}$/.test(v)) return +v;
  return NUMBER_WORDS[v] ?? null;
}

/** A birth date written anywhere in a character's entry: "Born: 3 May 2002", "Birthday: March 3, 2002", "b. 1998". */
export function birthDate(entryText: string): StoryDate | null {
  for (const m of entryText.matchAll(/\b(?:born(?:\s+(?:on|in))?|birthday|birth\s*date|date of birth|dob|b\.)\s*[:\-–]?\s*([^\n;]+)/gi)) {
    const d = parseStoryDate(m[1]);
    if (d) return d;
  }
  return null;
}

/** The Age on a character's entry ("Age" field, or an "Age: 21" line), taken as their age when the story starts. */
export function entryAge(fields: Record<string, string>, otherText = ''): number | null {
  for (const [k, v] of Object.entries(fields)) {
    if (/^age$/i.test(k.trim())) {
      const m = /^\s*(\d{1,3})\b/.exec(v) ?? /^\s*([a-z]+)/i.exec(v);
      const n = m ? ageNumber(m[1]) : null;
      if (n !== null) return n;
    }
  }
  const m = /(?:^|\n)\s*age\s*[:\-–]\s*(\d{1,3})\b/i.exec([...Object.values(fields), otherText].join('\n'));
  return m ? +m[1] : null;
}

/** Each scene's date from the timeline: an event linked to the scene, otherwise to its chapter (the earliest such event). */
export function sceneDates(
  events: readonly { when: string; sceneId: string | null; chapterId: string | null }[],
  scenes: readonly { sceneId: string; chapterId: string }[],
): Map<string, StoryDate> {
  const bySceneEvent = new Map<string, StoryDate>();
  const byChapterEvent = new Map<string, StoryDate>();
  const keepEarliest = (m: Map<string, StoryDate>, k: string, d: StoryDate) => {
    const prev = m.get(k);
    if (!prev || d.years < prev.years) m.set(k, d);
  };
  for (const e of events) {
    const d = parseStoryDate(e.when);
    if (!d) continue;
    if (e.sceneId) keepEarliest(bySceneEvent, e.sceneId, d);
    else if (e.chapterId) keepEarliest(byChapterEvent, e.chapterId, d);
  }
  const out = new Map<string, StoryDate>();
  for (const s of scenes) {
    const d = bySceneEvent.get(s.sceneId) ?? byChapterEvent.get(s.chapterId);
    if (d) out.set(s.sceneId, d);
  }
  return out;
}

export interface AgeIssue {
  key: string;
  characterId: string;
  characterName: string;
  /** The age that doesn't fit. */
  fact: PlacedFact;
  /** The earlier age it's measured against, when it isn't the birth date. */
  earlier: PlacedFact | null;
  /** The age expected there, e.g. "19" or "18 or 19". */
  expected: string;
  message: string;
}

const yearsText = (y: number) => {
  const r = Math.round(y * 10) / 10;
  if (r < 1) {
    const months = Math.max(1, Math.round(y * 12));
    return `${months} month${months === 1 ? '' : 's'}`;
  }
  return `${Number.isInteger(r) ? r : r.toFixed(1)} year${r === 1 ? '' : 's'}`;
};

/**
 * Ages a person can be `elapsed` years after being `age` (their birthday can fall anywhere in between), widened by
 * `slack` years when a date is only a year.
 */
function possibleAges(age: number, elapsed: number, slack: number): [number, number] {
  return [Math.floor(age + elapsed - slack), Math.floor(age + 1 + elapsed + slack - 0.001)];
}

/** Half a year of uncertainty for each date that is only a year (taken as mid-year). */
const slackOf = (...d: StoryDate[]) => d.filter((x) => x.yearOnly).length * 0.5;
const firstName = (name: string) => name.trim().split(/\s+/)[0];
const rangeText = ([lo, hi]: [number, number]) => (lo === hi ? String(lo) : hi === lo + 1 ? `${lo} or ${hi}` : `${lo}–${hi}`);

/**
 * Ages that don't fit the timeline. Each character's dated ages are checked against their birth date (when the entry
 * has one) and against their previous dated age. Ages in undated scenes are left to the plain contradiction check.
 */
export function findAgeIssues(
  facts: readonly PlacedFact[],
  dates: ReadonlyMap<string, StoryDate>,
  births: ReadonlyMap<string, StoryDate>,
  dismissed: ReadonlySet<string> = new Set(),
  /** Ages on the characters' entries, as at the start of the story (the earliest dated scene). */
  startAges: ReadonlyMap<string, number> = new Map(),
): AgeIssue[] {
  const out: AgeIssue[] = [];
  const byChar = new Map<string, { f: PlacedFact; age: number; date: StoryDate }[]>();
  for (const f of facts) {
    if (f.attribute !== 'age') continue;
    const age = ageNumber(f.value);
    const date = dates.get(f.sceneId);
    if (age === null || !date) continue;
    byChar.set(f.characterId, [...(byChar.get(f.characterId) ?? []), { f, age, date }]);
  }
  // The story's start: its earliest dated scene, in calendar dates and in story time.
  const starts: StoryDate[] = [];
  for (const d of dates.values()) {
    const i = starts.findIndex((x) => comparable(x, d));
    if (i < 0) starts.push(d);
    else if (d.years < starts[i].years) starts[i] = d;
  }
  for (const [characterId, list] of byChar) {
    list.sort((a, b) => a.date.years - b.date.years || a.f.chapterIndex - b.f.chapterIndex);
    const bornAt = births.get(characterId);
    const startAge = startAges.get(characterId);
    let prev: (typeof list)[number] | null = null;
    for (const cur of list) {
      const { f } = cur;
      const born = bornAt && comparable(bornAt, cur.date) ? bornAt : null;
      const start = !born && startAge !== undefined ? starts.find((x) => comparable(x, cur.date)) : undefined;
      if (start && startAge !== undefined) {
        const elapsed = cur.date.years - start.years;
        const range = possibleAges(startAge, elapsed, slackOf(start, cur.date));
        if (cur.age < range[0] || cur.age > range[1]) {
          const key = `continuity|age|${characterId}|entry|${f.sceneId}|${startAge}/${cur.age}`;
          if (!dismissed.has(key))
            out.push({
              key,
              characterId,
              characterName: f.characterName,
              fact: f,
              earlier: null,
              expected: rangeText(range),
              message:
                elapsed > 0.01
                  ? `${f.characterName} is ${f.value} here (${cur.date.label}), but ${firstName(f.characterName)}’s entry says ${startAge} at the start (${start.label}), ${yearsText(elapsed)} earlier, so ${rangeText(range)} would fit.`
                  : `${f.characterName} is ${f.value} here, but ${firstName(f.characterName)}’s entry says ${startAge}.`,
            });
          if (dismissed.has(key)) prev = cur;
          continue;
        }
      }
      if (born) {
        const elapsed = cur.date.years - born.years;
        const slack = slackOf(born, cur.date);
        const range: [number, number] = [Math.floor(elapsed - slack), Math.floor(elapsed + slack)];
        if (cur.age < range[0] || cur.age > range[1]) {
          const key = `continuity|age|${characterId}|born|${f.sceneId}|${cur.age}`;
          if (!dismissed.has(key))
            out.push({
              key,
              characterId,
              characterName: f.characterName,
              fact: f,
              earlier: null,
              expected: rangeText(range),
              message: `${f.characterName} is ${f.value} here (${cur.date.label}), but born ${born.label} makes them ${rangeText(range)}.`,
            });
          // A wrong age isn't what later ages are measured from (unless the author said it's fine).
          if (dismissed.has(key)) prev = cur;
          continue;
        }
      }
      if (prev && prev.f.sceneId !== f.sceneId && comparable(prev.date, cur.date)) {
        const elapsed = cur.date.years - prev.date.years;
        const range = possibleAges(prev.age, elapsed, slackOf(prev.date, cur.date));
        if (cur.age < range[0] || cur.age > range[1]) {
          const key = `continuity|age|${characterId}|${prev.f.sceneId}|${f.sceneId}|${prev.age}/${cur.age}`;
          if (!dismissed.has(key))
            out.push({
              key,
              characterId,
              characterName: f.characterName,
              fact: f,
              earlier: prev.f,
              expected: rangeText(range),
              message: `${f.characterName} is ${f.value} here (${cur.date.label}), but ${prev.f.value} in “${prev.f.chapterTitle}” (${prev.date.label}), ${yearsText(Math.abs(elapsed))} ${elapsed >= 0 ? 'earlier' : 'later'}, so ${rangeText(range)} would fit.`,
            });
          if (!dismissed.has(key)) continue;
        }
      }
      prev = cur;
    }
  }
  return out.sort((a, b) => a.fact.chapterIndex - b.fact.chapterIndex);
}
