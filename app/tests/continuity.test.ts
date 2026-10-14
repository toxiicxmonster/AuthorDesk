import { Editor } from '@tiptap/core';
import { db, resetDbForTests } from '../src/storage/db';
import { createChapter, createProject, createScene, saveSceneContent } from '../src/storage/repo';
import { createReference } from '../src/domain/references';
import { plainTextToDoc } from '../src/domain/text';
import { editorExtensions } from '../src/editor/extensions';
import { getSuggestions } from '../src/editor/proofreadExtension';
import { runProofread } from '../src/editor/proofreadRunner';
import { deathChapter, findContradictions, findDeathIssues, placeFacts, type ContinuityScene } from '../src/proofreading/continuity';

const winnie = { id: 'w', name: 'Winnie Hartley', aliases: [], appearance: '', status: '' };
const tom = { id: 't', name: 'Tom Reyes', aliases: [], appearance: '', status: 'deceased, Ch. 2' };
const scene = (chapterIndex: number, ...paragraphs: string[]): ContinuityScene => ({ sceneId: `s${chapterIndex}`, chapterIndex, chapterTitle: `Chapter ${chapterIndex + 1}`, paragraphs });

describe('continuity across the book', () => {
  it('finds a detail described differently in two chapters, earliest first', () => {
    const scenes = [scene(0, 'Winnie’s green eyes narrowed.'), scene(3, 'Nothing about her here.'), scene(8, 'Winnie turned her grey eyes to the sea.')];
    const [c] = findContradictions(placeFacts(scenes, [winnie]));
    expect(c).toMatchObject({ characterName: 'Winnie Hartley', label: 'Eyes' });
    expect(c.first).toMatchObject({ value: 'green', chapterTitle: 'Chapter 1', original: 'green eyes' });
    expect(c.other).toMatchObject({ value: 'grey', chapterTitle: 'Chapter 9', sceneId: 's8' });
  });

  it('treats spellings and shades of the same thing as consistent', () => {
    const scenes = [scene(0, 'Winnie’s grey eyes narrowed.'), scene(1, 'Winnie lifted her gray eyes.')];
    expect(findContradictions(placeFacts(scenes, [winnie]))).toEqual([]);
  });

  it('only calls builds contradictory when they’re opposites, and notes that ages can change', () => {
    const builds = [scene(0, 'Winnie was tall for her age.'), scene(1, 'Winnie was lanky as ever.'), scene(2, 'Winnie was petite.')];
    expect(findContradictions(placeFacts(builds, [winnie])).map((c) => `${c.first.value}/${c.other.value}`)).toEqual(['tall/petite']);
    const ages = [scene(0, 'Winnie, seventeen, ran the shop.'), scene(5, 'Winnie, nineteen, sold the shop.')];
    expect(findContradictions(placeFacts(ages, [winnie]))[0].note).toMatch(/time has passed/);
  });

  it('remembers contradictions marked as changed on purpose', () => {
    const scenes = [scene(0, 'Winnie’s auburn hair was loose.'), scene(4, 'Winnie pushed her black hair back.')];
    const [c] = findContradictions(placeFacts(scenes, [winnie]));
    expect(findContradictions(placeFacts(scenes, [winnie]), new Set([c.key]))).toEqual([]);
  });

  it('reads the chapter of death from the entry status', () => {
    expect(deathChapter('deceased, Ch. 14')).toBe(13);
    expect(deathChapter('Killed in chapter 9')).toBe(8);
    expect(deathChapter('dead')).toBeNull(); // no chapter: nothing to compare against
    expect(deathChapter('alive, missing')).toBeNull();
  });

  it('flags a character speaking after their death', () => {
    const names = ['Tom Reyes', 'Winnie Hartley'];
    const scenes = [scene(0, '“Run,” Tom said.'), scene(1, 'Tom fell.'), scene(4, '“I’m back,” said Tom.', '“Hello,” Winnie said.')];
    const issues = findDeathIssues(scenes, [tom, winnie], names);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ characterName: 'Tom Reyes', diedIn: 1, chapterTitle: 'Chapter 5', text: '“I’m back,”' });
    expect(findDeathIssues(scenes, [tom], names, new Set([issues[0].key]))).toEqual([]);
  });
});

describe('continuity in the editor', () => {
  beforeEach(() => resetDbForTests());

  it('marks this scene’s detail in purple when another chapter says otherwise, and a dead character speaking', async () => {
    const { project, book } = await createProject('Continuity');
    await createReference(project.id, 'character', 'Winnie Hartley');
    const tomRef = await createReference(project.id, 'character', 'Tom Reyes');
    await db.references.update(tomRef.id, { status: 'deceased, Ch. 1' });
    const ch1 = (await db.chapters.where('bookId').equals(book.id).toArray())[0];
    const s1 = (await db.scenes.where('chapterId').equals(ch1.id).toArray())[0];
    await saveSceneContent(s1.id, plainTextToDoc('Winnie’s green eyes narrowed at the sea.'));
    const ch2 = await createChapter(project.id, book.id, 'The Return', { withScene: false });
    const s2 = await createScene(project.id, ch2.id, 'Scene 1');

    const ed = new Editor({ extensions: editorExtensions(), content: '<p>Winnie turned her grey eyes to the harbour.</p><p>“I’m back,” said Tom.</p>' });
    const before = ed.getHTML();
    await runProofread(ed, project.id, { sceneId: s2.id });
    const marks = getSuggestions(ed.state).filter((s) => s.ruleId.startsWith('continuity'));
    expect(marks.map((m) => m.ruleId).sort()).toEqual(['continuity', 'continuity-death']);
    const eyes = marks.find((m) => m.ruleId === 'continuity')!;
    expect(eyes).toMatchObject({ severity: 'conflict', original: 'grey eyes' });
    expect(eyes.message).toMatch(/Winnie Hartley’s eyes are “grey” here, but “green” earlier in “Chapter 1”/);
    expect(eyes.data).toMatchObject({ otherSceneId: s1.id, otherFind: 'green eyes' });
    expect(marks.find((m) => m.ruleId === 'continuity-death')!.message).toMatch(/says “deceased, Ch. 1”, but they speak here/);
    expect(ed.getHTML()).toBe(before);

    // "It changed on purpose" is remembered.
    await db.ignored.put({ id: eyes.data!.ignoreKey, projectId: project.id, ruleId: 'continuity', key: eyes.data!.ignoreKey });
    await runProofread(ed, project.id, { sceneId: s2.id });
    expect(getSuggestions(ed.state).filter((s) => s.ruleId === 'continuity')).toEqual([]);
    ed.destroy();
  });
});
