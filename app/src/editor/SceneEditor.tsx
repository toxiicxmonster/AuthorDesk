import { useCallback, useEffect, useRef, useState } from 'react';
import { navigate } from '../ui/router';
import { EditorContent, useEditor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { Icon } from '../ui/components/Icon';
import type { Editor } from '@tiptap/core';
import type { Scene } from '../domain/schema';
import { countChars, countWords } from '../domain/text';
import { saveSceneContent, createSnapshot, createRecord, updateRecord } from '../storage/repo';
import { db } from '../storage/db';
import { getSettings, updateSettings, useSettings } from '../storage/settings';
import { confirmDialog, getUi, setUi, toast, useUi, reportError } from '../ui/store';
import { cleanPastedHtml, editorExtensions } from './extensions';
import { registerFlusher } from './EditorContext';
import { applyPlaced, getSuggestions, suggestionsAt, activeSuggestionMeta, proofreadKey, removeSuggestionMeta, type PlacedSuggestion } from './proofreadExtension';
import { baseKey, runProofread, clearProofread, type ProofreadOutcome } from './proofreadRunner';
import { FindBar } from './FindBar';
import { ReferencePicker } from '../ui/components/ReferencePicker';
import { CATEGORY_LABELS, SEVERITY_LABEL } from '../proofreading/types';
import { createReference } from '../domain/references';
import { applyFact, type Attribute } from '../proofreading/characterFacts';
import { fetchAiStatus } from '../ai/aiEditor';
import { aiTaskForMark } from '../ai/markTask';
import { bestForMark, type MarkRequest } from '../ai/markRewrite';
import { wordDiff } from '../ai/diff';
import { applyVersion } from '../ui/components/AiResults';
import { sentenceAround } from '../ai/adverbJudge';
import { contextSynonyms } from '../ai/contextSynonyms';
import { avoidEchoes } from '../proofreading/echo';

const SAVE_DELAY = 700;
/** Underlines refresh this soon after a pause in typing (on-device checks; unchanged paragraphs come from a cache). */
const PROOF_DELAY = 600;
/** The optional online check waits for a longer pause, so it sends each edited paragraph about once. */
const ONLINE_DELAY = 2500;

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
  const onlineTimer = useRef<number | undefined>(undefined);
  const savedRev = useRef(scene.rev);
  const [words, setWords] = useState(scene.wordCount);
  const [chars, setChars] = useState(countChars(scene.plainText));
  const [selWords, setSelWords] = useState(0);
  const [findOpen, setFindOpen] = useState(!!initialFind);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [popover, setPopover] = useState<({ items: PlacedSuggestion[] } & PopoverPlacement) | null>(null);
  // Whether the AI Editor is installed: then clicking a mark it can help with opens it on that sentence.
  const aiInstalled = useRef(false);
  useEffect(() => {
    void fetchAiStatus().then((st) => {
      aiInstalled.current = !!st?.installed;
    });
  }, []);
  const wrapRef = useRef<HTMLDivElement>(null);
  const proofOn = settings.proofreadEnabled;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
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
      window.clearTimeout(onlineTimer.current);
      proofTimer.current = window.setTimeout(() => void proofread(false), PROOF_DELAY);
      if (settingsRef.current.onlineCheck.enabled) onlineTimer.current = window.setTimeout(() => void proofread(true), ONLINE_DELAY);
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

  const proofread = useCallback(
    async (sendOnline = true) => {
      if (!editor || editor.isDestroyed || !proofOn) return;
      const describe = (r: ProofreadOutcome, checkingOnline = false) => {
        const parts = [r.count ? `${r.count} suggestion${r.count === 1 ? '' : 's'}` : 'No suggestions'];
        if (r.spellingError) parts.push(`spelling unavailable (${r.spellingError})`);
        if (checkingOnline) parts.push('checking online…');
        else if (r.online?.error) parts.push(r.online.error);
        return parts.join(' · ');
      };
      try {
        const r = await runProofread(editor, sceneRef.current.projectId, { sendOnline, sceneId: sceneRef.current.id, onLocal: (l) => onProofread(describe(l, true)) });
        if (r.stale) return;
        onProofread(describe(r));
      } catch (e) {
        onProofread(`Check failed: ${e instanceof Error ? e.message : e}`);
      }
    },
    [editor, onProofread, proofOn],
  );

  // Expose editor to panels; register flush for navigation/export/unload.
  useEffect(() => {
    onEditor(editor);
    const unregister = registerFlusher(save);
    const onHide = () => void save();
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.clearTimeout(proofTimer.current);
      window.clearTimeout(onlineTimer.current);
      unregister();
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
      void save();
      onEditor(null);
    };
  }, [editor, onEditor, save]);

  // Initial and on-demand proofreading; re-run only when proofreading settings change (not on theme changes etc.).
  const proofSettingsKey = [
    settings.dialect,
    settings.disabledCategories.join(),
    settings.disabledRules.join(),
    settings.onlineCheck.enabled && settings.onlineCheck.consentedAt ? settings.onlineCheck.endpoint : '',
    settings.onlineCheck.picky,
  ].join('|');
  useEffect(() => {
    if (!editor) return;
    if (proofOn) void proofread();
    else {
      clearProofread(editor);
      onProofread('Proofreading is off');
    }
  }, [editor, proofOn, proofread, proofRequest, onProofread, proofSettingsKey]);

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
      // The span may stand for several overlapping suggestions; find them all by position.
      let items: PlacedSuggestion[] = [];
      try {
        const from = editor.view.posAtDOM(sug, 0);
        items = suggestionsAt(editor.state, from, from + Math.max(1, sug.textContent?.length ?? 0));
      } catch {
        /* fall back to the span's own id */
      }
      if (!items.length) items = getSuggestions(editor.state).filter((x) => x.key === sug.dataset.sid);
      if (items.length) {
        setPopover({ items, ...popoverPlacement(e.currentTarget as HTMLElement, sug.getBoundingClientRect()) });
        editor.view.dispatch(editor.state.tr.setMeta(proofreadKey, activeSuggestionMeta(items[0].key)));
        if (aiInstalled.current) {
          // The AI Editor works on the mark's sentence: in the side panel on wide screens, in the popover otherwise.
          const panel = window.innerWidth > 900;
          const request = aiRequestFor(editor, items, panel);
          if (request) setUi({ aiRequest: request, aiBest: null, ...(panel ? { rightOpen: true, rightTab: 'ai' as const } : {}) });
        }
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
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => setUi({ rightOpen: true, rightTab: 'ai' })} title="Open the AI Editor with this selection">
            Ask AI Editor…
          </button>
        </BubbleMenu>
        {popover && (
          <SuggestionPopover
            editor={editor}
            items={popover.items}
            x={popover.x}
            y={popover.y}
            above={popover.above}
            projectId={scene.projectId}
            aiInstalled={aiInstalled.current}
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
      {btn(<Icon name="write" size={16} />, 'AI Editor', 'Rewrite, smooth or tighten the selected passage (suggestions only, on this PC)', false, () => setUi({ rightOpen: true, rightTab: 'ai' }))}
      {btn(<Icon name="focus" size={16} />, 'Focus', 'Hide everything except your page (Ctrl+Alt+F, Esc to leave)', false, () => setUi((s) => ({ focusMode: !s.focusMode })))}
    </div>
  );
}

