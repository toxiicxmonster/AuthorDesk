import { runRules, normalizeRuleId, ruleLabel } from '../src/proofreading/rules';
import { checkBlocks } from '../src/proofreading/providers';
import { checkOnline, endpointProblem, resetOnlineCheckState, LT_PUBLIC_ENDPOINT } from '../src/proofreading/languageTool';
import type { ProofreadContext } from '../src/proofreading/types';
import type { OnlineCheckSettings } from '../src/domain/schema';

const ctx = (over: Partial<ProofreadContext> = {}): ProofreadContext => ({
  dialect: 'en-US',
  disabledRules: new Set(),
  disabledCategories: new Set(),
  dictionary: new Set(),
  knownNames: [],
  ...over,
});
const find = (text: string, rule: string, c = ctx()) => runRules(text, c).filter((s) => s.ruleId === rule);

describe('rule accuracy fixes', () => {
  it('keeps correct possessive "its" phrases', () => {
    expect(find('The blade knew its true name.', 'confused-its-it-is')).toHaveLength(0);
    expect(find('The clock had done its time.', 'confused-its-it-is')).toHaveLength(0);
    expect(find('I think its a trap.', 'confused-its-it-is')).toHaveLength(1);
  });

  it('allows "loose an arrow" but flags "loose the game"', () => {
    expect(find('She drew back to loose an arrow.', 'confused-loose-lose')).toHaveLength(0);
    expect(find('They will loose arrows at dawn.', 'confused-loose-lose')).toHaveLength(0);
    const [s] = find('We cannot afford to loose the game.', 'confused-loose-lose');
    expect(s.replacements[0]).toBe('to lose');
  });

  it('handles a/an with acronyms and "u" words', () => {
    expect(find('He was an FBI agent.', 'an-a-consonant')).toHaveLength(0);
    expect(find('She saw an X on the map.', 'an-a-consonant')).toHaveLength(0);
    expect(find('It was a utopia once.', 'a-an-vowel')).toHaveLength(0);
    expect(find('It was an big house.', 'an-a-consonant')).toHaveLength(1);
  });

  it('finds repeated accented words', () => {
    expect(find('They met at the café café on the corner.', 'repeated-word')).toHaveLength(1);
  });

  it('covers inflected US/UK forms and lines them up correctly', () => {
    const us = find('Colourful banners, coloured lights; she realised the centres were organised.', 'dialect').map((s) => s.replacements[0]);
    expect(us).toEqual(['Colorful', 'colored', 'realized', 'centers', 'organized']);
    const gb = find('He traveled to the theater and realized it.', 'dialect', ctx({ dialect: 'en-GB' })).map((s) => s.replacements[0]);
    expect(gb).toEqual(['travelled', 'theatre', 'realised']);
    expect(find('A grey sky over the gas meter.', 'dialect')).toHaveLength(0);
  });

  it('fixes contractions typed without an apostrophe, but not real words', () => {
    expect(find('She dont know.', 'common-misspelling')[0].replacements[0]).toBe("don't");
    expect(find('Didnt you hear?', 'common-misspelling')[0].replacements[0]).toBe("Didn't");
    expect(find('I cant stand the cant of politicians; he wont go.', 'common-misspelling')).toHaveLength(0);
  });

  it('new idiom checks', () => {
    expect(find('We waited with baited breath.', 'confused-bated-breath')[0].replacements[0]).toBe('bated breath');
    expect(find('The storm will wreck havoc.', 'confused-wreak-havoc')[0].replacements[0]).toBe('wreak havoc');
  });

  it('maps old numbered rule ids so turned-off checks stay off', () => {
    expect(normalizeRuleId('confused-4')).toBe('confused-its-it-is');
    expect(normalizeRuleId('adverb')).toBe('adverb');
    const c = ctx({ disabledRules: new Set(['confused-4'].map(normalizeRuleId)) });
    expect(find('I think its a trap.', 'confused-its-it-is', c)).toHaveLength(0);
    expect(ruleLabel('confused-4')).toMatch(/its a/);
    expect(ruleLabel('lt:EN_A_VS_AN')).toBe('Online check: en a vs an');
  });

  it('name consistency still flags a near-miss of a character name', () => {
    expect(find('Then Elsei ran.', 'name-consistency', ctx({ knownNames: ['Elsie Marr'] }))).toHaveLength(1);
  });
});

describe('block cache', () => {
  it('returns the same results for unchanged paragraphs', async () => {
    const c = ctx();
    const a = await checkBlocks(['I think its a trap.', 'Nothing wrong here.'], c);
    const b = await checkBlocks(['I think its a trap.', 'Nothing wrong here.'], c);
    expect(b.results).toEqual(a.results);
    expect(a.results[0].length).toBeGreaterThan(0);
    // Different settings are a different cache entry.
    const off = await checkBlocks(['I think its a trap.'], ctx({ disabledCategories: new Set(['confused']) }));
    expect(off.results[0].some((s) => s.category === 'confused')).toBe(false);
  });
});

