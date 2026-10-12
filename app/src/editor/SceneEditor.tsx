import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { Icon } from '../ui/components/Icon';
import type { Editor } from '@tiptap/core';
import type { Scene } from '../domain/schema';
import { countChars, countWords } from '../domain/text';
import { saveSceneContent, createSnapshot, createRecord } from '../storage/repo';
import { db } from '../storage/db';
import { getSettings, updateSettings, useSettings } from '../storage/settings';
import { setUi, toast, useUi, reportError } from '../ui/store';
import { cleanPastedHtml, editorExtensions } from './extensions';
import { registerFlusher } from './EditorContext';
import { applyPlaced, getSuggestions, activeSuggestionMeta, proofreadKey, removeSuggestionMeta, type PlacedSuggestion } from './proofreadExtension';
import { baseKey, runProofread, clearProofread } from './proofreadRunner';
import { FindBar } from './FindBar';
import { ReferencePicker } from '../ui/components/ReferencePicker';
import { CATEGORY_LABELS } from '../proofreading/types';

const SAVE_DELAY = 700;
const PROOF_DELAY = 1500;

interface Props {
  scene: Scene;
  /** Word count of the chapter and book excluding this scene, for live totals. */
  chapterOtherWords: number;
  bookOtherWords: number;
  onEditor: (e: Editor | null) => void;
  onProofread: (status: string) => void;
  proofRequest: number;
  /** Open the find bar with this query (e.g. arriving from global search). */
  initialFind?: string | null;
}

