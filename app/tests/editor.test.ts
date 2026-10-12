import { Editor } from '@tiptap/core';
import { editorExtensions, cleanPastedHtml } from '../src/editor/extensions';
import { proofreadKey, setSuggestionsMeta, getSuggestions, applyPlaced, type PlacedSuggestion } from '../src/editor/proofreadExtension';
import { collectTextBlocks } from '../src/editor/blocks';
import { findKey } from '../src/editor/findExtension';
import { runRules } from '../src/proofreading/rules';

function makeEditor(text: string) {
  return new Editor({ extensions: editorExtensions(), content: `<p>${text}</p><p>Second paragraph here.</p>` });
}

const ctx = { dialect: 'en-US' as const, disabledRules: new Set<string>(), disabledCategories: new Set<string>(), dictionary: new Set<string>(), knownNames: [] };

function place(editor: Editor): PlacedSuggestion[] {
  const placed: PlacedSuggestion[] = [];
  for (const b of collectTextBlocks(editor.state.doc)) {
    for (const s of runRules(b.text, ctx)) placed.push({ ...s, key: `${s.ruleId}@${b.pos + s.start}`, from: b.pos + s.start, to: b.pos + s.end });
  }
  editor.view.dispatch(editor.state.tr.setMeta(proofreadKey, setSuggestionsMeta(placed)));
  return placed;
}

describe('editor proofreading integration', () => {
  it('maps block text offsets to document positions exactly', () => {
    const ed = makeEditor('She saw the the dog.');
    const placed = place(ed);
    const rep = placed.find((s) => s.ruleId === 'repeated-word')!;
    expect(ed.state.doc.textBetween(rep.from, rep.to)).toBe('the the');
    ed.destroy();
  });

  it('applies a suggestion and supports undo', () => {
    const ed = makeEditor('She saw the the dog.');
    const rep = place(ed).find((s) => s.ruleId === 'repeated-word')!;
    expect(applyPlaced(ed.state, ed.view.dispatch, rep, 'the')).toBe(true);
    expect(ed.getText()).toContain('She saw the dog.');
    ed.commands.undo();
    expect(ed.getText()).toContain('She saw the the dog.');
    ed.destroy();
  });

  it('drops suggestions whose text was edited and refuses to apply stale ones', () => {
    const ed = makeEditor('She saw the the dog.');
    const rep = place(ed).find((s) => s.ruleId === 'repeated-word')!;
    // Edit inside the flagged range.
    ed.view.dispatch(ed.state.tr.insertText('X', rep.from + 3));
    expect(getSuggestions(ed.state).some((s) => s.key === rep.key)).toBe(false);
    expect(applyPlaced(ed.state, ed.view.dispatch, rep, 'the')).toBe(false);
    expect(ed.getText()).toContain('theX the');
    ed.destroy();
  });

  it('keeps suggestions aligned when text is inserted before them', () => {
    const ed = makeEditor('She saw the the dog.');
    const rep = place(ed).find((s) => s.ruleId === 'repeated-word')!;
    ed.view.dispatch(ed.state.tr.insertText('Yesterday ', 1));
    const moved = getSuggestions(ed.state).find((s) => s.key === rep.key)!;
    expect(moved.from).toBe(rep.from + 10);
    expect(ed.state.doc.textBetween(moved.from, moved.to)).toBe('the the');
    expect(applyPlaced(ed.state, ed.view.dispatch, moved, 'the')).toBe(true);
    expect(ed.getText()).toContain('Yesterday She saw the dog.');
    ed.destroy();
  });

  it('suggestions never change the document by themselves', () => {
    const ed = makeEditor('i think its a good idea alot.');
    const before = ed.getHTML();
    place(ed);
    expect(ed.getHTML()).toBe(before);
    ed.destroy();
  });
});

describe('find', () => {
  it('finds all matches across paragraphs', () => {
    const ed = makeEditor('The paragraph is a paragraph.');
    ed.view.dispatch(ed.state.tr.setMeta(findKey, { query: 'paragraph' }));
    expect(findKey.getState(ed.state)?.matches).toHaveLength(3);
    ed.destroy();
  });
});

describe('paste cleanup', () => {
  it('strips styles, fonts and Office markup but keeps emphasis', () => {
    const html = '<b id="docs-internal-guid-1" style="font-weight:normal"><p style="color:red" class="MsoNormal"><font face="Arial"><i>Hi</i></font><o:p></o:p></p></b><!-- c -->';
    const out = cleanPastedHtml(html);
    expect(out).toBe('<p><i>Hi</i></p>');
  });
});
