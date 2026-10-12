import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useBooks, useProjectTable, useReferences } from '../data';
import { navigate } from '../router';
import { archiveRecord, createRecord, unarchiveRecord, updateRecord } from '../../storage/repo';
import { db } from '../../storage/db';
import type { PlotThread } from '../../domain/schema';
import { threadAppearances } from '../../domain/continuity';
import { useSettings, updateSettings } from '../../storage/settings';
import { CommitInput, EmptyState } from '../components/common';
import { promptDialog, toast } from '../store';

export function ThreadsPage({ projectId, selectedId }: { projectId: string; selectedId: string | null }) {
  const threadsAll = useProjectTable('plotThreads', projectId);
  const threads = threadsAll.filter((t) => !t.archivedAt);
  const books = useBooks(projectId);
  const [bookId, setBookId] = useState<string | null>(null);
  const book = books.find((b) => b.id === bookId) ?? books[0];
  const settings = useSettings();
  const data = useLiveQuery(async () => {
    if (!book) return null;
    const chapters = (await db.chapters.where('bookId').equals(book.id).toArray()).filter((c) => !c.archivedAt).sort((a, b) => a.order - b.order);
    const scenes = await db.scenes.where('chapterId').anyOf(chapters.map((c) => c.id)).toArray();
    const cards = (await db.boardCards.where('bookId').equals(book.id).toArray()).filter((c) => !c.archivedAt);
    return { chapters, scenes, cards };
  }, [book?.id]);
  const appearances = useMemo(
    () => (data ? threadAppearances(threads, data.chapters, data.scenes, data.cards, settings.staleThreadChapters) : []),
    [threads, data, settings.staleThreadChapters],
  );
  const selected = threadsAll.find((t) => t.id === selectedId) ?? null;

  const add = async () => {
    const name = await promptDialog('New plot thread', 'Name', '', 'Create');
    if (!name) return;
    const t = await createRecord('plotThreads', projectId, { name, description: '', stakes: '', keyCharacterIds: [], status: 'open', resolution: '' });
    navigate(projectId, 'threads', t.id);
  };

  return (
    <div className="page threads-page">
      <div className="row gap wrap">
        <h1>Plot threads</h1>
        {books.length > 1 && (
          <select value={book?.id} onChange={(e) => setBookId(e.target.value)} aria-label="Book">
            {books.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
        )}
        <button className="primary" onClick={add}>
          + Plot thread
        </button>
        <label className="field inline small">
          <span>Flag after</span>
          <input
            type="number"
            min={1}
            max={50}
            value={settings.staleThreadChapters}
            onChange={(e) => void updateSettings({ staleThreadChapters: Math.max(1, parseInt(e.target.value, 10) || 5) })}
            style={{ width: '4em' }}
          />
          <span>quiet chapters</span>
        </label>
      </div>
      {threads.length === 0 ? (
        <EmptyState title="No plot threads yet">
          <p>Create subplots and tag scenes with them (in the Scene panel while writing, or on board cards) to follow each one across the book.</p>
        </EmptyState>
      ) : (
        data && (
          <div className="thread-grid-wrap">
            <table className="thread-grid">
              <thead>
                <tr>
                  <th scope="col">Thread</th>
                  {data.chapters.map((c, i) => (
                    <th key={c.id} scope="col" title={c.title}>
                      <a href={`#/p/${projectId}/write/${data.scenes.filter((s) => s.chapterId === c.id && !s.archivedAt).sort((a, b) => a.order - b.order)[0]?.id ?? ''}`}>{i + 1}</a>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {threads.map((t) => {
                  const a = appearances.find((x) => x.threadId === t.id);
                  return (
                    <tr key={t.id} className={t.id === selectedId ? 'on' : ''}>
                      <th scope="row">
                        <a href={`#/p/${projectId}/threads/${t.id}`}>{t.name}</a>
                        <span className={`pill st-${t.status}`}>{t.status}</span>
                        {a?.stale && (
                          <span className="pill warn" title="Not a judgement — just a reminder to check in on it.">
                            quiet for {a.gap} chapters
                          </span>
                        )}
                      </th>
                      {data.chapters.map((c, i) => (
                        <td key={c.id} className={a?.chapters.includes(i) ? 'hit' : ''} aria-label={a?.chapters.includes(i) ? `Appears in ${c.title}` : undefined}>
                          {a?.chapters.includes(i) ? '●' : ''}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
      {selected ? <ThreadEditor key={selected.id} t={selected} data={data} /> : threads.length > 0 && <p className="muted small">Click a thread’s name to see its details and scenes. Tag scenes with threads in the Scene notes panel while writing.</p>}
    </div>
  );
}

function ThreadEditor({ t, data }: { t: PlotThread; data: { chapters: { id: string; title: string }[]; scenes: { id: string; title: string; chapterId: string; plotThreadIds: string[]; summary: string; archivedAt: string | null }[] } | null | undefined }) {
  const refs = useReferences(t.projectId);
  const upd = (patch: Partial<PlotThread>) => void updateRecord('plotThreads', t.id, patch);
  const scenes = (data?.scenes ?? []).filter((s) => !s.archivedAt && s.plotThreadIds.includes(t.id));
  const chIndex = new Map((data?.chapters ?? []).map((c, i) => [c.id, i]));
  scenes.sort((a, b) => (chIndex.get(a.chapterId) ?? 0) - (chIndex.get(b.chapterId) ?? 0));
  return (
    <section className="thread-editor card">
      <div className="row gap">
        <CommitInput className="title-input grow" label="Name" value={t.name} onCommit={(v) => upd({ name: v })} />
        <label className="field inline">
          <span>Status</span>
          <select value={t.status} onChange={(e) => upd({ status: e.target.value as PlotThread['status'] })}>
            <option value="open">Open</option>
            <option value="paused">Paused</option>
            <option value="resolved">Resolved</option>
          </select>
        </label>
      </div>
      <CommitInput label="Description" multiline value={t.description} onCommit={(v) => upd({ description: v })} />
      <CommitInput label="Stakes" multiline rows={2} value={t.stakes} onCommit={(v) => upd({ stakes: v })} />
      <fieldset className="field">
        <legend>Key characters</legend>
        <div className="check-grid">
          {refs.filter((r) => r.type === 'character' && !r.archivedAt).map((c) => (
            <label key={c.id} className="check">
              <input
                type="checkbox"
                checked={t.keyCharacterIds.includes(c.id)}
                onChange={(e) => upd({ keyCharacterIds: e.target.checked ? [...t.keyCharacterIds, c.id] : t.keyCharacterIds.filter((x) => x !== c.id) })}
              />{' '}
              {c.name}
            </label>
          ))}
        </div>
      </fieldset>
      <CommitInput label="Resolution notes" multiline rows={2} value={t.resolution} onCommit={(v) => upd({ resolution: v })} />
      <h3>Scenes in this thread</h3>
      <ol>
        {scenes.map((s) => (
          <li key={s.id}>
            <a href={`#/p/${t.projectId}/write/${s.id}`}>
              {data?.chapters.find((c) => c.id === s.chapterId)?.title} › {s.title}
            </a>
            {s.summary && <span className="muted small"> — {s.summary.slice(0, 120)}</span>}
          </li>
        ))}
        {!scenes.length && <li className="muted">No scenes tagged yet.</li>}
      </ol>
      <button
        className="danger-text"
        onClick={async () => {
          await archiveRecord('plotThreads', t.id);
          navigate(t.projectId, 'threads');
          toast('Plot thread moved to Trash', { action: { label: 'Undo', run: () => void unarchiveRecord('plotThreads', t.id) } });
        }}
      >
        Move to Trash
      </button>
    </section>
  );
}