export function SceneEditor({ scene, chapterOtherWords, bookOtherWords, onEditor, onProofread, proofRequest, initialFind }: Props) {
  const settings = useSettings();
  const focusMode = useUi((s) => s.focusMode);
  const dirty = useRef(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const proofTimer = useRef<number | undefined>(undefined);
  const savedRev = useRef(scene.rev);
  const [words, setWords] = useState(scene.wordCount);
  const [chars, setChars] = useState(countChars(scene.plainText));
  const [selWords, setSelWords] = useState(0);
  const [findOpen, setFindOpen] = useState(!!initialFind);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [popover, setPopover] = useState<{ s: PlacedSuggestion; x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const proofOn = settings.proofreadEnabled;
  const sceneRef = useRef(scene);
  sceneRef.current = scene;

  const editor = useEditor({
    extensions: editorExtensions(),
    content: scene.content,
    editorProps: {
      attributes: {
        class: 'manuscript',
        spellcheck: String(settings.browserSpellcheck),
        'aria-label': `Manuscript text: ${scene.title}`,
        role: 'textbox',
        'aria-multiline': 'true',
      },
      transformPastedHTML: cleanPastedHtml,
    },
    onUpdate: ({ editor: ed, transaction }) => {
      if (!transaction.docChanged) return;
      dirty.current = true;
      setUi({ saveStatus: 'unsaved' });
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => void save(), SAVE_DELAY);
      window.clearTimeout(proofTimer.current);
      proofTimer.current = window.setTimeout(() => void proofread(), PROOF_DELAY);
      const text = ed.getText({ blockSeparator: '\n\n' });
      setWords(countWords(text));
      setChars(countChars(text));
    },
    onSelectionUpdate: ({ editor: ed }) => {
      const { from, to } = ed.state.selection;
      setSelWords(from === to ? 0 : countWords(ed.state.doc.textBetween(from, to, ' ')));
    },
  });

  const save = useCallback(async () => {
    window.clearTimeout(saveTimer.current);
    if (!dirty.current || !editor || editor.isDestroyed) return;
    dirty.current = false;
    setUi({ saveStatus: 'saving' });
    try {
      const rec = await saveSceneContent(sceneRef.current.id, editor.getJSON() as Scene['content']);
      if (!rec) throw new Error('This scene no longer exists. Copy your text before leaving.');
      savedRev.current = rec.rev;
      setUi({ saveStatus: dirty.current ? 'unsaved' : 'saved', saveError: null });
    } catch (e) {
      dirty.current = true;
      setUi({ saveStatus: 'error', saveError: e instanceof Error ? e.message : String(e) });
      // Retry: local saves can fail transiently (e.g. storage busy).
      saveTimer.current = window.setTimeout(() => void save(), 5000);
    }
  }, [editor]);

  const proofread = useCallback(async () => {
    if (!editor || editor.isDestroyed || !proofOn) return;
    onProofread('Checking…');
    try {
      const r = await runProofread(editor, sceneRef.current.projectId);
      if (r.stale) return;
      onProofread(
        r.spellingError
          ? `Spelling unavailable (${r.spellingError}); other checks ran`
          : r.count
            ? `${r.count} suggestion${r.count === 1 ? '' : 's'}`
            : 'No suggestions',
      );
    } catch (e) {
      onProofread(`Check failed: ${e instanceof Error ? e.message : e}`);
    }
  }, [editor, onProofread, proofOn]);

  // Expose editor to panels; register flush for navigation/export/unload.
  useEffect(() => {
    onEditor(editor);
    const unregister = registerFlusher(save);
    const onHide = () => void save();
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      unregister();
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
      void save();
      onEditor(null);
    };
  }, [editor, onEditor, save]);

  // Initial and on-demand proofreading.
  useEffect(() => {
    if (!editor) return;
    if (proofOn) void proofread();
    else {
      clearProofread(editor);
      onProofread('Proofreading is off');
    }
  }, [editor, proofOn, proofread, proofRequest, onProofread, settings.dialect, settings.disabledCategories, settings.disabledRules]);

  // Changes from another tab or a sync: reload if we have nothing unsaved; otherwise flag a conflict.
  useEffect(() => {
    if (!editor || editor.isDestroyed || scene.rev <= savedRev.current) return;
    if (JSON.stringify(scene.content) === JSON.stringify(editor.getJSON())) {
      savedRev.current = scene.rev;
      return;
    }
    if (dirty.current) {
      setConflict(true);
      return;
    }
    savedRev.current = scene.rev;
    editor.commands.setContent(scene.content, { emitUpdate: false });
    setWords(scene.wordCount);
  }, [scene.rev, scene.content, scene.wordCount, editor]);

  // Font settings
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    el.style.setProperty('--ed-size', `${settings.fontSize}px`);
    el.style.setProperty('--ed-line', String(settings.lineHeight));
    el.style.setProperty('--ed-width', settings.pageWidth === 'narrow' ? '32em' : settings.pageWidth === 'wide' ? '48em' : '38em');
    el.dataset.font = settings.fontFamily;
  }, [settings.fontSize, settings.lineHeight, settings.fontFamily, settings.pageWidth]);

  // Keyboard shortcuts scoped to the editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setFindOpen(true);
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save().then(() => toast('Saved on this device'));
      } else if (mod && e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setUi((s) => ({ focusMode: !s.focusMode }));
      } else if (e.key === 'Escape' && popover) {
        setPopover(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, popover]);

  const onEditorClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const ref = target.closest('.ref-link') as HTMLElement | null;
    if (ref?.dataset.refId) {
      setUi({ quickRefId: ref.dataset.refId, rightOpen: true, rightTab: 'reference' });
    }
    const sug = target.closest('[data-sid]') as HTMLElement | null;
    if (sug && editor) {
      const s = getSuggestions(editor.state).find((x) => x.key === sug.dataset.sid);
      if (s) {
        const box = wrapRef.current!.getBoundingClientRect();
        const r = sug.getBoundingClientRect();
        setPopover({ s, x: Math.min(r.left - box.left, box.width - 300), y: r.bottom - box.top + wrapRef.current!.scrollTop + 6 });
        editor.view.dispatch(editor.state.tr.setMeta(proofreadKey, activeSuggestionMeta(s.key)));
        return;
      }
    }
    if (popover) setPopover(null);
  };

  const words_ = words;
  const statusLabel = scene.status;

  if (!editor) return null;

  return (
    <div className={`editor-wrap${focusMode ? ' focus' : ''}`} ref={wrapRef}>
      <Toolbar
        editor={editor}
        onFind={() => setFindOpen((v) => !v)}
        onLink={() => setPickerOpen(true)}
        onSnapshot={async () => {
          await save();
          const s = await db.scenes.get(scene.id);
          if (s) await createSnapshot(s, 'manual');
          toast('Snapshot saved. Find it under History.');
        }}
      />
      {findOpen && <FindBar editor={editor} initialQuery={initialFind ?? ''} onClose={() => setFindOpen(false)} />}
      <TipCard />
      {conflict && (
        <div className="banner warn" role="alert">
          This scene was changed in another window or device while you were editing. Your version is shown and will be saved;
          the other version is kept in History.
          <button
            onClick={async () => {
              const other = await db.scenes.get(scene.id);
              if (other) await createSnapshot(other, 'conflict: other version');
              dirty.current = true;
              await save();
              setConflict(false);
            }}
          >
            Keep mine
          </button>
        </div>
      )}
      <div className="page" onClick={onEditorClick}>
        <EditorContent editor={editor} />
        <BubbleMenu
          editor={editor}
          className="bubble"
          shouldShow={({ state }) => !state.selection.empty && state.doc.textBetween(state.selection.from, state.selection.to).trim().length > 0}
        >
          <button className={editor.isActive('bold') ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleBold().run()} aria-label="Bold">
            <b>B</b>
          </button>
          <button className={editor.isActive('italic') ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleItalic().run()} aria-label="Italic">
            <i>I</i>
          </button>
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => setPickerOpen(true)}>
            <Icon name="link" size={15} /> Link to character / place…
          </button>
        </BubbleMenu>
        {popover && (
          <SuggestionPopover
            editor={editor}
            s={popover.s}
            x={popover.x}
            y={popover.y}
            projectId={scene.projectId}
            onClose={() => {
              setPopover(null);
              editor.view.dispatch(editor.state.tr.setMeta(proofreadKey, activeSuggestionMeta(null)));
            }}
            onRerun={() => void proofread()}
          />
        )}
      </div>
      <footer className="editor-footer" aria-live="polite">
        <span title="Words in selection">{selWords ? `${selWords.toLocaleString()} selected · ` : ''}</span>
        <span>Scene {words_.toLocaleString()}</span>
        <span>Chapter {(chapterOtherWords + words_).toLocaleString()}</span>
        <span>Book {(bookOtherWords + words_).toLocaleString()}</span>
        <span className="muted">{chars.toLocaleString()} chars</span>
        <span className="muted">{statusLabel[0].toUpperCase() + statusLabel.slice(1)}</span>
      </footer>
      {pickerOpen && (
        <ReferencePicker
          projectId={scene.projectId}
          initialQuery={editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, ' ')}
          onClose={() => setPickerOpen(false)}
          onPick={(ref) => {
            setPickerOpen(false);
            const { from, to } = editor.state.selection;
            if (from === to) {
              editor.chain().focus().insertContent({ type: 'text', text: ref.name, marks: [{ type: 'refLink', attrs: { refId: ref.id } }] }).run();
            } else {
              editor.chain().focus().setRefLink(ref.id).run();
            }
          }}
        />
      )}
    </div>
  );
}

