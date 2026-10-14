import { Editor } from '@tiptap/core';
import { editorExtensions } from '../src/editor/extensions';
import { replaceAnchored, textAt } from '../src/editor/aiApply';
import { contextSynonyms, tidyAlternatives } from '../src/ai/contextSynonyms';

const make = (html: string) => new Editor({ extensions: editorExtensions(), content: html });
const anchorFor = (ed: Editor, text: string) => {
  let from = -1;
  ed.state.doc.descendants((n, pos) => {
    if (from < 0 && n.isText && n.text!.includes(text)) from = pos + n.text!.indexOf(text);
  });
  return { from, to: from + text.length, text };
};

describe('“Use”: putting a chosen AI version in place', () => {
  it('replaces the passage it was written for, as one undoable step', () => {
    const ed = make('<p>She walked slowly to the door. Then she left.</p>');
    const a = anchorFor(ed, 'She walked slowly to the door.');
    expect(textAt(ed, a.from, a.to)).toBe(a.text);
    expect(replaceAnchored(ed, a, 'She crept to the door.')).toBe(true);
    expect(ed.getText()).toBe('She crept to the door. Then she left.');
    ed.commands.undo();
    expect(ed.getText()).toBe('She walked slowly to the door. Then she left.');
    ed.destroy();
  });

  it('finds the passage again if text was added before it', () => {
    const ed = make('<p>She walked slowly to the door.</p>');
    const a = anchorFor(ed, 'walked slowly');
    ed.commands.insertContentAt(1, 'At dawn, ');
    expect(replaceAnchored(ed, a, 'crept')).toBe(true);
    expect(ed.getText()).toBe('At dawn, She crept to the door.');
    ed.destroy();
  });

  it('changes nothing if the passage itself was edited', () => {
    const ed = make('<p>She walked slowly to the door.</p>');
    const a = anchorFor(ed, 'walked slowly');
    ed.commands.insertContentAt(a.from + 3, 'X');
    const before = ed.getText();
    expect(replaceAnchored(ed, a, 'crept')).toBe(false);
    expect(ed.getText()).toBe(before);
    ed.destroy();
  });

  it('replaces a passage across paragraphs with paragraphs', () => {
    const ed = make('<p>First.</p><p>Second one.</p><p>Third.</p>');
    const doc = ed.state.doc;
    const from = 1 + doc.child(0).nodeSize; // start of the second paragraph's text
    const to = from + doc.child(1).nodeSize + doc.child(2).content.size;
    const a = { from, to, text: textAt(ed, from, to) };
    expect(a.text).toBe('Second one.\n\nThird.');
    expect(replaceAnchored(ed, a, 'Two.\n\nThree, rewritten.')).toBe(true);
    expect(ed.getHTML()).toBe('<p>First.</p><p>Two.</p><p>Three, rewritten.</p>');
    ed.destroy();
  });
});

describe('echo alternatives that fit the sentence', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps short, new alternatives, cased like the word', () => {
    expect(tidyAlternatives('glanced', ['looked', 'Glanced', '“peered”', 'cast a quick look over', 'stole a glance', 'looked'])).toEqual(['looked', 'peered']);
    expect(tidyAlternatives('Glanced', ['looked'])).toEqual(['Looked']);
    expect(tidyAlternatives('x', 'nope')).toEqual([]);
    expect(tidyAlternatives('walked', ['strolled', 'marching', 'made her way'])).toEqual(['strolled', 'made her way']);
  });

  it('asks the model once per word and sentence', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"alternatives":["looked","peered"]}' } }] }));
    }) as unknown as typeof fetch;
    expect(await contextSynonyms('glanced', 'He glanced back.', { fetchImpl })).toEqual(['looked', 'peered']);
    expect(await contextSynonyms('glanced', 'He glanced back.', { fetchImpl })).toEqual(['looked', 'peered']);
    expect(calls).toBe(1);
  });

  it('tells the model which words are used nearby and drops any it suggests anyway', async () => {
    let prompt = '';
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      prompt = JSON.stringify(JSON.parse(init.body as string).messages);
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"alternatives":["stared","gazed","peered","Peering"]}' } }] }));
    }) as unknown as typeof fetch;
    const nearby = 'She stared at the map. He gazed over the hills and stared again.';
    expect(await contextSynonyms('looked', 'He looked at the sky.', { fetchImpl }, nearby)).toEqual(['peered']);
    expect(prompt).toContain('stared, gazed, hills');
    // The prompt is JSON, so the line ends at the escaped newline.
    expect(prompt.match(/Already used nearby \(don't suggest these\): ([^\\]*)/)![1].split(', ')).not.toContain('over');
  });
});
