import { runRules } from '../src/proofreading/rules';
import { combine } from '../src/proofreading/providers';
import { Editor } from '@tiptap/core';
import { knownNameSpans, nameCandidates, newNameSuggestions, protectNames, type WordKind } from '../src/proofreading/names';
import type { Suggestion } from '../src/proofreading/types';
import { resetDbForTests } from '../src/storage/db';
import { createProject } from '../src/storage/repo';
import { createReference } from '../src/domain/references';
import { editorExtensions } from '../src/editor/extensions';
import { getSuggestions } from '../src/editor/proofreadExtension';
import { runProofread } from '../src/editor/proofreadRunner';

const sug = (text: string, original: string, replacements: string[], over: Partial<Suggestion> = {}): Suggestion => {
  const start = text.indexOf(original);
  return { start, end: start + original.length, original, replacements, category: 'spelling', severity: 'error', message: 'm', ruleId: 'spelling', providerId: 'p', ...over };
};

describe('known names are never flagged', () => {
  const names = ['Elara Voss', 'The Salt Road'];

  it('finds names, their parts and possessives, but not stop words', () => {
    const text = 'Elara’s map showed the Salt Road. Voss frowned at the road.';
    const spans = knownNameSpans(text, names).map(([a, b]) => text.slice(a, b));
    expect(spans).toEqual(['Elara', 'the Salt Road', 'Voss', 'road']);
  });

  it('drops spelling, grammar and style hits that would change a name', () => {
    const text = 'Elara walked with Voss. It was a Elara thing.';
    const spans = knownNameSpans(text, names);
    const kept = protectNames(
      text,
      [
        sug(text, 'Elara', ['Clara']),
        sug(text, 'Voss', [], { category: 'style', severity: 'style', ruleId: 'adverb' }),
        sug(text, 'a Elara', ['an Elara'], { category: 'grammar', severity: 'warning', ruleId: 'a-an-vowel' }),
        sug(text, 'walked', ['strolled'], { category: 'repetition', ruleId: 'lt:REP' }),
      ],
      spans,
    );
    expect(kept.map((s) => s.original)).toEqual(['a Elara', 'walked']);
  });

  it('keeps the name-consistency fix (it exists to protect names)', () => {
    const text = 'elara laughed.';
    const s = sug(text, 'elara', ['Elara'], { ruleId: 'name-consistency', category: 'consistency' });
    expect(protectNames(text, [s], knownNameSpans(text, names))).toHaveLength(1);
  });
});

describe('spotting people who are not in the list yet', () => {
  const ctx = { dictionary: new Set<string>(['zorvath']), knownNames: ['Elara Voss'] };
  const kinds: Record<string, WordKind> = { Betty: 'proper', Her: 'common', Later: 'common', Sarah: 'proper', London: 'proper', Rose: 'common', Then: 'common', The: 'common', She: 'common' };
  const kindOf = (w: string): WordKind => kinds[w] ?? 'unknown';
  const prompts = (...texts: string[]) =>
    newNameSuggestions(texts, nameCandidates(texts, ctx), kindOf, (w) => (w === 'Thorne' ? ['Thorn'] : []))
      .flat()
      .map((s) => s.original);

  it('prompts for an invented name used mid-sentence, as a speaker, or twice', () => {
    expect(prompts('The guard saw Thorne at the gate.')).toEqual(['Thorne']);
    expect(prompts('“Wait,” Kesh said.')).toEqual(['Kesh']);
    expect(prompts('Mira ran. Mira hid.')).toEqual(['Mira', 'Mira']);
  });

  it('leaves a lone capital at a sentence start to the spelling check (could be a typo)', () => {
    expect(prompts('Thorne drew his sword.')).toEqual([]);
    expect(prompts('He said, “Teh end.”')).toEqual([]);
  });

  it('dictionary names need to act like a person; ordinary words need to, mid-sentence', () => {
    expect(prompts('Sarah smiled.')).toEqual(['Sarah']);
    expect(prompts('London is big.')).toEqual([]);
    expect(prompts('Then Rose said no.')).toEqual(['Rose']);
    expect(prompts('Rose petals fell. She said no.')).toEqual([]);
  });

  it('sees a full name whole, even when the surname is already listed (relatives share it)', () => {
    const family = { dictionary: new Set<string>(), knownNames: ['Winnie Hartley'] };
    const k = (w: string): WordKind => ({ Betty: 'proper', Then: 'common', New: 'common', York: 'proper' } as Record<string, WordKind>)[w] ?? 'unknown';
    const run = (text: string) => newNameSuggestions([text], nameCandidates([text], family), k).flat().map((s) => s.original);
    expect(run('Winnie Hartley visited her grandma Betty Hartley.')).toEqual(['Betty Hartley']);
    expect(run('Then Betty Hartley arrived.')).toEqual(['Betty Hartley']);
    expect(run('Winnie Hartley laughed.')).toEqual([]);
    expect(run('Hartley laughed.')).toEqual([]);
    // Two ordinary words are not a name by themselves.
    expect(run('They flew to New York.')).toEqual([]);
  });

  it('a lowercase family word marks a person', () => {
    expect(prompts('She called her grandma Betty.')).toEqual(['Betty']);
    expect(prompts('Her cousin Dell waved.')).toEqual(['Dell']);
  });

  it('a title marks a person', () => {
    expect(prompts('It belonged to Captain Ardent.')).toEqual(['Ardent']);
  });

  it('skips listed names, dictionary words, days, months and “I”', () => {
    expect(prompts('Later Elara and Voss met Zorvath on Monday in May, and I said so.')).toEqual([]);
  });

  it('offers typo fixes on the prompt for invented words', () => {
    const texts = ['The guard saw Thorne.'];
    const [[s]] = newNameSuggestions(texts, nameCandidates(texts, ctx), kindOf, () => ['Thorn']);
    expect(s).toMatchObject({ ruleId: 'new-name', replacements: ['Thorn'], category: 'consistency' });
    expect(s.message).toMatch(/isn’t in your characters & world list/);
  });
});

describe('in the editor', () => {
  beforeEach(() => resetDbForTests());

  it('never marks a listed name, and prompts for an unlisted one instead of flagging it', async () => {
    const { project } = await createProject('Names');
    await createReference(project.id, 'character', 'Elara');
    const ed = new Editor({ extensions: editorExtensions(), content: '<p>Then elara met Thorne by the gate. Thorne said nothing to Elara.</p>' });
    await runProofread(ed, project.id);
    const found = getSuggestions(ed.state).map((s) => `${s.ruleId}:${s.original}`);
    expect(found).toContain('new-name:Thorne');
    expect(found).toContain('name-consistency:elara');
    expect(found.filter((f) => f.endsWith(':Elara'))).toEqual([]);
    ed.destroy();
  });
  it('doesn’t ask for a capital on an ordinary word that starts a place’s name', () => {
    // The rule flags both; the dictionary lookup (in the spelling worker) then cancels the real word only.
    const ctx = { dialect: 'en-US' as const, disabledRules: new Set<string>(), disabledCategories: new Set<string>(), dictionary: new Set<string>(), knownNames: ['Glass Health Hospital', 'Elara'] };
    const hits = runRules('My half-empty glass of milk, and elara.', ctx).filter((s) => s.ruleId === 'name-consistency');
    expect(hits.map((h) => h.original)).toEqual(['glass', 'elara']);
    expect(combine(hits, [], new Set(['glass'])).map((h) => h.original)).toEqual(['elara']);
  });
});