function Toolbar({ editor, onFind, onLink, onSnapshot }: { editor: Editor; onFind: () => void; onLink: () => void; onSnapshot: () => void }) {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    editor.on('selectionUpdate', f);
    editor.on('transaction', f);
    return () => {
      editor.off('selectionUpdate', f);
      editor.off('transaction', f);
    };
  }, [editor]);
  const btn = (icon: React.ReactNode, label: string, title: string, active: boolean, run: () => void, opts: { disabled?: boolean; iconOnly?: boolean; cls?: string } = {}) => (
    <button
      type="button"
      className={['tb', active ? 'on' : '', opts.cls ?? ''].filter(Boolean).join(' ')}
      aria-pressed={active}
      aria-label={title}
      title={title}
      disabled={opts.disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      <span className="tb-icon" aria-hidden>
        {icon}
      </span>
      {!opts.iconOnly && <span className="tb-label">{label}</span>}
    </button>
  );
  const c = () => editor.chain().focus();
  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      {btn('B', 'Bold', 'Bold (Ctrl+B)', editor.isActive('bold'), () => c().toggleBold().run(), { iconOnly: true, cls: 'b' })}
      {btn('I', 'Italic', 'Italic (Ctrl+I)', editor.isActive('italic'), () => c().toggleItalic().run(), { iconOnly: true, cls: 'i' })}
      {btn('U', 'Underline', 'Underline (Ctrl+U)', editor.isActive('underline'), () => c().toggleUnderline().run(), { iconOnly: true, cls: 'u' })}
      <span className="tb-sep" />
      {btn(<Icon name="heading" size={16} />, 'Heading', 'Make this line a heading', editor.isActive('heading', { level: 2 }), () => c().toggleHeading({ level: 2 }).run())}
      {btn(<Icon name="quote" size={16} />, 'Quote', 'Indent as a block quote (letters, poems, inscriptions)', editor.isActive('blockquote'), () => c().toggleBlockquote().run())}
      {btn(<Icon name="sceneBreak" size={16} />, 'Scene break', 'Insert a scene break (* * *)', false, () => c().setHorizontalRule().run())}
      <span className="tb-sep" />
      {btn(<Icon name="undo" size={16} />, 'Undo', 'Undo (Ctrl+Z)', false, () => c().undo().run(), { disabled: !editor.can().undo(), iconOnly: true })}
      {btn(<Icon name="redo" size={16} />, 'Redo', 'Redo (Ctrl+Y)', false, () => c().redo().run(), { disabled: !editor.can().redo(), iconOnly: true })}
      <span className="tb-sep" />
      {btn(<Icon name="link" size={16} />, 'Link', 'Link the selected words to a character, place or other entry', editor.isActive('refLink'), onLink)}
      {editor.isActive('refLink') && btn(<Icon name="unlink" size={16} />, 'Unlink', 'Remove this link (the words stay)', false, () => c().extendMarkRange('refLink').unsetRefLink().run())}
      {btn(<Icon name="search" size={16} />, 'Find', 'Find & replace in this scene (Ctrl+F)', false, onFind)}
      {btn(<Icon name="camera" size={16} />, 'Snapshot', 'Save a copy of this scene as it is now (see History)', false, onSnapshot)}
      {btn(<Icon name="focus" size={16} />, 'Focus', 'Hide everything except your page (Ctrl+Alt+F, Esc to leave)', false, () => setUi((s) => ({ focusMode: !s.focusMode })))}
    </div>
  );
}

