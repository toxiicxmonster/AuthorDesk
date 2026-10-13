import { cleanAnswer, splitOptions } from '../../ai/aiEditor';
import { pickBest, type AiTask } from '../../ai/prompts';
import { wordDiff } from '../../ai/diff';
import { toast } from '../store';

/** One AI Editor answer, as shown in a side panel. Suggestions only: the author copies what they want. */
export interface AiResult {
  id: number;
  task: AiTask;
  /** Short note shown next to the task name (focus word, tone, character…). */
  extra: string;
  /** The text the suggestion rewrites, for highlighting what changed. */
  original: string;
  text: string;
  done: boolean;
  error: string | null;
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied. Paste it into your scene wherever you like.');
  } catch {
    toast('Couldn’t copy automatically. Select the text and press Ctrl+C.');
  }
}

export function AiResultCard({ r, busy, onStop, onAgain }: { r: AiResult; busy: boolean; onStop: () => void; onAgain: () => void }) {
  const options = r.task.id === 'ask' ? [r.text.trim()] : r.done && r.task.versions > 1 ? pickBest(r.task, splitOptions(r.text), r.original) : [cleanAnswer(r.text)];
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
      {options.filter(Boolean).map((text, k) => (
        <div key={k} className="ai-option">
          <p>
            {r.task.id === 'ask' || !r.done
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
          {r.done && (
            <button className="small" onClick={() => void copyText(text)}>
              Copy
            </button>
          )}
        </div>
      ))}
    </article>
  );
}
