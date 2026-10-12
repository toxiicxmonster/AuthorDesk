import { runRules, applySuggestion, dedupe } from '../src/proofreading/rules';
import type { ProofreadContext, Suggestion } from '../src/proofreading/types';

const ctx = (over: Partial<ProofreadContext> = {}): ProofreadContext => ({
  dialect: 'en-US',
  disabledRules: new Set(),
  disabledCategories: new Set(),
  dictionary: new Set(),
  knownNames: [],
  ...over,
});

const find = (text: string, rule: string, c = ctx()) => runRules(text, c).filter((s) => s.ruleId === rule || s.ruleId.startsWith(rule));

describe('proofreading rules', () => {
  it('flags repeated words with correct offsets', () => {
    const text = 'She walked to the the door.';
    const [s] = find(text, 'repeated-word');
    expect(s).toBeDefined();
    expect(text.slice(s.start, s.end)).toBe('the the');
    expect(applySuggestion(text, s, s.replacements[0])).toBe('She walked to the door.');
  });

  it('allows legitimate repeats like "had had"', () => {
    expect(find('He had had enough.', 'repeated-word')).toHaveLength(0);
  });

  it('flags lowercase sentence starts but not abbreviations', () => {
    expect(find('It ended. then it began.', 'sentence-capital')).toHaveLength(1);
    expect(find('She met Mr. smith at noon.', 'sentence-capital')).toHaveLength(0);
    expect(find('It cost 3.5 dollars. e.g. this', 'sentence-capital')).toHaveLength(0);
  });

  it('capitalizes the pronoun I', () => {
    const r = find('Then i said no, and i’m sure.', 'lowercase-i');
    expect(r).toHaveLength(2);
    expect(r[0].replacements).toEqual(['I']);
  });

  it('catches commonly confused words', () => {
    const text = 'I could of gone. It was better then nothing.';
    const r = find(text, 'confused');
    expect(r.map((s) => s.replacements[0])).toEqual(['could have', 'better than']);
  });

  it('suggests a/an', () => {
    expect(find('She ate a apple.', 'a-an-vowel')[0].replacements[0]).toBe('an apple');
    expect(find('It was a unicorn.', 'a-an-vowel')).toHaveLength(0);
    expect(find('Wait an hour.', 'an-a-consonant')).toHaveLength(0);
  });

  it('flags dialogue punctuation before speech tags', () => {
    const text = '"I know." she said.';
    const [s] = find(text, 'dialogue-period-before-tag');
    expect(s).toBeDefined();
    expect(applySuggestion(text, s, s.replacements[0])).toBe('"I know," she said.');
  });

  it('respects the dialect setting', () => {
    expect(find('The colour was grey.', 'dialect', ctx({ dialect: 'en-US' })).map((s) => s.replacements[0])).toEqual(['color', 'gray']);
    expect(find('The color was gray.', 'dialect', ctx({ dialect: 'en-GB' })).map((s) => s.replacements[0])).toEqual(['colour', 'grey']);
  });

  it('flags inconsistent spellings of known names', () => {
    const c = ctx({ knownNames: ['Elara Voss', 'Kethmoor'] });
    const r = find('Elera walked into Kethmoor with elara.', 'name-consistency', c);
    expect(r.map((s) => [s.original, s.replacements[0]])).toEqual([
      ['Elera', 'Elara'],
      ['elara', 'Elara'],
    ]);
  });

  it('does not flag ordinary words that are only part of a longer name', () => {
    const c = ctx({ knownNames: ['The Salt Lamp', 'Gull Point Light', 'Elara Voss'] });
    expect(find('The lamp was a light at the point, said elara.', 'name-consistency', c).map((x) => x.original)).toEqual(['elara']);
  });

  it('skips words in the custom dictionary', () => {
    const c = ctx({ knownNames: ['Elara'], dictionary: new Set(['elera']) });
    expect(find('Elera smiled.', 'name-consistency', c)).toHaveLength(0);
  });

  it('marks style suggestions as style, not errors', () => {
    const r = runRules('He ran quickly.', ctx());
    const adverb = r.find((s) => s.ruleId === 'adverb');
    expect(adverb?.severity).toBe('style');
  });

  it('honours disabled categories and rules', () => {
    expect(runRules('He ran quickly.', ctx({ disabledCategories: new Set(['style']) })).some((s) => s.ruleId === 'adverb')).toBe(false);
    expect(runRules('the the', ctx({ disabledRules: new Set(['repeated-word']) })).some((s) => s.ruleId === 'repeated-word')).toBe(false);
  });

  it('never changes text that no longer matches (stale protection)', () => {
    const s: Pick<Suggestion, 'start' | 'end' | 'original'> = { start: 4, end: 11, original: 'the the' };
    expect(applySuggestion('Go! The the end', s, 'the')).toBeNull();
    expect(applySuggestion('Go: the the end', { ...s, start: 4, end: 11 }, 'the')).toBe('Go: the end');
    expect(applySuggestion('short', { start: 10, end: 20, original: 'x' }, 'y')).toBeNull();
  });

  it('dedupes overlapping non-style suggestions, keeping the most severe', () => {
    const base = { original: 'x', replacements: [], message: '', ruleId: 'r', providerId: 'p', category: 'grammar' as const };
    const out = dedupe([
      { ...base, start: 0, end: 5, severity: 'warning' },
      { ...base, start: 2, end: 4, severity: 'error' },
      { ...base, start: 1, end: 3, severity: 'style' },
    ]);
    expect(out.map((s) => s.severity).sort()).toEqual(['error', 'style']);
  });

  it('produces offsets that always point at the original text', () => {
    const text = 'Teh  cat sat ,on the the mat. i think its a good mat.Then';
    for (const s of runRules(text, ctx())) expect(text.slice(s.start, s.end)).toBe(s.original);
  });
});