// --- LanguageTool ---

const settings = (over: Partial<OnlineCheckSettings> = {}): OnlineCheckSettings => ({
  enabled: true,
  endpoint: LT_PUBLIC_ENDPOINT,
  localEngineOptOut: false,
  picky: false,
  consentedAt: '2026-10-11T00:00:00Z',
  ...over,
});

interface FakeMatch {
  offset: number;
  length: number;
  rule: string;
  cat: string;
  issue?: string;
  reps?: string[];
}

function fakeFetch(respond: (text: string) => FakeMatch[], status = 200) {
  const calls: URLSearchParams[] = [];
  const fn = vi.fn(async (_url: string, init: RequestInit) => {
    const body = new URLSearchParams(String(init.body));
    calls.push(body);
    const matches = respond(body.get('text') ?? '').map((m) => ({
      message: `msg ${m.rule}`,
      offset: m.offset,
      length: m.length,
      replacements: (m.reps ?? []).map((value) => ({ value })),
      rule: { id: m.rule, issueType: m.issue ?? 'grammar', category: { id: m.cat } },
    }));
    return new Response(JSON.stringify({ matches }), { status, headers: { 'Content-Type': 'application/json' } });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

/** Flag every occurrence of a word as a LanguageTool match. */
const flagWord = (word: string, rule: string, cat: string, issue?: string) => (text: string) => {
  const out: FakeMatch[] = [];
  let i = text.indexOf(word);
  while (i >= 0) {
    out.push({ offset: i, length: word.length, rule, cat, issue, reps: ['X'] });
    i = text.indexOf(word, i + 1);
  }
  return out;
};

describe('online check (LanguageTool)', () => {
  beforeEach(() => resetOnlineCheckState());

  it('batches paragraphs and maps offsets back to each paragraph', async () => {
    const texts = ['First he go home.', 'Then she go out.'];
    const { fn, calls } = fakeFetch(flagWord('go', 'HE_VERB_AGR', 'GRAMMAR'));
    const r = await checkOnline(texts, ctx(), settings(), fn);
    expect(calls).toHaveLength(1);
    expect(calls[0].get('text')).toBe('First he go home.\n\nThen she go out.');
    expect(calls[0].get('language')).toBe('en-US');
    expect(r.results[0][0]).toMatchObject({ original: 'go', start: 9, category: 'grammar', severity: 'warning', ruleId: 'lt:HE_VERB_AGR', providerId: 'languagetool' });
    expect(r.results[1][0]).toMatchObject({ original: 'go', start: 9 });
    expect(r.error).toBeNull();
  });

  it('only sends paragraphs that changed', async () => {
    const { fn, calls } = fakeFetch(() => []);
    await checkOnline(['One.', 'Two.'], ctx(), settings(), fn);
    await checkOnline(['One.', 'Two!', 'Three.'], ctx(), settings(), fn);
    expect(calls.map((c) => c.get('text'))).toEqual(['One.\n\nTwo.', 'Two!\n\nThree.']);
    // Cache-only mode never sends.
    const r = await checkOnline(['Four.'], ctx(), settings(), fn, true);
    expect(calls).toHaveLength(2);
    expect(r.unchecked).toBe(1);
  });

  it('ignores character names and dictionary words in its spelling results', async () => {
    const { fn } = fakeFetch((t) => [...flagWord('Elsie', 'MORFOLOGIK_RULE_EN_US', 'TYPOS', 'misspelling')(t), ...flagWord('Zorvath', 'MORFOLOGIK_RULE_EN_US', 'TYPOS', 'misspelling')(t), ...flagWord('teh', 'MORFOLOGIK_RULE_EN_US', 'TYPOS', 'misspelling')(t)]);
    const r = await checkOnline(['Elsie met Zorvath by teh sea.'], ctx({ knownNames: ['Elsie Marr'], dictionary: new Set(['zorvath']) }), settings(), fn);
    expect(r.results[0].map((s) => s.original)).toEqual(['teh']);
    expect(r.results[0][0]).toMatchObject({ category: 'spelling', severity: 'error' });
  });

  it('drops findings that offer no replacement (or only the same text)', async () => {
    const { fn } = fakeFetch((t) => [
      { offset: t.indexOf('go'), length: 2, rule: 'HE_VERB_AGR', cat: 'GRAMMAR', reps: [] },
      { offset: t.indexOf('very'), length: 4, rule: 'EN_WEAK_ADJ', cat: 'STYLE', reps: ['very'] },
      { offset: t.indexOf('fast'), length: 4, rule: 'SOME_RULE', cat: 'GRAMMAR', reps: ['fast', 'quickly'] },
    ]);
    const r = await checkOnline(['He go very fast.'], ctx(), settings(), fn);
    expect(r.results[0].map((s) => [s.original, s.replacements])).toEqual([['fast', ['quickly']]]);
  });

  it('gives a fix-less online repetition finding synonyms from the bundled thesaurus', async () => {
    const { fn } = fakeFetch((t) => [{ offset: t.lastIndexOf('looked'), length: 6, rule: 'ENGLISH_WORD_REPEAT_RULE', cat: 'REPETITIONS_STYLE', reps: [] }]);
    const r = await checkOnline(['She looked up. He looked away.'], ctx(), settings(), fn);
    expect(r.results[0][0].original).toBe('looked');
    expect(r.results[0][0].replacements).toEqual(expect.arrayContaining(['glanced', 'gazed']));
  });

  it('never flags correctly paired straight quotes as typography errors', async () => {
    const text = '"Hello," she said.';
    const { fn, calls } = fakeFetch(() => [
      { offset: 0, length: 1, rule: 'EN_QUOTES', cat: 'TYPOGRAPHY', reps: ['“'] },
      { offset: 7, length: 1, rule: 'EN_QUOTES', cat: 'TYPOGRAPHY', reps: ['”'] },
    ]);
    const r = await checkOnline([text], ctx(), settings({ picky: true }), fn);
    expect(calls[0].get('disabledRules')).toContain('EN_QUOTES');
    expect(r.results[0]).toEqual([]);
  });

  it('respects turned-off categories and checks', async () => {
    const respond = (t: string) => [...flagWord('very', 'EN_WEAK_ADJ', 'STYLE')(t), ...flagWord('go', 'HE_VERB_AGR', 'GRAMMAR')(t)];
    const { fn } = fakeFetch(respond);
    const r1 = await checkOnline(['He go very fast.'], ctx({ disabledCategories: new Set(['style']) }), settings(), fn);
    expect(r1.results[0].map((s) => s.ruleId)).toEqual(['lt:HE_VERB_AGR']);
    const r2 = await checkOnline(['He go very fast.'], ctx({ disabledCategories: new Set(), disabledRules: new Set(['lt:HE_VERB_AGR']) }), settings(), fn);
    expect(r2.results[0].map((s) => s.ruleId)).toEqual(['lt:EN_WEAK_ADJ']);
    expect(r2.results[0][0].severity).toBe('style');
  });

  it('stays under the free rate limit and reports what was skipped', async () => {
    const { fn, calls } = fakeFetch(() => []);
    const big = (n: number) => `${'word '.repeat(2300)}${n}`; // ~11.5k chars: one request each
    const texts = Array.from({ length: 8 }, (_, i) => big(i));
    const r = await checkOnline(texts, ctx(), settings(), fn);
    expect(calls.length).toBeLessThan(8);
    expect(r.unchecked).toBeGreaterThan(0);
    expect(r.error).toMatch(/20 checks a minute/);
  });

  it('reports HTTP errors honestly and does not cache failures', async () => {
    const { fn } = fakeFetch(() => [], 429);
    const r = await checkOnline(['Hello there.'], ctx(), settings(), fn);
    expect(r.error).toMatch(/too many checks/);
    expect(r.unchecked).toBe(1);
    const ok = fakeFetch(() => []);
    await checkOnline(['Hello there.'], ctx(), settings(), ok.fn);
    expect(ok.calls).toHaveLength(1);
  });

  it('never sends while offline', async () => {
    const { fn, calls } = fakeFetch(() => []);
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      const r = await checkOnline(['Hello there.'], ctx(), settings(), fn);
      expect(calls).toHaveLength(0);
      expect(r.error).toMatch(/offline/);
    } finally {
      spy.mockRestore();
    }
  });

  it('validates server addresses', () => {
    expect(endpointProblem(LT_PUBLIC_ENDPOINT)).toBeNull();
    expect(endpointProblem('http://localhost:8081/v2/check')).toBeNull();
    expect(endpointProblem('http://example.com/v2/check')).toMatch(/https/);
    expect(endpointProblem('https://user:pw@example.com/v2/check')).toMatch(/password/);
    expect(endpointProblem('https://example.com/')).toMatch(/v2\/check/);
    expect(endpointProblem('nonsense')).toMatch(/not a web address/);
  });

  it('a bad address never sends anything', async () => {
    const { fn, calls } = fakeFetch(() => []);
    const r = await checkOnline(['Hello.'], ctx(), settings({ endpoint: 'http://example.com/v2/check' }), fn);
    expect(calls).toHaveLength(0);
    expect(r.error).toMatch(/address/);
  });
});
