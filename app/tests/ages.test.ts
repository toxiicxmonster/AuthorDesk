import { Editor } from '@tiptap/core';
import { db, resetDbForTests } from '../src/storage/db';
import { createChapter, createProject, createRecord, createScene, saveSceneContent } from '../src/storage/repo';
import { createReference } from '../src/domain/references';
import { plainTextToDoc } from '../src/domain/text';
import { editorExtensions } from '../src/editor/extensions';
import { getSuggestions } from '../src/editor/proofreadExtension';
import { runProofread } from '../src/editor/proofreadRunner';
import { findContradictions, placeFacts, type ContinuityScene } from '../src/proofreading/continuity';
import { ageNumber, birthDate, entryAge, findAgeIssues, parseStoryDate, sceneDates, type StoryDate } from '../src/proofreading/ages';

const winnie = { id: 'w', name: 'Winnie Hartley', aliases: [], appearance: '' };
const scene = (chapterIndex: number, text: string): ContinuityScene => ({ sceneId: `s${chapterIndex}`, chapterId: `c${chapterIndex}`, chapterIndex, chapterTitle: `Chapter ${chapterIndex + 1}`, paragraphs: [text] });
const date = (when: string) => parseStoryDate(when)!;

describe('story dates', () => {
  it('reads the ways authors write dates', () => {
    expect(parseStoryDate('2019-03-14')).toMatchObject({ yearOnly: false });
    expect(parseStoryDate('2019-03-14')!.years).toBeCloseTo(2019 + 2 / 12 + 13 / 365);
    expect(parseStoryDate('14 March 2019')!.years).toBeCloseTo(parseStoryDate('2019-03-14')!.years);
    expect(parseStoryDate('March 14th, 2019')!.years).toBeCloseTo(parseStoryDate('2019-03-14')!.years);
    expect(parseStoryDate('Summer 2021')!.years).toBeCloseTo(2021.5);
    expect(parseStoryDate('the winter of 1998, before the fire')).toMatchObject({ yearOnly: false });
    expect(parseStoryDate('1998')).toMatchObject({ yearOnly: true });
    expect(parseStoryDate('three days before the siege')).toBeNull();
    expect(parseStoryDate('Day 12')).toMatchObject({ relative: true });
  });

  it('finds a birth date in an entry, and reads ages written as words', () => {
    expect(birthDate('Role: protagonist\nBorn: 3 May 2002 in Halifax')!.years).toBeCloseTo(2002 + 4 / 12 + 2 / 365);
    expect(birthDate('Shy. b. 1998.')).toMatchObject({ yearOnly: true });
    expect(birthDate('Born to be wild')).toBeNull();
    expect(ageNumber('seventeen')).toBe(17);
    expect(ageNumber('42')).toBe(42);
    expect(ageNumber('old')).toBeNull();
  });

  it('dates scenes from events linked to the scene, or else its chapter', () => {
    const dates = sceneDates(
      [
        { when: 'June 2019', sceneId: null, chapterId: 'c1' },
        { when: 'March 2020', sceneId: 's2', chapterId: 'c1' },
        { when: 'sometime later', sceneId: 's3', chapterId: null },
      ],
      [
        { sceneId: 's1', chapterId: 'c1' },
        { sceneId: 's2', chapterId: 'c1' },
        { sceneId: 's3', chapterId: 'c3' },
      ],
    );
    expect(dates.get('s1')!.label).toBe('June 2019');
    expect(dates.get('s2')!.label).toBe('March 2020');
    expect(dates.has('s3')).toBe(false);
  });
});

