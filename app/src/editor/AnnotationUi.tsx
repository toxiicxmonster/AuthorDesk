import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import {
  HIGHLIGHT_COLORS,
  HIGHLIGHT_LABELS,
  listComments,
  type HighlightColor,
  type SceneComment,
} from './annotations';
import { useEditorCtx } from './EditorContext';
import { Modal, relativeTime } from '../ui/components/common';
import { Icon } from '../ui/components/Icon';
import { toast } from '../ui/store';

/** The colour the highlighter last used, so one click (or Ctrl+Alt+H) repeats it. */
const LAST_KEY = 'authordesk:highlight';
export function lastHighlight(): HighlightColor {
  try {
    const v = localStorage.getItem(LAST_KEY) as HighlightColor | null;
    return v && (HIGHLIGHT_COLORS as readonly string[]).includes(v) ? v : 'yellow';
  } catch {
    return 'yellow';
  }
}
function rememberHighlight(c: HighlightColor) {
  try {
    localStorage.setItem(LAST_KEY, c);
  } catch {
    /* not kept; the default is fine */
  }
}

/** Highlight the selection in a colour, or take the highlight off when it already has that colour. */
export function applyHighlight(editor: Editor, color: HighlightColor) {
  const { empty } = editor.state.selection;
  if (empty) return toast('Select the words to highlight first.');
  rememberHighlight(color);
  if (editor.isActive('highlight', { color })) editor.chain().focus().unsetHighlight().run();
  else editor.chain().focus().setHighlight(color).run();
}

