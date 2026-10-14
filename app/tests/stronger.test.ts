import { runRules } from '../src/proofreading/rules';
import { strongerWords } from '../src/proofreading/stronger';

const ctx = { dialect: 'en-US' as const, disabledRules: new Set<string>(), disabledCategories: new Set<string>(), dictionary: new Set<string>(), knownNames: [] };
const fix = (text: string, rule: string) => runRules(text, ctx).find((s) => s.ruleId === rule);

describe('stronger words instead of adverbs', () => {
  it('replaces a verb + adverb with one precise verb, keeping the tense', () => {
    expect(strongerWords('She ran quickly to the gate.')[0]).toMatchObject({ original: 'ran quickly', replacements: ['sprinted', 'raced', 'dashed'] });
    expect(strongerWords('He is walking slowly home.')[0].replacements).toEqual(['ambling', 'strolling', 'sauntering']);
    expect(strongerWords('“Go,” he said angrily.')[0].replacements).toContain('snapped');
    expect(strongerWords('She quickly ate the bread.')[0]).toMatchObject({ original: 'quickly ate', replacements: ['devoured', 'gobbled', 'wolfed'] });
    expect(strongerWords('He closed loudly.')[0].replacements).toEqual(['slammed']);
  });

  it('replaces “very” + adjective with a single stronger word, matching capitals', () => {
    expect(strongerWords('I was very tired.')[0]).toMatchObject({ original: 'very tired', replacements: ['exhausted', 'drained', 'weary'] });
    expect(strongerWords('Really big waves.')[0].replacements[0]).toBe('Huge');
  });

  it('runs as a style suggestion with real options', () => {
    const s = fix('She looked angrily at him.', 'stronger-word')!;
    expect(s.replacements).toEqual(['glared', 'scowled']);
    expect(s.message).toMatch(/precise verb/);
  });

  it('finds the adverb a few words after its verb, keeping the words between', () => {
    expect(strongerWords('He closed the door loudly.')[0]).toMatchObject({ original: 'closed the door loudly', replacements: ['slammed the door'] });
    expect(strongerWords('She walked across the room slowly.')[0]).toMatchObject({ original: 'walked across the room slowly', replacements: ['ambled across the room', 'strolled across the room', 'sauntered across the room'] });
    expect(strongerWords('He looked at her angrily.')[0].replacements).toEqual(['glared at her', 'scowled at her']);
    expect(strongerWords('“Fine,” she said it quietly.')[0].replacements[0]).toBe('murmured it');
    expect(strongerWords('I hold her hand tightly.')[0].replacements).toEqual(['clutch her hand', 'grip her hand', 'clench her hand']);
  });

  it('doesn’t reach across punctuation, a new clause, or an object an intransitive verb can’t take', () => {
    expect(strongerWords('He closed the door, loudly.')).toEqual([]);
    expect(strongerWords('He closed the door and left quickly.')).toEqual([]);
    expect(strongerWords('She ran the shop quickly.')).toEqual([]);
    expect(strongerWords('She walked the dog slowly.')).toEqual([]);
    expect(strongerWords('He closed the big heavy wooden door loudly.')).toEqual([]);
  });

  it('leaves words alone when they are not a weak pair', () => {
    expect(strongerWords('She ran the shop quickly.')).toEqual([]);
    expect(strongerWords('The very idea!')).toEqual([]);
  });
});

describe('more confused words and idioms', () => {
  it.each([
    ['He tried to sneak a peak at the letter.', 'confused-sneak-a-peek', 'sneak a peek'],
    ['I could care less.', 'confused-could-care-less', "I couldn't care less"],
    ['We will make due.', 'confused-make-do', 'make do'],
    ['That is a mute point.', 'confused-moot-point', 'moot point'],
    ['It was all of the sudden.', 'confused-all-of-a-sudden', 'all of a sudden'],
    ['It didn’t phase me.', 'confused-faze', 'didn’t faze'],
    ['She had to reign in her temper.', 'confused-rein-in', 'rein in'],
    ['He broke it on accident.', 'confused-by-accident', 'by accident'],
  ])('%s', (text, rule, expected) => {
    const s = fix(text, rule);
    expect(s?.replacements[0]).toBe(expected);
  });
});

describe('dialogue: redundant speech tags', () => {
  it('cuts the adverb that repeats the verb', () => {
    expect(fix('“Run,” she whispered quietly.', 'dialogue-redundant-tag')?.replacements).toEqual(['whispered']);
    expect(fix('He replied back at once.', 'dialogue-redundant-tag')?.replacements).toEqual(['replied']);
    expect(fix('They shouted loudly.', 'dialogue-redundant-tag')?.replacements).toEqual(['shouted']);
  });
});
