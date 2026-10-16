import { describe, expect, it } from 'vitest';
import { notesWithOutline, outlineLines, withoutOutline } from '../src/domain/outlineNotes';
import { docToPlainText } from '../src/domain/text';

const p = (text: string) => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' });
const doc = (...lines: string[]) => ({ type: 'doc', content: lines.map(p) }) as never;

describe('planning notes in a scene', () => {
  it('finds two or more bullet lines and takes them out, keeping the story', () => {
    const d = doc('- Winnie received the keys', '- Finn stops, grumpy', '', 'There is two things Finn hates.');
    expect(outlineLines(d)).toEqual(['- Winnie received the keys', '- Finn stops, grumpy']);
    expect(docToPlainText(withoutOutline(d)).trim()).toBe('There is two things Finn hates.');
  });
  it('leaves a single dash line alone', () => {
    const d = doc('- one line', 'Story.');
    expect(outlineLines(d)).toEqual([]);
    expect(withoutOutline(d)).toBe(d);
  });
  it('keeps an empty paragraph when the scene was only a plan, and adds to existing notes', () => {
    expect(withoutOutline(doc('- a', '- b'))).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
    expect(notesWithOutline('POV: Finn', ['- a', '- b'])).toBe('POV: Finn\n\nPlan (moved from the text):\n- a\n- b');
    expect(notesWithOutline('', ['- a'])).toBe('Plan (moved from the text):\n- a');
  });
});
