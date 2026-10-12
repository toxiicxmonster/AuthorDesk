import { countWords, countChars, docToPlainText, docReferenceIds, plainTextToDoc, snippet, levenshtein, hashText } from '../src/domain/text';

describe('word counting', () => {
  it('counts simple words', () => {
    expect(countWords('The quick brown fox')).toBe(4);
  });
  it('treats contractions and hyphenated words as one word', () => {
    expect(countWords("Don't stop — it's a well-known trick.")).toBe(6);
  });
  it('handles curly apostrophes, numbers and unicode', () => {
    expect(countWords('She’d seen 42 cafés in Zürich')).toBe(6);
  });
  it('returns 0 for empty or whitespace', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n\t ')).toBe(0);
  });
  it('counts characters with and without spaces', () => {
    expect(countChars('a b')).toBe(3);
    expect(countChars('a b', false)).toBe(2);
  });
});

describe('doc conversion', () => {
  const doc = {
    type: 'doc' as const,
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'Elara', marks: [{ type: 'refLink', attrs: { refId: 'r1' } }] }] },
      { type: 'horizontalRule' },
      { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Quoted' }] }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Line' }, { type: 'hardBreak' }, { type: 'text', text: 'two' }] },
    ],
  };
  it('extracts plain text with scene breaks', () => {
    expect(docToPlainText(doc)).toBe('Hello Elara\n\n* * *\n\nQuoted\n\nLine\ntwo');
  });
  it('collects linked reference ids', () => {
    expect(docReferenceIds(doc)).toEqual(['r1']);
  });
  it('round-trips plain text through a doc', () => {
    const text = 'First para.\n\nSecond para.\n\n* * *\n\nThird.';
    expect(docToPlainText(plainTextToDoc(text))).toBe(text);
  });
});

describe('helpers', () => {
  it('builds snippets around matches', () => {
    expect(snippet('a'.repeat(100) + 'needle' + 'b'.repeat(100), 'NEEDLE', 5)).toBe('…aaaaaneedlebbbbb…');
    expect(snippet('nothing', 'x')).toBeNull();
  });
  it('computes edit distance', () => {
    expect(levenshtein('Elara', 'Elera')).toBe(1);
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });
  it('hashes deterministically', () => {
    expect(hashText('abc')).toBe(hashText('abc'));
    expect(hashText('abc')).not.toBe(hashText('abd'));
  });
});
