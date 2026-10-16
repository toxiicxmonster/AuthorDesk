import { describe, expect, it } from 'vitest';
import { cleanPitch, pitchMessages, pitchSource, unknownNames } from '../src/ai/pitch';

describe('pitch', () => {
  const chapters = [
    { title: 'Chapter 1: The things we leave behind', summary: '- Winnie finds out Grandma died\n- Funeral happens', sceneSummaries: [], text: 'Long prose…' },
    { title: 'Chapter 2. Between the cracks', summary: '', sceneSummaries: [''], text: '- Winnie received the keys\n- Finn stops, grumpy' },
    { title: 'Chapter 3. Game Day', summary: '', sceneSummaries: ['Finn watches his rival.'], text: 'x' },
    { title: 'Chapter 4', summary: '', sceneSummaries: [], text: 'There is two things Finn Callahan hates more than anything in the world.' },
    { title: 'Chapter 5', summary: '', sceneSummaries: [], text: '' },
  ];
  const s = pitchSource(chapters, [{ name: 'Winnie Hartley', role: 'owns a bookstore', summary: '', goals: 'Dreams of a safe love' }]);

  it('uses each chapter’s best description and says what it is', () => {
    expect(s.counts).toEqual({ summary: 2, notes: 1, opening: 1, empty: 1 });
    expect(s.text).toContain('Chapter 1 (The things we leave behind): - Winnie finds out Grandma died - Funeral happens');
    expect(s.text).toContain('Chapter 2 (Between the cracks): (outline) Winnie received the keys; Finn stops, grumpy');
    expect(s.text).toContain('Chapter 3 (Game Day): Finn watches his rival.');
    expect(s.text).toContain('Chapter 4: (opening) There is two things');
    expect(s.text).not.toContain('Chapter 5');
    expect(s.text).toContain('- Winnie Hartley (owns a bookstore) Wants: Dreams of a safe love');
  });

  it('tells the model not to invent an ending', () => {
    expect(pitchMessages('synopsis', 'Book', s.text)[0].content).toContain('don’t make up how it ends');
  });

  it('cleans chatter from the answer', () => {
    expect(cleanPitch('Here’s a blurb:\n\n**Blurb:** Winnie has lost everything.')).toBe('Winnie has lost everything.');
    expect(cleanPitch('"A grieving bookseller falls for her ex’s rival."')).toBe('A grieving bookseller falls for her ex’s rival.');
  });

  it('lists names the draft made up', () => {
    const draft = 'In the quaint, book-loving town of Meadowgrove, Winnie Hartley inherits a bookstore. Jace Kensington, the town’s QB, objects. Winnie stays.';
    expect(unknownNames(draft, s.text + ' Jace Kensington QB', 'Wearing His')).toEqual(['Meadowgrove']);
  });
});
