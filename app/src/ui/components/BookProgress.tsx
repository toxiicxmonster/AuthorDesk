import { useMemo, useState } from 'react';
import type { Book, Chapter } from '../../domain/schema';
import { calendarWeeks, DEFAULT_PAGE_SIZE, estimatePages, evenChapterTarget, PAGE_SIZES, projectFinish, writingStreak } from '../../domain/targets';
import { updateRecord } from '../../storage/repo';
import type { ManuscriptTree } from '../data';
import { href } from '../router';
import { confirmDialog, reportError, toast } from '../store';
import { CommitInput } from './common';

const SIZE_KEY = 'authordesk.pageEstimateSize';

function loadSize(): string {
  try {
    return localStorage.getItem(SIZE_KEY) ?? DEFAULT_PAGE_SIZE;
  } catch {
    return DEFAULT_PAGE_SIZE;
  }
}

/** "12,000" or "12000" or "12k" → 12000; blank → undefined (no target). */
export function parseTarget(v: string): number | undefined | null {
  const t = v.trim().toLowerCase().replace(/[,\s]/g, '');
  if (!t) return undefined;
  const m = /^(\d+(?:\.\d+)?)(k?)$/.exec(t);
  if (!m) return null;
  return Math.round(parseFloat(m[1]) * (m[2] ? 1000 : 1));
}

const pct = (n: number, of: number) => Math.min(100, Math.max(0, of ? (n / of) * 100 : 0));

/**
 * Home card: book and chapter word targets with progress, when the book will be finished at the current pace,
 * the writing streak, and how many printed pages the book and each chapter come to at a chosen size.
 */