describe('ages against the timeline', () => {
  const scenes = [scene(2, 'Winnie, seventeen, ran for the bus.'), scene(11, 'Winnie was sixteen and furious.'), scene(14, 'Winnie was nineteen by then.')];
  const facts = placeFacts(scenes, [winnie]);

  it('flags an age that doesn’t fit the time between two dated scenes', () => {
    const dates = new Map<string, StoryDate>([
      ['s2', date('March 2019')],
      ['s11', date('March 2021')],
      ['s14', date('April 2021')],
    ]);
    const issues = findAgeIssues(facts, dates, new Map());
    expect(issues).toHaveLength(1);
    expect(issues[0].fact.chapterTitle).toBe('Chapter 12');
    expect(issues[0].expected).toBe('19');
    expect(issues[0].message).toMatch(/Winnie Hartley is sixteen here \(March 2021\), but seventeen in “Chapter 3” \(March 2019\), 2 years earlier, so 19 would fit/);
    // The plain "differs elsewhere" warning steps aside for dated scenes.
    expect(findContradictions(facts, new Set(), new Set(dates.keys())).filter((c) => c.label === 'Age')).toEqual([]);
  });

  it('accepts ages that grow with the timeline, and flags one that stays put for years', () => {
    const fits = new Map<string, StoryDate>([
      ['s2', date('2019-03-01')],
      ['s14', date('2021-06-01')],
    ]);
    expect(findAgeIssues(placeFacts([scenes[0], scenes[2]], [winnie]), fits, new Map())).toEqual([]);
    const stuck = placeFacts([scene(1, 'Winnie, seventeen, waited.'), scene(9, 'Winnie, seventeen, waited again.')], [winnie]);
    const issues = findAgeIssues(stuck, new Map([['s1', date('2015')], ['s9', date('2020')]]), new Map());
    expect(issues).toHaveLength(1);
  });

  it('checks ages against the birth date in the character’s entry', () => {
    const dates = new Map<string, StoryDate>([['s2', date('2019-03-01')]]);
    expect(findAgeIssues(facts, dates, new Map([['w', date('2002-01-10')]]))).toEqual([]);
    const [issue] = findAgeIssues(facts, dates, new Map([['w', date('2004-01-10')]]));
    expect(issue.message).toMatch(/is seventeen here \(2019-03-01\), but born 2004-01-10 makes them 15\./);
    // Only a birth year: a year's leeway either way.
    expect(findAgeIssues(facts, dates, new Map([['w', date('2001')]]))).toEqual([]);
  });

  it('reads story time, and never compares it with calendar dates', () => {
    expect(parseStoryDate('day 1 7:32 P.M.')).toMatchObject({ years: 0, relative: true });
    expect(parseStoryDate('Day 366')!.years).toBeCloseTo(365 / 365.25);
    expect(parseStoryDate('Year 3')).toMatchObject({ years: 2, yearOnly: true, relative: true });
    const mixed = new Map<string, StoryDate>([['s2', date('March 2019')], ['s11', date('Day 400')]]);
    expect(findAgeIssues(facts, mixed, new Map())).toEqual([]);
  });

  it('checks ages against the Age on the entry, as at the start of the story', () => {
    // Like Winnie in "Wearing His But Choosing Yours": Age 21 on her entry, Chapter 1 on day 1.
    const start = [scene(0, 'Winnie, nineteen, unlocked the shop.'), scene(5, 'Winnie, twenty-two, wait.'), scene(9, 'Winnie was twenty and tired.')];
    const f = placeFacts(start, [winnie]);
    const dates = new Map<string, StoryDate>([['s0', date('day 1 7:32 P.M.')], ['s9', date('Day 30')]]);
    const issues = findAgeIssues(f, dates, new Map(), new Set(), new Map([['w', 21]]));
    expect(issues.map((i) => i.fact.chapterTitle)).toEqual(['Chapter 1', 'Chapter 10']);
    expect(issues[0].message).toBe('Winnie Hartley is nineteen here, but Winnie’s entry says 21.');
    expect(issues[1].message).toMatch(/is twenty here \(Day 30\), but Winnie’s entry says 21 at the start \(day 1 7:32 P.M.\), 1 month earlier, so 21 or 22 would fit/);
    expect(findAgeIssues(f, dates, new Map(), new Set(), new Map([['w', 19]]))).toEqual([]); // 19 on day 1 can be 20 a month later
    expect(entryAge({ Age: '21' })).toBe(21);
    expect(entryAge({ age: 'twenty-ish' })).toBe(20);
    expect(entryAge({ appearance: 'Tall.\nAge: 34' })).toBe(34);
    expect(entryAge({ appearance: 'Ageless' })).toBeNull();
  });

  it('remembers "This is fine"', () => {
    const dates = new Map<string, StoryDate>([['s2', date('March 2019')], ['s11', date('March 2021')]]);
    const [issue] = findAgeIssues(facts, dates, new Map());
    expect(findAgeIssues(facts, dates, new Map(), new Set([issue.key]))).toEqual([]);
  });
});

describe('age marks in the editor', () => {
  beforeEach(() => resetDbForTests());

  it('underlines an age that doesn’t fit the timeline, linking to the earlier one', async () => {
    const { project, book } = await createProject('Ages');
    await createReference(project.id, 'character', 'Winnie Hartley');
    const ch1 = (await db.chapters.where('bookId').equals(book.id).toArray())[0];
    const s1 = (await db.scenes.where('chapterId').equals(ch1.id).toArray())[0];
    await saveSceneContent(s1.id, plainTextToDoc('Winnie, seventeen, ran for the bus.'));
    const ch2 = await createChapter(project.id, book.id, 'Later', { withScene: false });
    const s2 = await createScene(project.id, ch2.id, 'Scene 1');
    const event = { description: '', characterIds: [], locationId: null, plotThreadIds: [], bookId: book.id, sortKey: null };
    await createRecord('timelineEvents', project.id, { ...event, title: 'The bus', when: 'March 2019', chapterId: ch1.id, sceneId: null });
    await createRecord('timelineEvents', project.id, { ...event, title: 'Graduation', when: 'June 2022', chapterId: ch2.id, sceneId: s2.id });

    const ed = new Editor({ extensions: editorExtensions(), content: '<p>Winnie was eighteen and furious.</p>' });
    await runProofread(ed, project.id, { sceneId: s2.id });
    const marks = getSuggestions(ed.state).filter((s) => s.ruleId.startsWith('continuity'));
    expect(marks.map((m) => m.ruleId)).toEqual(['continuity-age']);
    expect(marks[0]).toMatchObject({ severity: 'conflict', original: 'eighteen' });
    expect(marks[0].message).toMatch(/so 20 or 21 would fit/);
    expect(marks[0].data).toMatchObject({ otherSceneId: s1.id, otherFind: 'seventeen' });
    ed.destroy();
  });
});