interface PopoverPlacement {
  x: number;
  y: number;
  /** Open upwards from y (not enough room below the word). */
  above: boolean;
}

const POPOVER_WIDTH = 300;
const POPOVER_ROOM = 260;

/**
 * Where to put the popover inside `page`, the scrolling element it is rendered in (its containing block):
 * coordinates are relative to page's content, so its own scroll offset is added.
 */
export function popoverPlacement(page: HTMLElement, word: Pick<DOMRect, 'left' | 'top' | 'bottom'>): PopoverPlacement {
  const box = page.getBoundingClientRect();
  const x = Math.max(0, Math.min(word.left - box.left + page.scrollLeft, page.clientWidth - POPOVER_WIDTH - 8));
  const above = box.bottom - word.bottom < POPOVER_ROOM && word.top - box.top > POPOVER_ROOM;
  const y = (above ? word.top - box.top - 6 : word.bottom - box.top + 6) + page.scrollTop;
  return { x, y, above };
}

/** The AI Editor request for the first mark it can help with: that mark's sentence and the action that suits it. */
function aiRequestFor(editor: Editor, items: PlacedSuggestion[], panel: boolean): MarkRequest | null {
  for (const it of items) {
    const pick = aiTaskForMark(it);
    if (!pick) continue;
    const $pos = editor.state.doc.resolve(it.from);
    const para = $pos.parent.textBetween(0, $pos.parent.content.size, undefined, '\n');
    const at = it.from - $pos.start();
    const { sentence } = sentenceAround(para, at, at + (it.to - it.from));
    // Just the sentence; for an echo, the AI is told to drop the word there (the earlier use stays as it is).
    const whole = !sentence;
    const offset = whole ? 0 : Math.max(0, para.lastIndexOf(sentence, at));
    const text = whole ? para : sentence;
    // Where the passage is, so "Use" can put the chosen version in its place.
    const from = $pos.start() + offset;
    return { id: Date.now(), text, context: para, task: pick.task, focus: pick.focus, from, to: from + text.length, markKey: it.key, panel };
  }
  return null;
}

