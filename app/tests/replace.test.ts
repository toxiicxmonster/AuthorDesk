import { describe, expect, it } from 'vitest';
import { caseLike, findInDoc, replaceInDoc } from '../src/domain/replace';
import type { DocJson } from '../src/domain/schema';

const p = (...content: object[]) => ({ type: 'paragraph', content });
const t = (text: string, marks?: object[]) => (marks ? { type: 'text', text, marks } : { type: 'text', text });
const italic = [{ type: 'italic' }];
const doc = (...content: object[]) => ({ type: 'doc', content }) as unknown as DocJson;
const opts = { caseSensitive: false, wholeWord: true };

describe('book-wide find and replace', () => {
  it('finds whole words in every paragraph, ignoring case unless asked', () => {
    const d = doc(p(t('Jace sat with Jacey. jace laughed.')), { type: 'blockquote', content: [p(t('Not JACE again.'))] });
    expect(findInDoc(d, 'jace', opts).map((m) => [m.block, m.text])).toEqual([
      [0, 'Jace'],
      [0, 'jace'],
      [1, 'JACE'],
    ]);
    expect(findInDoc(d, 'jace', { caseSensitive: true, wholeWord: true })).toHaveLength(1);
    expect(findInDoc(d, 'Jace', { caseSensitive: false, wholeWord: false })).toHaveLength(4);
  });

  it('keeps capitals at a sentence start and in shouting', () => {
    expect(caseLike('Jace', 'finn', false)).toBe('Finn');
    expect(caseLike('JACE', 'Finn', false)).toBe('FINN');
    expect(caseLike('jace', 'Finn', false)).toBe('Finn');
    expect(caseLike('Jace', 'finn', true)).toBe('finn');
  });

  it('replaces across styled pieces and keeps the styles around it', () => {
    const d = doc(p(t('Then '), t('Ja', italic), t('ce smiled at '), t('Jace', italic), t('.')));
    const r = replaceInDoc(d, 'Jace', 'Finn', opts);
    expect(r.count).toBe(2);
    const kids = (r.doc as unknown as { content: { content: { text: string; marks?: unknown[] }[] }[] }).content[0].content;
    expect(kids.map((k) => k.text).join('')).toBe('Then Finn smiled at Finn.');
    // The replacement takes the style of where the match started; the rest keeps its own.
    expect(kids[1]).toEqual({ type: 'text', text: 'Finn', marks: italic });
    expect(kids[2]).toEqual({ type: 'text', text: ' smiled at ' });
    expect(kids[3]).toEqual({ type: 'text', text: 'Finn', marks: italic });
  });

  it('replaces only the chosen matches and never runs across a line break', () => {
    const d = doc(p(t('Jace, Jace and Jace')), p(t('Ja'), { type: 'hardBreak' }, t('ce')));
    const r = replaceInDoc(d, 'Jace', 'Finn', opts, (i) => i !== 1);
    expect(r.count).toBe(2);
    expect(findInDoc(r.doc, 'Finn', opts)).toHaveLength(2);
    expect(findInDoc(r.doc, 'Jace', opts)).toHaveLength(1);
    expect(findInDoc(d, 'Jace', opts)).toHaveLength(3);
  });

  it('can delete words', () => {
    const r = replaceInDoc(doc(p(t('very very '), t('good', italic))), 'very ', '', { caseSensitive: false, wholeWord: false });
    expect(findInDoc(r.doc, 'good', opts)[0].blockText).toBe('good');
  });
});