/** Toolbar control: the highlighter (last colour) and a menu of colours. */
export function HighlightPicker({ editor, showLabel }: { editor: Editor; showLabel: boolean }) {
  const [open, setOpen] = useState(false);
  const [color, setColor] = useState<HighlightColor>(lastHighlight);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // The toolbar scrolls sideways (so it clips what sticks out of it): the menu is drawn at the top level of the page,
  // placed against the window under its button.
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const toggle = () => {
    if (open) return setOpen(false);
    const r = ref.current?.getBoundingClientRect();
    if (r) setAt({ left: Math.max(8, Math.min(r.left, window.innerWidth - 120 - 8)), top: r.bottom + 4 });
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) =>
      !!t && (ref.current?.contains(t as Node) || menuRef.current?.contains(t as Node));
    const close = (e: MouseEvent) => !inside(e.target) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    // Placed against the window, so it closes rather than float in place when the page scrolls or the window resizes.
    const gone = (e: Event) => !inside(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', gone, true);
    window.addEventListener('resize', gone);
    menuRef.current?.querySelector<HTMLButtonElement>('.hl-swatch')?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', gone, true);
      window.removeEventListener('resize', gone);
    };
  }, [open]);
  const pick = (c: HighlightColor) => {
    setColor(c);
    setOpen(false);
    applyHighlight(editor, c);
  };
  return (
    <div className="hl-picker" ref={ref}>
      <button
        type="button"
        className={`tb hl-main${editor.isActive('highlight') ? ' on' : ''}`}
        title={`Highlight the selection in ${HIGHLIGHT_LABELS[color].toLowerCase()} (Ctrl+Alt+H). Only you see highlights; they're left out of exports.`}
        aria-label={`Highlight in ${HIGHLIGHT_LABELS[color].toLowerCase()}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => applyHighlight(editor, color)}
      >
        <span className="tb-icon" aria-hidden>
          <span className={`hl-pen hl-${color}`}>
            <Icon name="highlight" size={16} />
          </span>
        </span>
        {showLabel && <span className="tb-label">Highlight</span>}
      </button>
      <button
        type="button"
        className="tb hl-more"
        aria-label="Highlight colours"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Choose a highlight colour"
        onMouseDown={(e) => e.preventDefault()}
        onClick={toggle}
      >
        ▾
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="hl-menu"
            role="menu"
            aria-label="Highlight colours"
            style={at ? { position: 'fixed', left: at.left, top: at.top } : undefined}
          >
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="menuitem"
                className={`hl-swatch hl-${c}`}
                title={HIGHLIGHT_LABELS[c]}
                aria-label={`${HIGHLIGHT_LABELS[c]} highlight`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(c)}
              />
            ))}
            <button
              type="button"
              role="menuitem"
              className="hl-none"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setOpen(false);
                editor.chain().focus().unsetHighlight().run();
              }}
            >
              No highlight
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}

export type CommentTarget =
  | { mode: 'new'; from: number; to: number; quote: string }
  | { mode: 'edit'; id: string; text: string; quote: string };

/** Start a comment on the selected words (the dialog asks for the note). */
export function newCommentTarget(editor: Editor): CommentTarget | null {
  const { from, to, empty } = editor.state.selection;
  if (empty) {
    toast('Select the words the comment is about first.');
    return null;
  }
  return { mode: 'new', from, to, quote: editor.state.doc.textBetween(from, to, ' ') };
}

/** Write or change a comment. */
export function CommentDialog({
  editor,
  target,
  onClose,
}: {
  editor: Editor;
  target: CommentTarget;
  onClose: () => void;
}) {
  const [text, setText] = useState(target.mode === 'edit' ? target.text : '');
  const save = () => {
    const t = text.trim();
    if (!t) return onClose();
    if (target.mode === 'new')
      editor
        .chain()
        .focus()
        .setTextSelection({ from: target.from, to: target.to })
        .addComment(t)
        .setTextSelection(target.to)
        .run();
    else editor.chain().focus().updateComment(target.id, t).run();
    onClose();
  };
  return (
    <Modal title={target.mode === 'new' ? 'Add a comment' : 'Edit comment'} onClose={onClose}>
      <p className="small muted comment-quote">
        “{target.quote.length > 140 ? `${target.quote.slice(0, 137)}…` : target.quote}”
      </p>
      <label className="field">
        <span>Comment (only you see it; it’s left out of exports)</span>
        <textarea
          rows={4}
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              save();
            }
          }}
          placeholder="A note to yourself: what to fix, check or remember here"
        />
      </label>
      <div className="dialog-actions">
        <span className="muted small grow">Ctrl+Enter to save</span>
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={save}>
          {target.mode === 'new' ? 'Add comment' : 'Save'}
        </button>
      </div>
    </Modal>
  );
}

function CommentBody({ c }: { c: SceneComment }) {
  return (
    <>
      <p className="comment-text">{c.text}</p>
      <p className="muted small">
        {c.author ? `${c.author} · ` : ''}
        {c.at ? relativeTime(c.at) : ''}
      </p>
    </>
  );
}

/** The comments on the clicked words, beside them. */
export function CommentPopover({
  editor,
  ids,
  x,
  y,
  above,
  onEdit,
  onClose,
}: {
  editor: Editor;
  ids: string[];
  x: number;
  y: number;
  above: boolean;
  onEdit: (t: CommentTarget) => void;
  onClose: () => void;
}) {
  const all = listComments(editor.state.doc).filter((c) => ids.includes(c.id));
  if (!all.length) return null;
  return (
    <div
      className="popover comment-pop"
      style={{ left: x, top: y, transform: above ? 'translateY(-100%)' : undefined }}
      role="dialog"
      aria-label="Comment"
    >
      <button className="pop-close" onClick={onClose} aria-label="Close">
        ✕
      </button>
      {all.map((c) => (
        <div key={c.id} className="pop-item">
          <div className="pop-head">
            <span className="sev sev-comment">Comment</span>
          </div>
          <CommentBody c={c} />
          <div className="pop-actions">
            <button
              className="small"
              onClick={() => onEdit({ mode: 'edit', id: c.id, text: c.text, quote: c.quote })}
            >
              Edit
            </button>
            <button
              className="small"
              onClick={() => {
                editor.chain().focus().removeComment(c.id).run();
                onClose();
                toast('Comment removed', {
                  action: { label: 'Undo', run: () => editor.chain().focus().undo().run() },
                });
              }}
            >
              Resolve
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Side panel → Comments: every comment in the open scene, in order. */
export function CommentsPanel() {
  const { editor } = useEditorCtx();
  const [, force] = useState(0);
  const [editing, setEditing] = useState<CommentTarget | null>(null);
  useEffect(() => {
    if (!editor) return;
    const f = () => force((n) => n + 1);
    editor.on('transaction', f);
    return () => {
      editor.off('transaction', f);
    };
  }, [editor]);
  if (!editor) return <p className="muted">Open a scene to see its comments.</p>;
  const comments = listComments(editor.state.doc);
  const go = (c: SceneComment) => {
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.setSelection(TextSelection.create(tr.doc, c.from, c.to)).scrollIntoView();
        return true;
      })
      .run();
  };
  return (
    <div className="comments-panel">
      <div className="row gap">
        <button
          onClick={() => {
            const t = newCommentTarget(editor);
            if (t) setEditing(t);
          }}
        >
          + Comment on the selection
        </button>
      </div>
      <p className="muted small">
        Notes pinned to words in this scene, like comments in Word. Select some words and press Ctrl+Alt+M (or
        use the toolbar). They’re only for you and never appear in an export.
      </p>
      {!comments.length && <p className="muted">No comments in this scene.</p>}
      <ul className="sugg-list">
        {comments.map((c) => (
          <li key={c.id} className="sugg comment-item">
            <button className="sugg-main" onClick={() => go(c)} title="Show it in the scene">
              <span className="muted small block comment-quote">
                “{c.quote.length > 80 ? `${c.quote.slice(0, 77)}…` : c.quote}”
              </span>
              <CommentBody c={c} />
            </button>
            <div className="row gap">
              <button
                className="small"
                onClick={() => setEditing({ mode: 'edit', id: c.id, text: c.text, quote: c.quote })}
              >
                Edit
              </button>
              <button className="small" onClick={() => editor.chain().focus().removeComment(c.id).run()}>
                Resolve
              </button>
            </div>
          </li>
        ))}
      </ul>
      {editing && <CommentDialog editor={editor} target={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** How many comments the open scene has, for the side panel tab. */
export function CommentCount() {
  const { editor } = useEditorCtx();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const f = () => setN(listComments(editor.state.doc).length);
    f();
    editor.on('transaction', f);
    return () => {
      editor.off('transaction', f);
    };
  }, [editor]);
  return n > 0 ? <span className="tab-count">{n}</span> : null;
}
