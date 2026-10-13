import { Editor } from '@tiptap/core';
import { popoverPlacement } from '../src/editor/SceneEditor';
import { runProofread } from '../src/editor/proofreadRunner';
import { resetDbForTests } from '../src/storage/db';
import { createProject } from '../src/storage/repo';
import { editorExtensions, cleanPastedHtml } from '../src/editor/extensions';
import { proofreadKey, setSuggestionsMeta, getSuggestions, applyPlaced, suggestionsAt, suggestionTooltip, type PlacedSuggestion } from '../src/editor/proofreadExtension';
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
    expect(ed.state.doc.textBetween(rep.from, rep.to)).toBe('the');
    ed.destroy();
  });

  it('applies a suggestion and supports undo', () => {
    const ed = makeEditor('She saw the the dog.');
    const rep = place(ed).find((s) => s.ruleId === 'repeated-word')!;
    expect(applyPlaced(ed.state, ed.view.dispatch, rep, '')).toBe(true);
    expect(ed.getText()).toContain('She saw the dog.');
    ed.commands.undo();
    expect(ed.getText()).toContain('She saw the the dog.');
    ed.destroy();
  });

  it('drops suggestions whose text was edited and refuses to apply stale ones', () => {
    const ed = makeEditor('She saw the the dog.');
    const rep = place(ed).find((s) => s.ruleId === 'repeated-word')!;
    // Edit inside the flagged range.
    ed.view.dispatch(ed.state.tr.insertText('X', rep.from + 1));
    expect(getSuggestions(ed.state).some((s) => s.key === rep.key)).toBe(false);
    expect(applyPlaced(ed.state, ed.view.dispatch, rep, '')).toBe(false);
    expect(ed.getText()).toContain('the tXhe');
    ed.destroy();
  });

  it('keeps suggestions aligned when text is inserted before them', () => {
    const ed = makeEditor('She saw the the dog.');
    const rep = place(ed).find((s) => s.ruleId === 'repeated-word')!;
    ed.view.dispatch(ed.state.tr.insertText('Yesterday ', 1));
    const moved = getSuggestions(ed.state).find((s) => s.key === rep.key)!;
    expect(moved.from).toBe(rep.from + 10);
    expect(ed.state.doc.textBetween(moved.from, moved.to)).toBe('the');
    expect(applyPlaced(ed.state, ed.view.dispatch, moved, '')).toBe(true);
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

describe('overlapping suggestions', () => {
  it('a click on a merged underline finds the fixable error, not just the style note on top of it', () => {
    const ed = makeEditor('She was really really tired.');
    place(ed);
    // Overlapping decorations render as one span that keeps only one data-sid; resolve by position instead.
    const spans = [...ed.view.dom.querySelectorAll<HTMLElement>('[data-sid]')];
    const span = spans.filter((el) => el.textContent === 'really').at(-1)!;
    expect(span).toBeTruthy();
    const from = ed.view.posAtDOM(span, 0);
    const here = suggestionsAt(ed.state, from, from + span.textContent!.length);
    expect(here[0].ruleId).toBe('repeated-word');
    expect(here[0].replacements[0]).toBe('');
    expect(here[0].replacements).toContain('truly');
    expect(here[0].replacements).not.toContain('really');
    expect(here.map((s) => s.ruleId)).toContain('filler-word');
    ed.destroy();
  });

  it('every underline says why it is there, listing each overlapping reason with its fix', () => {
    const ed = makeEditor('She was really really tired.');
    place(ed);
    const spans = [...ed.view.dom.querySelectorAll<HTMLElement>('[data-sid]')];
    expect(spans.length).toBeGreaterThan(0);
    for (const el of spans) expect(el.title).toMatch(/Click for options\.$/);
    const both = spans.find((el) => el.textContent === 'really' && /twice in a row/.test(el.title))!;
    expect(both.className).toContain('pr-error');
    expect(both.className).not.toContain('pr-style');
    expect(both.dataset.sid).toMatch(/^repeated-word/);
    expect(both.title).toMatch(/Likely error · .*“really” appears twice in a row\..*Suggested: \(remove\), “truly”/);
    expect(both.title).toMatch(/Style · .*often adds little/);
    ed.destroy();
  });

  it('formats removal and spacing fixes readably in the hover text', () => {
    const t = suggestionTooltip([{ key: 'k', from: 1, to: 2, start: 0, end: 1, original: 'x', replacements: [''], message: 'Cut it.', category: 'style', severity: 'style', ruleId: 'r', providerId: 'p' }]);
    expect(t).toBe('Style · Style (adverbs, passive voice, filler): Cut it. Suggested: (remove).\nClick for options.');
  });

  it('offers to cut a mid-sentence filler word and leaves single spacing', () => {
    const ed = makeEditor('She was very tired.');
    const filler = place(ed).find((s) => s.ruleId === 'filler-word')!;
    expect(filler.replacements).toEqual(['']);
    expect(applyPlaced(ed.state, ed.view.dispatch, filler, '')).toBe(true);
    expect(ed.getText()).toContain('She was tired.');
    ed.destroy();
  });

  it('does not offer to cut a filler word that starts a sentence', () => {
    const ed = makeEditor('Suddenly the door opened.');
    expect(place(ed).find((s) => s.ruleId === 'filler-word')!.replacements).toEqual([]);
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

describe('suggestion popover placement', () => {
  // The popover is rendered inside the scrolling page, so it must follow the page's scroll, not the outer editor box.
  const page = (scrollTop: number) =>
    ({
      scrollTop,
      scrollLeft: 0,
      clientWidth: 800,
      getBoundingClientRect: () => ({ left: 100, top: 50, bottom: 650, right: 900 }),
    }) as unknown as HTMLElement;

  it('sits just under the clicked word, even when the page is scrolled down', () => {
    // Word on screen at y=200..220 while the page is scrolled 3000px down.
    const p = popoverPlacement(page(3000), { left: 300, top: 200, bottom: 220 });
    expect(p).toEqual({ x: 200, y: 220 - 50 + 6 + 3000, above: false });
  });

  it('opens upwards near the bottom of the page and stays inside it horizontally', () => {
    const p = popoverPlacement(page(0), { left: 880, top: 600, bottom: 620 });
    expect(p.above).toBe(true);
    expect(p.y).toBe(600 - 50 - 6);
    expect(p.x).toBe(800 - 300 - 8);
  });
});

describe('only suggestions with something to change to are shown', () => {
  const fix = (text: string, choice = 0) => {
    const ed = makeEditor(text);
    const s = place(ed).find((x) => x.ruleId === 'adverb')!;
    expect(s).toBeTruthy();
    expect(applyPlaced(ed.state, ed.view.dispatch, s, s.replacements[choice])).toBe(true);
    const out = ed.state.doc.firstChild!.textContent;
    ed.destroy();
    return out;
  };

  it('offers ways to cut an adverb, tidying spaces, commas and capitals', () => {
    expect(fix('He ran quickly to the door.')).toBe('He ran to the door.');
    expect(fix('He ran quickly.')).toBe('He ran.');
    expect(fix('Unfortunately, the boat sank.')).toBe('The boat sank.');
    expect(fix('He was, unfortunately, late.')).toBe('He was late.');
    // …and synonyms where the thesaurus has them.
    expect(fix('He ran quickly to the door.', 1)).toBe('He ran swiftly to the door.');
  });

  it('hides notes with no fix (passive voice, clichés, long sentences) in the editor', async () => {
    resetDbForTests();
    const { project } = await createProject('Quiet');
    const ed = new Editor({ extensions: editorExtensions(), content: '<p>The letter was written by Tom. At the end of the day, it was over.</p>' });
    await runProofread(ed, project.id);
    const shown = getSuggestions(ed.state);
    expect(shown.filter((s) => ['passive-voice', 'cliche'].includes(s.ruleId))).toEqual([]);
    expect(shown.every((s) => s.replacements.length > 0 || s.ruleId === 'new-name')).toBe(true);
    ed.destroy();
  });
});
