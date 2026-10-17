import { useEffect, useMemo, useState } from 'react';
import { REFERENCE_TYPES, type ReferenceType } from '../../domain/schema';
import { countWords } from '../../domain/text';
import { REFERENCE_TYPE_LABELS } from '../../domain/referenceTemplates';
import { combineIntoSeries, loadSeriesBooks, seriesAppearances, type SeriesBook } from '../../storage/series';
import { flushAllEdits } from '../../editor/EditorContext';
import { useBooks, useProjects, useReferences } from '../data';
import { navigate } from '../router';
import { confirmDialog, reportError, toast } from '../store';

/**
 * The series: its books, and where each shared character, place and world entry appears across them. One set of
 * entries serves every book, so the checks, the AI Editor and continuity treat them as the same people and places.
 */
export function SeriesPage({ projectId }: { projectId: string }) {
  const books = useBooks(projectId);
  const refs = useReferences(projectId);
  const projects = useProjects();
  const [data, setData] = useState<SeriesBook[] | null>(null);
  const [type, setType] = useState<ReferenceType | ''>('character');
  const [onlyGaps, setOnlyGaps] = useState(false);
  const bookKey = books.map((b) => `${b.id}:${b.updatedAt}`).join(',');

  useEffect(() => {
    let alive = true;
    void flushAllEdits()
      .then(() => loadSeriesBooks(projectId))
      .then((d) => alive && setData(d))
      .catch((e) => reportError(e, 'Could not read the series'));
    return () => {
      alive = false;
    };
  }, [projectId, bookKey]);

  const live = useMemo(() => refs.filter((r) => !r.archivedAt), [refs]);
  const rows = useMemo(() => {
    if (!data) return [];
    const byId = new Map(live.map((r) => [r.id, r]));
    return seriesAppearances(data, live.filter((r) => !type || r.type === type))
      .map((a) => ({ ...a, ref: byId.get(a.referenceId)! }))
      .filter((a) => !onlyGaps || (a.perBook.some((n) => n > 0) && a.perBook.some((n) => n === 0)))
      .sort((a, b) => (a.first?.book ?? 99) - (b.first?.book ?? 99) || b.perBook.reduce((x, y) => x + y, 0) - a.perBook.reduce((x, y) => x + y, 0));
  }, [data, live, type, onlyGaps]);
  // Bars compare entries with each other (the busiest is full width), so even one book shows who matters most.
  const most = Math.max(1, ...rows.flatMap((r) => r.perBook));

  const others = (projects ?? []).filter((p) => p.id !== projectId);
  const [bringIn, setBringIn] = useState('');
  const [busy, setBusy] = useState(false);
  const combine = async () => {
    const other = others.find((p) => p.id === bringIn);
    if (!other) return;
    const ok = await confirmDialog(
      `Bring “${other.name}” into this series?`,
      `Its books become books of this series. Characters, places and other entries with the same name as one here are merged into that entry (empty details filled in, nothing overwritten); the rest are added.\n\nThe original “${other.name}” project is then hidden, not deleted: it stays in your data and backups.`,
      { confirmLabel: 'Bring it in' },
    );
    if (!ok) return;
    setBusy(true);
    try {
      await flushAllEdits();
      const r = await combineIntoSeries(projectId, other.id);
      setBringIn('');
      toast(`Added ${r.books} book${r.books === 1 ? '' : 's'}. ${r.merged} entr${r.merged === 1 ? 'y was' : 'ies were'} merged with ones here, ${r.added} added.`);
    } catch (e) {
      reportError(e, 'Could not bring the project in');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page series-page">
      <h1>Series</h1>
      <p className="muted small">
        Every book here shares one set of characters, places and world notes, so the checks, the AI Editor and continuity know they’re the same people
        and places in every book. Continuity checks across books too (give a death as “deceased, Book 2 Ch. 14”).
      </p>

      <section className="card">
        <h2>Books</h2>
        <ol className="series-books">
          {(data ?? []).map((b) => (
            <li key={b.bookId}>
              <button className="link-btn" onClick={() => b.scenes[0] && navigate(projectId, 'write', b.scenes[0].sceneId)}>
                {b.title || 'Untitled'}
              </button>{' '}
              <span className="muted small">{b.scenes.reduce((n, s) => n + countWords(s.text), 0).toLocaleString()} words</span>
            </li>
          ))}
        </ol>
        <p className="small muted">Add a new book from the book menu above the chapter list on the Write page (+ New book…).</p>
        {others.length > 0 && (
          <div className="row gap wrap">
            <select value={bringIn} onChange={(e) => setBringIn(e.target.value)} aria-label="Project to bring in">
              <option value="">Bring in another project…</option>
              {others.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button onClick={() => void combine()} disabled={!bringIn || busy}>
              {busy ? 'Bringing it in…' : 'Bring into this series'}
            </button>
          </div>
        )}
      </section>

      <section className="card">
        <div className="row gap wrap">
          <h2 className="grow">Who and what appears where</h2>
          <select value={type} onChange={(e) => setType(e.target.value as ReferenceType | '')} aria-label="Kind of entry">
            <option value="">Every entry</option>
            {REFERENCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {REFERENCE_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <label className="small">
            <input type="checkbox" checked={onlyGaps} onChange={(e) => setOnlyGaps(e.target.checked)} /> Missing from a book
          </label>
        </div>
        {!data ? (
          <p className="muted">Reading the books…</p>
        ) : !rows.length ? (
          <p className="muted small">Nothing to show.</p>
        ) : (
          <div className="table-scroll">
            <table className="series-table">
              <thead>
                <tr>
                  <th>Entry</th>
                  {data.map((b, i) => (
                    <th key={b.bookId} title={b.title}>
                      Book {i + 1}
                    </th>
                  ))}
                  <th>First appears</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  return (
                    <tr key={a.referenceId}>
                      <td>
                        <button className="link-btn" onClick={() => navigate(projectId, 'refs', a.referenceId)}>
                          {a.ref.name}
                        </button>
                      </td>
                      {a.perBook.map((n, i) => (
                        <td key={i} className={n ? 'num' : 'num muted'} title={`${n} mention${n === 1 ? '' : 's'} in ${data[i].title}`}>
                          <span className="series-bar" style={{ width: `${(100 * n) / most}%` }} />
                          <span className="series-n">{n || '–'}</span>
                        </td>
                      ))}
                      <td className="small">
                        {a.first ? (
                          <button className="link-btn" onClick={() => navigate(projectId, 'write', a.first!.sceneId, { find: a.ref.name.split(/\s+/)[0] })}>
                            Book {a.first.book + 1}, {a.first.chapterTitle}
                          </button>
                        ) : (
                          <span className="muted">Not yet</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