function SuggestionPopover({
  editor,
  s,
  x,
  y,
  projectId,
  onClose,
  onRerun,
}: {
  editor: Editor;
  s: PlacedSuggestion;
  x: number;
  y: number;
  projectId: string;
  onClose: () => void;
  onRerun: () => void;
}) {
  const accept = (rep: string) => {
    const ok = applyPlaced(editor.state, editor.view.dispatch, s, rep);
    onClose();
    if (!ok) {
      toast('That suggestion is out of date because the text changed. Re-checking…');
      onRerun();
      return;
    }
    toast(`Changed “${s.original}” to “${rep || '(removed)'}”`, { action: { label: 'Undo', run: () => editor.chain().focus().undo().run() } });
  };
  const ignore = async () => {
    await db.ignored.put({ id: baseKey(s.key), projectId, ruleId: s.ruleId, key: baseKey(s.key) });
    editor.view.dispatch(editor.state.tr.setMeta(proofreadKey, removeSuggestionMeta(s.key)));
    onClose();
  };
  const addToDictionary = async () => {
    try {
      await createRecord('dictionary', projectId, { word: s.original });
      onClose();
      toast(`Added “${s.original}” to this project's dictionary`);
      onRerun();
    } catch (e) {
      reportError(e, 'Could not add word');
    }
  };
  const disableRule = async () => {
    const st = await getSettings();
    await updateSettings({ disabledRules: [...new Set([...st.disabledRules, s.ruleId])] });
    onClose();
    toast(`Turned off this check. Re-enable it in Settings → Proofreading.`);
  };
  return (
    <div className="popover" style={{ left: Math.max(0, x), top: y }} role="dialog" aria-label="Writing suggestion">
      <div className="pop-head">
        <span className={`sev sev-${s.severity}`}>{s.severity === 'error' ? 'Likely error' : s.severity === 'warning' ? 'Check' : 'Style'}</span>
        <span className="muted">{CATEGORY_LABELS[s.category]}</span>
      </div>
      <p>{s.message}</p>
      {s.replacements.length > 0 && (
        <div className="pop-reps">
          {s.replacements.map((r) => (
            <button key={r} className="primary" onClick={() => accept(r)}>
              {r === ' ' ? 'Single space' : r === '' ? 'Remove' : r}
            </button>
          ))}
        </div>
      )}
      <div className="pop-actions">
        <button onClick={ignore}>Ignore</button>
        {(s.category === 'spelling' || s.category === 'consistency') && <button onClick={addToDictionary}>Add to dictionary</button>}
        <button onClick={disableRule}>Turn off this check</button>
        <button onClick={onClose} aria-label="Close">✕</button>
      </div>
    </div>
  );
}

const TIP_KEY = 'authordesk.tips.editor';

/** A one-time, dismissible orientation card for new writers. */
function TipCard() {
  const [show, setShow] = useState(() => {
    try {
      return localStorage.getItem(TIP_KEY) !== 'done';
    } catch {
      return false;
    }
  });
  if (!show) return null;
  const done = () => {
    setShow(false);
    try {
      localStorage.setItem(TIP_KEY, 'done');
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="tip-card" role="note">
      <strong>Welcome to your page.</strong>
      <ul>
        <li>Just type — everything saves automatically.</li>
        <li>Select a character’s name to link it to their notes, or to make it bold or italic.</li>
        <li>Press <kbd>Ctrl K</kbd> to jump to any chapter or character. Press <kbd>F1</kbd> for help.</li>
      </ul>
      <button className="small" onClick={done}>
        Got it
      </button>
    </div>
  );
}