function SuggestionPopover({
  editor,
  items,
  x,
  y,
  above,
  projectId,
  aiInstalled,
  onClose,
  onRerun,
}: {
  editor: Editor;
  /** Every suggestion on the clicked words, most useful first. */
  items: PlacedSuggestion[];
  x: number;
  y: number;
  above: boolean;
  projectId: string;
  aiInstalled: boolean;
  onClose: () => void;
  onRerun: () => void;
}) {
  return (
    <div className="popover" style={{ left: x, top: y, transform: above ? 'translateY(-100%)' : undefined }} role="dialog" aria-label="Writing suggestion">
      <button className="pop-close" onClick={onClose} aria-label="Close">
        ✕
      </button>
      {items.map((s) => (
        <SuggestionItem key={s.key} editor={editor} s={s} projectId={projectId} aiInstalled={aiInstalled} onClose={onClose} onRerun={onRerun} />
      ))}
    </div>
  );
}

function SuggestionItem({
  editor,
  s,
  projectId,
  aiInstalled,
  onClose,
  onRerun,
}: {
  editor: Editor;
  s: PlacedSuggestion;
  projectId: string;
  aiInstalled: boolean;
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
  const wordList = s.category === 'spelling' || s.category === 'consistency';
  if ((s.ruleId === 'continuity' || s.ruleId === 'continuity-death') && s.data) {
    const d = s.data;
    const first = d.characterName.split(/\s+/)[0];
    return (
      <div className="pop-item">
        <div className="pop-head">
          <span className="sev sev-conflict">Continuity</span>
          <span className="muted">{d.characterName}</span>
        </div>
        <p>{s.message}</p>
        <div className="pop-reps">
          {d.otherSceneId && (
            <button
              className="primary"
              onClick={() => {
                onClose();
                navigate(projectId, 'write', d.otherSceneId, { find: d.otherFind });
              }}
            >
              Go to {d.otherChapter}
            </button>
          )}
          <button onClick={ignore} title="Don’t flag this difference again">
            {s.ruleId === 'continuity' ? 'It changed on purpose' : 'This is fine'}
          </button>
        </div>
        <div className="pop-actions">
          <button
            onClick={() => {
              onClose();
              setUi({ quickRefId: d.characterId, rightOpen: true, rightTab: 'reference' });
            }}
          >
            Open {first}’s entry
          </button>
          <button onClick={disableRule}>Turn off this check</button>
        </div>
      </div>
    );
  }
  if ((s.ruleId === 'character-fact' || s.ruleId === 'character-conflict') && s.data) {
    const d = s.data;
    const isNew = s.ruleId === 'character-fact';
    const first = d.characterName.split(/\s+/)[0];
    const shown = d.attribute === 'feature' ? 'yes' : d.value;
    // Writes only to the character's reference entry; the manuscript is never touched.
    const updateEntry = async () => {
      try {
        const ref = await db.references.get(d.characterId);
        if (!ref) return toast(`${d.characterName} is no longer in your characters list.`);
        const before = ref.fields.appearance ?? '';
        const after = applyFact(before, { attribute: d.attribute as Attribute, label: d.label, value: d.value, existing: isNew ? null : d.existing });
        if (!isNew) {
          const ok = await confirmDialog(`Update ${d.characterName}’s entry?`, `Physical appearance now:\n${before}\n\nAfter the update:\n${after}`, {
            confirmLabel: 'Update entry',
          });
          if (!ok) return;
        }
        await updateRecord('references', ref.id, { fields: { ...ref.fields, appearance: after } });
        onClose();
        toast(isNew ? `Added “${d.label}: ${shown}” to ${first}’s entry` : `Updated ${first}’s ${d.label.toLowerCase()} to ${d.value}`, {
          action: {
            label: 'Undo',
            run: async () => {
              const cur = await db.references.get(ref.id);
              if (cur) await updateRecord('references', cur.id, { fields: { ...cur.fields, appearance: before } });
              onRerun();
            },
          },
        });
        onRerun();
      } catch (e) {
        reportError(e, 'Could not update the character entry');
      }
    };
    return (
      <div className="pop-item">
        <div className="pop-head">
          <span className={`sev sev-${s.severity}`}>{SEVERITY_LABEL[s.severity]}</span>
          <span className="muted">{d.characterName}</span>
        </div>
        <p>{s.message}</p>
        <div className="pop-reps">
          <button className="primary" onClick={() => void updateEntry()}>
            {isNew ? `Add “${d.label}: ${shown}” to ${first}’s entry` : `Update ${first}’s entry to ${d.value}`}
          </button>
          {!isNew && <button onClick={ignore}>Keep the entry</button>}
        </div>
        <div className="pop-actions">
          <button
            onClick={() => {
              onClose();
              setUi({ quickRefId: d.characterId, rightOpen: true, rightTab: 'reference' });
            }}
          >
            Open {first}’s entry
          </button>
          {isNew && <button onClick={ignore}>Ignore</button>}
          <button onClick={disableRule}>Turn off this check</button>
        </div>
      </div>
    );
  }
  if (s.ruleId === 'new-name') {
    const addAs = async (type: 'character' | 'location') => {
      try {
        const ref = await createReference(projectId, type, s.original);
        onClose();
        toast(`Added “${s.original}” to your ${type === 'character' ? 'characters' : 'places'}. It won’t be flagged again.`, {
          action: { label: 'Open', run: () => setUi({ quickRefId: ref.id, rightOpen: true, rightTab: 'reference' }) },
        });
        onRerun();
      } catch (e) {
        reportError(e, 'Could not add the name');
      }
    };
    return (
      <div className="pop-item">
        <div className="pop-head">
          <span className="sev sev-warning">New name?</span>
          <span className="muted">Characters & world</span>
        </div>
        <p>{s.message}</p>
        <div className="pop-reps">
          <button className="primary" onClick={() => void addAs('character')}>
            Add to characters
          </button>
          <button onClick={() => void addAs('location')}>Add as a place</button>
        </div>
        {s.replacements.length > 0 && (
          <div className="pop-reps">
            <span className="small muted">Typo? Change to:</span>
            {s.replacements.map((r) => (
              <button key={r} onClick={() => accept(r)}>
                {r}
              </button>
            ))}
          </div>
        )}
        <div className="pop-actions">
          <button onClick={addToDictionary} title="Add to the dictionary so it isn’t flagged, without making a character entry">
            Not a name
          </button>
          <button onClick={ignore}>Ignore</button>
          <button onClick={disableRule}>Turn off this check</button>
        </div>
      </div>
    );
  }
  return (
    <div className="pop-item">
      <div className="pop-head">
        <span className={`sev sev-${s.severity}`}>{SEVERITY_LABEL[s.severity]}</span>
        <span className="muted">{CATEGORY_LABELS[s.category]}</span>
      </div>
      <p>{s.message}</p>
      {aiInstalled && <AiInline editor={editor} s={s} onClose={onClose} />}
      {s.ruleId === 'echo-word' && aiInstalled ? (
        <EchoFits editor={editor} s={s} accept={accept} />
      ) : (
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
        {wordList && <button onClick={addToDictionary}>Add to dictionary</button>}
        <button onClick={disableRule}>Turn off this check</button>
      </div>
    </div>
  );
}

/**
 * The AI Editor's best version of a mark's sentence, right in the popover, with Use. On wide screens the side panel
 * runs the request (with more versions there); on small screens the popover runs it itself.
 */
function AiInline({ editor, s, onClose }: { editor: Editor; s: PlacedSuggestion; onClose: () => void }) {
  const request = useUi((u) => (u.aiRequest?.markKey === s.key ? u.aiRequest : null));
  const best = useUi((u) => (request && u.aiBest?.requestId === request.id ? u.aiBest : null));
  useEffect(() => {
    if (!request || request.panel || getUi().aiBest?.requestId === request.id) return;
    const ctrl = new AbortController();
    bestForMark(request, { signal: ctrl.signal })
      .then((text) => setUi({ aiBest: { requestId: request.id, text, done: true, error: null } }))
      .catch((e) => {
        if (!ctrl.signal.aborted) setUi({ aiBest: { requestId: request.id, text: null, done: true, error: e instanceof Error ? e.message : 'The AI Editor ran into a problem.' } });
      });
    return () => ctrl.abort();
  }, [request]);
  if (!request) return null;
  const more = () => {
    onClose();
    setUi({ rightOpen: true, rightTab: 'ai', aiRequest: { ...request, id: Date.now(), panel: true }, aiBest: null });
  };
  if (!best) return <p className="small muted pop-ai">AI Editor: writing a suggestion…</p>;
  if (!best.text) return null;
  const text = best.text;
  return (
    <div className="pop-ai">
      <span className="small muted">AI Editor suggests</span>
      <p>
        {wordDiff(request.text, text).map((part, i) =>
          part.changed ? (
            <mark key={i} className="ai-changed">
              {part.text}
            </mark>
          ) : (
            <span key={i}>{part.text}</span>
          ),
        )}
      </p>
      <div className="pop-reps">
        <button
          className="primary"
          onClick={() => {
            if (applyVersion(editor, { from: request.from, to: request.to, text: request.text }, text)) onClose();
          }}
        >
          Use
        </button>
        {!request.panel && <button onClick={more}>More in the AI Editor</button>}
      </div>
    </div>
  );
}

/** Echo words: alternatives the AI picks to fit this exact sentence (the general thesaurus list if it can't). */
function EchoFits({ editor, s, accept }: { editor: Editor; s: PlacedSuggestion; accept: (r: string) => void }) {
  const [fits, setFits] = useState<string[] | null>(null);
  useEffect(() => {
    let alive = true;
    const $pos = editor.state.doc.resolve(s.from);
    const para = $pos.parent.textBetween(0, $pos.parent.content.size, undefined, '\n');
    const at = s.from - $pos.start();
    const { sentence } = sentenceAround(para, at, at + s.original.length);
    // About 100 words either side, wider than the echo window: words used there would only make a new echo.
    const doc = editor.state.doc;
    const nearby = doc.textBetween(Math.max(0, s.from - 600), s.from, ' ') + ' ' + doc.textBetween(s.to, Math.min(doc.content.size, s.to + 600), ' ');
    const fallback = avoidEchoes(s.original, s.replacements, nearby);
    contextSynonyms(s.original, sentence || para, {}, nearby)
      .then((list) => alive && setFits(list.length ? list : fallback))
      .catch(() => alive && setFits(fallback));
    return () => {
      alive = false;
    };
  }, [editor, s]);
  if (!fits) return <p className="small muted">Finding words that fit this sentence…</p>;
  if (!fits.length) return <p className="small muted">No single word fits well here; the AI Editor’s rewrite (side panel) reshapes the sentence instead.</p>;
  return (
    <div className="pop-reps">
      {fits.map((r) => (
        <button key={r} className="primary" onClick={() => accept(r)}>
          {r}
        </button>
      ))}
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
