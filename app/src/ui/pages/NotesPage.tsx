import { useMemo, useState } from 'react';
import { useProjectTable, useReferences } from '../data';
import { navigate } from '../router';
import { archiveRecord, createRecord, unarchiveRecord, updateRecord } from '../../storage/repo';
import type { Note } from '../../domain/schema';
import { CommitInput, EmptyState, TagInput } from '../components/common';
import { ReferencePicker } from '../components/ReferencePicker';
import { toast } from '../store';
import { REFERENCE_TYPE_ICONS } from '../../domain/referenceTemplates';

export function NotesPage({ projectId, selectedId }: { projectId: string; selectedId: string | null }) {
  const notes = useProjectTable('notes', projectId);
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const tags = useMemo(() => [...new Set(notes.flatMap((n) => n.tags))].sort(), [notes]);
  const list = notes
    .filter((n) => (showArchived ? !!n.archivedAt : !n.archivedAt))
    .filter((n) => !tag || n.tags.includes(tag))
    .filter((n) => !q || `${n.title}\n${n.body}\n${n.url}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const selected = notes.find((n) => n.id === selectedId) ?? null;

  return (
    <div className={`split-page${selected ? ' has-detail' : ''}`}>
      <aside className="list-pane" aria-label="Notes">
        <div className="list-tools">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes…" aria-label="Search notes" />
          <div className="row gap wrap">
            {tags.length > 0 && (
              <select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag">
                <option value="">Any tag</option>
                {tags.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            )}
            <label className="check">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Trash
            </label>
            <button
              className="primary"
              onClick={async () => {
                const n = await createRecord('notes', projectId, { title: 'Untitled note', body: '', url: '', tags: [], referenceIds: [] });
                navigate(projectId, 'notes', n.id);
              }}
            >
              + Note
            </button>
          </div>
        </div>
        <ul className="item-list">
          {list.map((n) => (
            <li key={n.id}>
              <a href={`#/p/${projectId}/notes/${n.id}`} className={n.id === selectedId ? 'on' : ''}>
                <span className="grow">
                  {n.title}
                  <span className="muted small block">{n.body.slice(0, 80)}</span>
                </span>
              </a>
            </li>
          ))}
          {!list.length && <li className="muted pad">No notes.</li>}
        </ul>
      </aside>
      <section className="detail-pane">
        {selected ? (
          <NoteEditor key={selected.id} n={selected} />
        ) : (
          <EmptyState title="Research & notes">
            <p>Keep research, links, citations and loose ideas here. Link notes to characters and places so they show up in backlinks.</p>
            {notes.some((n) => !n.archivedAt) && <p className="muted">Choose a note on the left to open it.</p>}
          </EmptyState>
        )}
      </section>
    </div>
  );
}

function NoteEditor({ n }: { n: Note }) {
  const refs = useReferences(n.projectId);
  const [picker, setPicker] = useState(false);
  const upd = (patch: Partial<Note>) => void updateRecord('notes', n.id, patch);
  const safeUrl = /^https?:\/\//i.test(n.url) ? n.url : null;
  return (
    <article className="note-editor">
      <CommitInput className="title-input" label="Title" value={n.title} onCommit={(v) => upd({ title: v })} />
      <div className="row gap">
        <CommitInput className="grow" label="Source link (optional)" value={n.url} placeholder="https://…" onCommit={(v) => upd({ url: v.trim() })} />
        {safeUrl && (
          <a className="button" href={safeUrl} target="_blank" rel="noopener noreferrer">
            Open ↗
          </a>
        )}
      </div>
      <CommitInput label="Note" multiline rows={16} value={n.body} onCommit={(v) => upd({ body: v })} />
      <TagInput value={n.tags} onChange={(tags) => upd({ tags })} />
      <div className="field">
        <span>Linked references</span>
        <div className="chips">
          {n.referenceIds.map((id) => {
            const r = refs.find((x) => x.id === id);
            return (
              <span key={id} className="chip">
                <a href={`#/p/${n.projectId}/refs/${id}`}>{r ? `${REFERENCE_TYPE_ICONS[r.type]} ${r.name}` : '(missing)'}</a>
                <button className="chip-x" aria-label="Remove link" onClick={() => upd({ referenceIds: n.referenceIds.filter((x) => x !== id) })}>
                  ✕
                </button>
              </span>
            );
          })}
          <button className="small" onClick={() => setPicker(true)}>
            + Link
          </button>
        </div>
      </div>
      {n.archivedAt ? (
        <button onClick={() => void unarchiveRecord('notes', n.id)}>Restore</button>
      ) : (
        <button
          className="danger-text"
          onClick={async () => {
            await archiveRecord('notes', n.id);
            navigate(n.projectId, 'notes');
            toast('Note moved to Trash', { action: { label: 'Undo', run: () => void unarchiveRecord('notes', n.id) } });
          }}
        >
          Move to Trash
        </button>
      )}
      {picker && (
        <ReferencePicker
          projectId={n.projectId}
          onClose={() => setPicker(false)}
          onPick={(r) => {
            setPicker(false);
            if (!n.referenceIds.includes(r.id)) upd({ referenceIds: [...n.referenceIds, r.id] });
          }}
        />
      )}
    </article>
  );
}
