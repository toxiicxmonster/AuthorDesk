import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { findKey } from './findExtension';
import { confirmDialog, setUi, toast } from '../ui/store';

export function FindBar({ editor, onClose, initialQuery = '' }: { editor: Editor; onClose: () => void; initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [replace, setReplace] = useState('');
  const [caseSensitive, setCase] = useState(false);
  const [, force] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    const { from, to } = editor.state.selection;
    if (from !== to && !initialQuery) setQuery(editor.state.doc.textBetween(from, to, ' ').slice(0, 100));
    const f = () => force((n) => n + 1);
    editor.on('transaction', f);
    return () => {
      editor.off('transaction', f);
      if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(findKey, { query: '' }));
    };
  }, [editor, initialQuery]);

  const jumped = useRef(false);
  useEffect(() => {
    editor.view.dispatch(editor.state.tr.setMeta(findKey, { query, caseSensitive, current: 0 }));
    // Arriving from global search: reveal the first match.
    const first = findKey.getState(editor.state)?.matches[0];
    if (initialQuery && !jumped.current && first) {
      jumped.current = true;
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, first.from, first.to)).scrollIntoView());
    }
  }, [query, caseSensitive, editor, initialQuery]);

  const st = findKey.getState(editor.state);
  const matches = st?.matches ?? [];
  const current = st?.current ?? 0;

  const go = (delta: number) => {
    if (!matches.length) return;
    const next = (current + delta + matches.length) % matches.length;
    const m = matches[next];
    const tr = editor.state.tr.setMeta(findKey, { current: next }).setSelection(TextSelection.create(editor.state.doc, m.from, m.to)).scrollIntoView();
    editor.view.dispatch(tr);
  };

  const replaceOne = () => {
    const m = matches[current];
    if (!m) return;
    editor.chain().focus().insertContentAt({ from: m.from, to: m.to }, replace).run();
  };

  const replaceAll = async () => {
    if (!matches.length) return;
    const ok = await confirmDialog(
      'Replace all in this scene?',
      `Replace ${matches.length} occurrence${matches.length === 1 ? '' : 's'} of “${query}” with “${replace}”? You can undo this with Ctrl+Z.`,
      { confirmLabel: 'Replace all' },
    );
    if (!ok) return;
    let tr = editor.state.tr;
    for (const m of matches.slice().reverse()) tr = tr.insertText(replace, m.from, m.to);
    editor.view.dispatch(tr);
    toast(`Replaced ${matches.length}`, { action: { label: 'Undo', run: () => editor.commands.undo() } });
  };

  return (
    <div className="findbar" role="search">
      <input
        ref={input}
        value={query}
        placeholder="Find in scene"
        aria-label="Find in scene"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') go(e.shiftKey ? -1 : 1);
          if (e.key === 'Escape') onClose();
        }}
      />
      <span className="muted count" aria-live="polite">
        {query ? (matches.length ? `${current + 1}/${matches.length}` : 'No matches') : ''}
      </span>
      <button onClick={() => go(-1)} aria-label="Previous match">↑</button>
      <button onClick={() => go(1)} aria-label="Next match">↓</button>
      <label className="check">
        <input type="checkbox" checked={caseSensitive} onChange={(e) => setCase(e.target.checked)} /> Aa
      </label>
      <input value={replace} placeholder="Replace with" aria-label="Replace with" onChange={(e) => setReplace(e.target.value)} />
      <button onClick={replaceOne} disabled={!matches.length}>Replace</button>
      <button onClick={replaceAll} disabled={!matches.length}>All</button>
      <button
        title="Find & replace in every chapter (Ctrl+Shift+H)"
        onClick={() => {
          setUi({ replaceOpen: { query } });
          onClose();
        }}
      >
        Whole book…
      </button>
      <button onClick={onClose} aria-label="Close find">✕</button>
    </div>
  );
}
