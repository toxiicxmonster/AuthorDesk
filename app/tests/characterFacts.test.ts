import { Editor } from '@tiptap/core';
import { applyFact, findCharacterFacts, type CharacterInfo } from '../src/proofreading/characterFacts';
import { resetDbForTests } from '../src/storage/db';
import { createProject } from '../src/storage/repo';
import { createReference } from '../src/domain/references';
import { editorExtensions } from '../src/editor/extensions';
import { getSuggestions } from '../src/editor/proofreadExtension';
import { runProofread } from '../src/editor/proofreadRunner';

const winnie: CharacterInfo = { id: 'w', name: 'Winnie Hartley', aliases: [], appearance: '' };
const mara: CharacterInfo = { id: 'm', name: 'Mara Quill', aliases: [], appearance: '' };
const facts = (text: string, chars: CharacterInfo[] = [winnie], prev = '') =>
  findCharacterFacts(text, chars, prev).map((f) => `${f.characterName}|${f.label}|${f.value}|${f.existing ?? '-'}|${f.original}`);

describe('character details', () => {
  it('spots a detail the entry lacks, by pronoun, possessive or name', () => {
    expect(facts('Winnie pushed her auburn hair out of her eyes.')).toEqual(['Winnie Hartley|Hair|auburn|-|auburn hair']);
    expect(facts('Winnie’s green eyes narrowed.')).toEqual(['Winnie Hartley|Eyes|green|-|green eyes']);
    expect(facts('Winnie had freckles across her nose.')).toEqual(['Winnie Hartley|Freckles|freckles|-|freckles']);
    expect(facts('Winnie was tall for her age.')).toEqual(['Winnie Hartley|Build|tall|-|tall']);
    expect(facts('Winnie, seventeen, ran the shop.')).toEqual(['Winnie Hartley|Age|seventeen|-|seventeen']);
    expect(facts('The seventeen-year-old Winnie ran the shop.')).toEqual(['Winnie Hartley|Age|seventeen|-|seventeen-year-old']);
  });

  it('uses the paragraph before for a pronoun, when only one character was named there', () => {
    expect(facts('She tucked her curly red hair behind an ear.', [winnie], 'Winnie came in from the rain.')).toEqual(['Winnie Hartley|Hair|red|-|curly red hair']);
  });

  it('never guesses when two listed characters could be meant', () => {
    expect(facts('Winnie and Mara sat. She pushed her auburn hair back.', [winnie, mara])).toEqual([]);
    expect(facts('Mara’s auburn hair shone.', [winnie, mara])).toEqual(['Mara Quill|Hair|auburn|-|auburn hair']);
  });

  it('says nothing when the entry already agrees, and flags a contradiction', () => {
    const known = { ...winnie, appearance: 'Hair: auburn\nGreen eyes, freckles.' };
    expect(facts('Winnie pushed her auburn hair back. Her green eyes and freckles…', [known])).toEqual([]);
    const black = { ...winnie, appearance: 'Long black hair.' };
    expect(facts('Winnie pushed her auburn hair back.', [black])).toEqual(['Winnie Hartley|Hair|auburn|black|auburn hair']);
  });

  it('ignores details with nobody to attach them to', () => {
    expect(facts('The stranger’s red hair caught the light.')).toEqual([]);
    expect(facts('The dog had brown eyes.')).toEqual([]);
  });

  it('adds lines, and updates exactly what was there', () => {
    expect(applyFact('', { attribute: 'hair', label: 'Hair', value: 'auburn', existing: null })).toBe('Hair: auburn');
    expect(applyFact('Tall and thin.', { attribute: 'feature', label: 'Freckles', value: 'freckles', existing: null })).toBe('Tall and thin.\nFreckles: yes');
    expect(applyFact('Hair: black\nEyes: grey', { attribute: 'hair', label: 'Hair', value: 'auburn', existing: 'black' })).toBe('Hair: auburn\nEyes: grey');
    expect(applyFact('Long black hair.', { attribute: 'hair', label: 'Hair', value: 'auburn', existing: 'black' })).toBe('Long auburn hair.');
  });
});

describe('character details in the editor', () => {
  beforeEach(() => resetDbForTests());

  const run = async (appearance: string) => {
    const { project } = await createProject('Details');
    await createReference(project.id, 'character', 'Winnie Hartley', { fields: { appearance } });
    const ed = new Editor({ extensions: editorExtensions(), content: '<p>Winnie pushed her auburn hair out of her eyes.</p>' });
    const before = ed.getHTML();
    await runProofread(ed, project.id);
    const marks = getSuggestions(ed.state).filter((s) => s.ruleId.startsWith('character-'));
    expect(ed.getHTML()).toBe(before); // never touches the manuscript
    ed.destroy();
    return marks;
  };

  it('marks a missing detail green, with what to add', async () => {
    const [m] = await run('');
    expect(m).toMatchObject({ ruleId: 'character-fact', severity: 'note', original: 'auburn hair' });
    expect(m.data).toMatchObject({ label: 'Hair', value: 'auburn', ignoreKey: expect.stringContaining('|Hair') });
    expect(m.message).toMatch(/doesn’t mention hair yet/);
  });

  it('marks a contradiction purple', async () => {
    const [m] = await run('Long black hair.');
    expect(m).toMatchObject({ ruleId: 'character-conflict', severity: 'conflict' });
    expect(m.message).toMatch(/says hair: black, but here it’s auburn/);
  });

  it('shows nothing when the entry already agrees', async () => {
    expect(await run('Hair: auburn')).toEqual([]);
  });
});
