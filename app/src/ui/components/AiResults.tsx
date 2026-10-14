import { useState } from 'react';
import type { Editor } from '@tiptap/core';
import { cleanAnswer, splitOptions } from '../../ai/aiEditor';
import { isAnswerTask, pickBest, type AiTask } from '../../ai/prompts';
import { wordDiff } from '../../ai/diff';
import { replaceAnchored, type TextAnchor } from '../../editor/aiApply';
import { toast } from '../store';

/** One AI Editor answer, as shown in a side panel. */
export interface AiResult {
  id: number;
  task: AiTask;
  /** Short note shown next to the task name (focus word, tone, character…). */
  extra: string;
  /** The text the suggestion rewrites, for highlighting what changed. */
  original: string;
  /** Where that text is in the scene, for "Use". */
  anchor: TextAnchor | null;
  /** The flagged word, for tasks that must avoid it ("Without the echo"). */
  focus?: string | null;
  text: string;
  done: boolean;
  error: string | null;
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied.');
  } catch {
    toast('Couldn’t copy automatically. Select the text and press Ctrl+C.');
  }
}

/** Puts a chosen version in place of the passage it was written for, with Undo. */
export function applyVersion(editor: Editor, anchor: TextAnchor, text: string): boolean {
  if (!replaceAnchored(editor, anchor, text)) {
    toast('That passage has changed since the suggestion was made, so it wasn’t replaced. Try again on the new text.');
    return false;
  }
  toast('Replaced.', { action: { label: 'Undo', run: () => editor.chain().focus().undo().run() } });
  return true;
}

export function AiResultCard({ r, busy, onStop, onAgain, editor }: { r: AiResult; busy: boolean; onStop: () => void; onAgain: () => void; editor: Editor | null }) {
  const [used, setUsed] = useState<number | null>(null);
  const answer = isAnswerTask(r.task.id);
  const options = answer ? [r.text.trim()] : r.done && r.task.versions > 1 ? pickBest(r.task, splitOptions(r.text), r.original, r.focus) : [cleanAnswer(r.text)];
  const canUse = !answer && !!r.anchor && !!editor;
  return (
    <article className="ai-card">
      <header className="small">
        <strong>{r.task.label}</strong>
        {r.extra && <span className="muted"> · {r.extra}</span>}
        <span className="grow" />
        {!r.done && busy ? (
          <button className="link-btn" onClick={onStop}>
            Stop
          </button>
        ) : (
          <button className="link-btn" onClick={onAgain} title="Ask again for different suggestions">
            Try again
          </button>
        )}
      </header>
      {r.error && <p className="small danger-text">{r.error}</p>}
      {!r.done && !r.text && <p className="small muted">Thinking…</p>}
      {r.done && !r.error && !answer && !options.filter(Boolean).length && (
        <p className="small muted">{r.task.id === 'no-repeat' && r.focus ? `Every version still used “${r.focus}”, so none are shown. Try again for new ones.` : 'No usable version this time. Try again.'}</p>
      )}
      {options.filter(Boolean).map((text, k) => (
        <div key={k} className="ai-option">
          <p>
            {answer || !r.done
              ? text
              : wordDiff(r.original, text).map((part, i) =>
                  part.changed ? (
                    <mark key={i} className="ai-changed">
                      {part.text}
                    </mark>
                  ) : (
                    <span key={i}>{part.text}</span>
                  ),
                )}
          </p>
          {r.done &&
            (canUse ? (
              <button
                className={`small${used === k ? '' : ' primary'}`}
                disabled={used !== null}
                onClick={() => {
                  if (applyVersion(editor!, r.anchor!, text)) setUsed(k);
                }}
                title="Put this version in place of the passage"
              >
                {used === k ? 'Used ✓' : 'Use'}
              </button>
            ) : (
              <button className="small" onClick={() => void copyText(text)}>
                Copy
              </button>
            ))}
        </div>
      ))}
    </article>
  );
}
