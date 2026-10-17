import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useBooks, useProjectTable, useReferences } from '../data';
import { navigate } from '../router';
import { createRecord, archiveRecord, unarchiveRecord, updateRecord } from '../../storage/repo';
import { db } from '../../storage/db';
import type { TimelineEvent } from '../../domain/schema';
import { chronological, continuityFlags } from '../../domain/continuity';
import { CommitInput, EmptyState, Modal } from '../components/common';
import { toast } from '../store';

export function TimelinePage({ projectId, selectedId }: { projectId: string; selectedId: string | null }) {
  const events = useProjectTable('timelineEvents', projectId);
  const refs = useReferences(projectId);
  const books = useBooks(projectId);
  const [mode, setMode] = useState<'chrono' | 'chapter'>('chrono');
  const [bookFilter, setBookFilter] = useState('');
  const [charFilter, setCharFilter] = useState('');
  const data = useLiveQuery(async () => {
    const [chapters, scenes] = await Promise.all([db.chapters.where('projectId').equals(projectId).toArray(), db.scenes.where('projectId').equals(projectId).toArray()]);
    return { chapters: chapters.filter((c) => !c.archivedAt), scenes: scenes.filter((s) => !s.archivedAt) };
  }, [projectId]);
  const live = events.filter((e) => !e.archivedAt && (!bookFilter || e.bookId === bookFilter || e.bookId === null) && (!charFilter || e.characterIds.includes(charFilter)));
  const flags = useMemo(() => (data ? continuityFlags(events, data.scenes) : []), [events, data]);
  const refName = (id: string | null) => refs.find((r) => r.id === id)?.name ?? '?';

  const chapterOrder = useMemo(() => {
    if (!data) return new Map<string, number>();
    const bookIdx = new Map(books.map((b, i) => [b.id, i]));
    const sorted = data.chapters.slice().sort((a, b) => (bookIdx.get(a.bookId) ?? 0) - (bookIdx.get(b.bookId) ?? 0) || a.order - b.order);
    return new Map(sorted.map((c, i) => [c.id, i]));
  }, [data, books]);

  const ordered =
    mode === 'chrono'
      ? chronological(live)
      : live.slice().sort((a, b) => {
          const ca = a.chapterId ? (chapterOrder.get(a.chapterId) ?? 1e9) : 1e9;
          const cb = b.chapterId ? (chapterOrder.get(b.chapterId) ?? 1e9) : 1e9;
          return ca - cb || (a.sortKey ?? 0) - (b.sortKey ?? 0);
        });

  const selected = events.find((e) => e.id === selectedId) ?? null;

  const add = async () => {
    const maxKey = Math.max(0, ...events.map((e) => e.sortKey ?? 0));
    const e = await createRecord('timelineEvents', projectId, {
      bookId: bookFilter || null,
      title: 'New event',
      when: '',
      sortKey: maxKey + 10,
      description: '',
      characterIds: charFilter ? [charFilter] : [],
      locationId: null,
      chapterId: null,
      sceneId: null,
      plotThreadIds: [],
    });
    navigate(projectId, 'timeline', e.id);
  };

  return (
    <div className="page timeline-page">
      <div className="row gap wrap">
        <h1>Timeline</h1>
        <div className="seg">
          <button className={mode === 'chrono' ? 'on' : ''} aria-pressed={mode === 'chrono'} onClick={() => setMode('chrono')}>
            In-world order
          </button>
          <button className={mode === 'chapter' ? 'on' : ''} aria-pressed={mode === 'chapter'} onClick={() => setMode('chapter')}>
            Chapter order
          </button>
        </div>
        {books.length > 1 && (
          <select value={bookFilter} onChange={(e) => setBookFilter(e.target.value)} aria-label="Book / timeline">
            <option value="">All books</option>
            {books.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
        )}
        <select value={charFilter} onChange={(e) => setCharFilter(e.target.value)} aria-label="Character">
          <option value="">All characters</option>
          {refs.filter((r) => r.type === 'character' && !r.archivedAt).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button className="primary" onClick={add}>
          + Event
        </button>
      </div>
      {flags.length > 0 && (
        <details className="banner info">
          <summary>{flags.length} possible continuity question{flags.length === 1 ? '' : 's'} to review</summary>
          <ul>
            {flags.map((f, i) => (
              <li key={i}>
                <strong>{refName(f.characterId)}</strong> {f.message} ({f.when.startsWith('#') ? `order ${f.when.slice(1)}` : `“${f.when}”`}): {f.locations.map(refName).join(' and ')}. This may be intentional.
              </li>
            ))}
          </ul>
        </details>
      )}
      {ordered.length === 0 ? (
        <EmptyState title="No events yet">
          <p>Add events with an in-world date or a relative marker like “three days before the siege”. Give them an order number to sort them; leave it blank if unknown.</p>
        </EmptyState>
      ) : (
        <ol className="timeline">
          {ordered.map((e) => (
            <li key={e.id} className={e.id === selectedId ? 'on' : ''}>
              <div className="tl-when">{e.when || (e.sortKey === null ? 'Undated' : '')}</div>
              <button className="tl-body" onClick={() => navigate(projectId, 'timeline', e.id)}>
                <strong>{e.title}</strong>
                {e.description && <p>{e.description.slice(0, 200)}</p>}
                <div className="chips">
                  {e.characterIds.map((c) => (
                    <span key={c} className="chip">👤︎ {refName(c)}</span>
                  ))}
                  {e.locationId && <span className="chip">📍 {refName(e.locationId)}</span>}
                  {e.chapterId && <span className="chip">📖 {data?.chapters.find((c) => c.id === e.chapterId)?.title}</span>}
                </div>
              </button>
            </li>
          ))}
        </ol>
      )}
      {selected && <EventEditor key={selected.id} e={selected} onClose={() => navigate(projectId, 'timeline')} />}
    </div>
  );
}

function EventEditor({ e, onClose }: { e: TimelineEvent; onClose: () => void }) {
  const refs = useReferences(e.projectId);
  const books = useBooks(e.projectId);
  const threads = useProjectTable('plotThreads', e.projectId).filter((t) => !t.archivedAt);
  const data = useLiveQuery(async () => {
    const chapters = (await db.chapters.where('projectId').equals(e.projectId).toArray()).filter((c) => !c.archivedAt).sort((a, b) => a.order - b.order);
    const scenes = e.chapterId ? (await db.scenes.where('chapterId').equals(e.chapterId).toArray()).filter((s) => !s.archivedAt).sort((a, b) => a.order - b.order) : [];
    return { chapters, scenes };
  }, [e.projectId, e.chapterId]);
  const upd = (patch: Partial<TimelineEvent>) => void updateRecord('timelineEvents', e.id, patch);
  const characters = refs.filter((r) => r.type === 'character' && !r.archivedAt);
  return (
    <Modal title="Timeline event" onClose={onClose} wide>
      <CommitInput className="title-input" label="Title" value={e.title} onCommit={(v) => upd({ title: v })} />
      <div className="row gap wrap">
        <CommitInput label="When (date or relative marker)" value={e.when} placeholder="Spring 1203, or ‘three days before the siege’" onCommit={(v) => upd({ when: v })} />
        <CommitInput
          label="Order number (blank = unknown)"
          value={e.sortKey === null ? '' : String(e.sortKey)}
          onCommit={(v) => upd({ sortKey: v.trim() === '' || isNaN(Number(v)) ? null : Number(v) })}
        />
        {books.length > 1 && (
          <label className="field inline">
            <span>Book</span>
            <select value={e.bookId ?? ''} onChange={(ev) => upd({ bookId: ev.target.value || null })}>
              <option value="">Whole series</option>
              {books.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <CommitInput label="What happens" multiline rows={4} value={e.description} onCommit={(v) => upd({ description: v })} />
      <fieldset className="field">
        <legend>Characters</legend>
        <div className="check-grid">
          {characters.map((c) => (
            <label key={c.id} className="check">
              <input
                type="checkbox"
                checked={e.characterIds.includes(c.id)}
                onChange={(ev) => upd({ characterIds: ev.target.checked ? [...e.characterIds, c.id] : e.characterIds.filter((x) => x !== c.id) })}
              />{' '}
              {c.name}
            </label>
          ))}
          {!characters.length && <span className="muted small">Add characters in References.</span>}
        </div>
      </fieldset>
      <div className="row gap wrap">
        <label className="field inline">
          <span>Location</span>
          <select value={e.locationId ?? ''} onChange={(ev) => upd({ locationId: ev.target.value || null })}>
            <option value="">—</option>
            {refs.filter((r) => r.type === 'location' && !r.archivedAt).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field inline">
          <span>Chapter</span>
          <select value={e.chapterId ?? ''} onChange={(ev) => upd({ chapterId: ev.target.value || null, sceneId: null })}>
            <option value="">—</option>
            {data?.chapters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        {e.chapterId && (
          <label className="field inline">
            <span>Scene</span>
            <select value={e.sceneId ?? ''} onChange={(ev) => upd({ sceneId: ev.target.value || null })}>
              <option value="">—</option>
              {data?.scenes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <fieldset className="field">
        <legend>Plot threads</legend>
        {threads.map((t) => (
          <label key={t.id} className="check">
            <input
              type="checkbox"
              checked={e.plotThreadIds.includes(t.id)}
              onChange={(ev) => upd({ plotThreadIds: ev.target.checked ? [...e.plotThreadIds, t.id] : e.plotThreadIds.filter((x) => x !== t.id) })}
            />{' '}
            {t.name}
          </label>
        ))}
        {!threads.length && <span className="muted small">No plot threads yet.</span>}
      </fieldset>
      <div className="dialog-actions">
        {e.sceneId && <a className="button" href={`#/p/${e.projectId}/write/${e.sceneId}`}>Open scene</a>}
        <button
          className="danger-text"
          onClick={async () => {
            await archiveRecord('timelineEvents', e.id);
            onClose();
            toast('Event moved to Trash', { action: { label: 'Undo', run: () => void unarchiveRecord('timelineEvents', e.id) } });
          }}
        >
          Move to Trash
        </button>
        <button className="primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}