export function BookProgress({ projectId, book, tree, wordlog }: { projectId: string; book: Book; tree: ManuscriptTree; wordlog: Record<string, number> }) {
  const [sizeId, setSizeId] = useState(loadSize);
  const chapters = tree.chapters;
  const words = useMemo(() => chapters.map((c) => (tree.scenesByChapter.get(c.id) ?? []).reduce((n, s) => n + s.wordCount, 0)), [chapters, tree]);
  const pages = useMemo(() => estimatePages(words, sizeId), [words, sizeId]);
  const target = book.targetWords ?? 0;
  const projection = target ? projectFinish(wordlog, tree.wordCount, target) : null;
  const streak = writingStreak(wordlog);
  const weeks = calendarWeeks(12);
  const most = Math.max(1, ...Object.values(wordlog));
  const size = PAGE_SIZES.find((s) => s.id === sizeId) ?? PAGE_SIZES.find((s) => s.id === DEFAULT_PAGE_SIZE)!;

  const chooseSize = (id: string) => {
    setSizeId(id);
    try {
      localStorage.setItem(SIZE_KEY, id);
    } catch {
      /* the choice just isn't remembered */
    }
  };
  const saveTarget = async (table: 'books' | 'chapters', id: string, v: string) => {
    const n = parseTarget(v);
    if (n === null) return toast('Type a number of words, like 80000 or 80k.', { kind: 'error' });
    try {
      await updateRecord(table, id, { targetWords: n } as Partial<Book & Chapter>);
    } catch (e) {
      reportError(e, 'Could not save the target');
    }
  };
  const splitEvenly = async () => {
    const each = evenChapterTarget(target, chapters.length);
    if (chapters.some((c) => c.targetWords)) {
      const ok = await confirmDialog('Replace the chapter targets?', `Every chapter gets a target of ${each.toLocaleString()} words, replacing the targets you set.`, { confirmLabel: 'Replace' });
      if (!ok) return;
    }
    try {
      for (const c of chapters) if (c.targetWords !== each) await updateRecord('chapters', c.id, { targetWords: each } as Partial<Chapter>);
      toast(`Each chapter's target is now ${each.toLocaleString()} words.`);
    } catch (e) {
      reportError(e, 'Could not set the chapter targets');
    }
  };

  const finishText = () => {
    if (!projection) return null;
    if (projection.remaining === 0) return 'You’ve reached your target. 🎉';
    if (!projection.finishBy) return `${projection.remaining.toLocaleString()} words to go. Write on a few days and you’ll see when you’re likely to finish.`;
    const date = projection.finishBy.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: projection.finishBy.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
    return `${projection.remaining.toLocaleString()} words to go. At your ${projection.days}-day average of ${projection.perDay.toLocaleString()} words a day, you’ll reach ${target.toLocaleString()} by ${date}.`;
  };

  return (
    <section className="card book-progress">
      <h2>Targets & length</h2>
      <div className="progress-head">
        <div>
          <CommitInput label="Book target (words)" value={target ? String(target) : ''} placeholder="e.g. 80000" onCommit={(v) => void saveTarget('books', book.id, v)} />
          {target > 0 && (
            <>
              <div className="progress" role="progressbar" aria-label="Book target" aria-valuenow={tree.wordCount} aria-valuemin={0} aria-valuemax={target}>
                <div style={{ width: `${pct(tree.wordCount, target)}%` }} />
              </div>
              <p className="small">
                {tree.wordCount.toLocaleString()} of {target.toLocaleString()} words ({Math.round(pct(tree.wordCount, target))}%). {finishText()}
              </p>
            </>
          )}
        </div>
        <div>
          <label className="field">
            <span>Page estimate for</span>
            <select value={size.id} onChange={(e) => chooseSize(e.target.value)}>
              {PAGE_SIZES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <div className="big-num">≈ {pages.total.toLocaleString()} pages</div>
          <p className="small muted">
            About {pages.wordsPerPage} words a page
            {size.trim ? `, ${size.fontSize} pt text, with title, copyright and contents pages and chapters opening on right-hand pages` : ''}. The paperback export
            gives the exact count.
          </p>
        </div>
      </div>

      {chapters.length > 0 && (
        <table className="chapter-targets">
          <thead>
            <tr>
              <th>Chapter</th>
              <th className="num">Words</th>
              <th>Target</th>
              <th className="num">Pages</th>
            </tr>
          </thead>
          <tbody>
            {chapters.map((c, i) => {
              const first = tree.scenesByChapter.get(c.id)?.[0];
              return (
                <tr key={c.id}>
                  <td>{first ? <a href={href(projectId, 'write', first.id)}>{c.title || `Chapter ${i + 1}`}</a> : c.title || `Chapter ${i + 1}`}</td>
                  <td className="num">{words[i].toLocaleString()}</td>
                  <td>
                    <div className="target-cell">
                      <CommitInput className="target-input" placeholder="—" value={c.targetWords ? String(c.targetWords) : ''} onCommit={(v) => void saveTarget('chapters', c.id, v)} />
                      {c.targetWords ? (
                        <div className="progress" role="progressbar" aria-label={`${c.title} target`} aria-valuenow={words[i]} aria-valuemin={0} aria-valuemax={c.targetWords} title={`${Math.round(pct(words[i], c.targetWords))}%`}>
                          <div style={{ width: `${pct(words[i], c.targetWords)}%` }} />
                        </div>
                      ) : null}
                    </div>
                  </td>
                  <td className="num">{pages.perChapter[i] || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {target > 0 && chapters.length > 1 && (
        <button className="small" onClick={() => void splitEvenly()}>
          Split the book target evenly ({evenChapterTarget(target, chapters.length).toLocaleString()} words a chapter)
        </button>
      )}

      <h3>
        Writing streak: {streak} day{streak === 1 ? '' : 's'}
      </h3>
      <div className="streak-cal" role="img" aria-label={`Words written per day, last 12 weeks. Current streak ${streak} days.`}>
        {weeks.map((w, i) => (
          <div key={i} className="streak-week">
            {w.map((k, j) => {
              const n = k ? (wordlog[k] ?? 0) : 0;
              return <span key={j} className={`streak-day${!k ? ' future' : n > 0 ? ' on' : ''}`} style={n > 0 ? { opacity: 0.3 + (0.7 * n) / most } : undefined} title={k ? `${k}: ${n.toLocaleString()} words` : undefined} />;
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
