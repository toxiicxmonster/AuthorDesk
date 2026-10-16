import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useBooks, useManuscript, useProjectTable, useReferences } from '../data';
import { navigate } from '../router';
import { CARD_TYPES, WRITING_STATUSES, type BoardCard, type BoardLane, type Chapter } from '../../domain/schema';
import { BUILTIN_TEMPLATES, type BoardTemplate } from '../../domain/boardTemplates';
import { planItems } from '../../domain/planChecklist';
import {
  archiveRecord,
  convertCardToChapter,
  convertCardToScene,
  createCard,
  createRecord,
  moveCard,
  moveInList,
  reorder,
  unarchiveRecord,
  updateRecord,
} from '../../storage/repo';
import { db } from '../../storage/db';
import { newId } from '../../domain/ids';
import { CommitInput, Modal, StatusDot, StatusSelect, TagInput, EmptyState, InlineEdit } from '../components/common';
import { Menu } from '../components/Menu';
import { Icon } from '../components/Icon';
import { confirmDialog, promptDialog, reportError, toast } from '../store';
import { ReferencePicker } from '../components/ReferencePicker';
import { BeatMapDialog } from '../components/BeatMapDialog';
import { REFERENCE_TYPE_ICONS } from '../../domain/referenceTemplates';

interface Filters {
  q: string;
  character: string;
  thread: string;
  location: string;
  status: string;
  tag: string;
}

const NO_FILTERS: Filters = { q: '', character: '', thread: '', location: '', status: '', tag: '' };

export function BoardPage({ projectId, focusId }: { projectId: string; focusId: string | null }) {
  const books = useBooks(projectId);
  const [bookId, setBookId] = useState<string | null>(null);
  const [mode, setMode] = useState<'board' | 'outline'>('board');
  const book = books.find((b) => b.id === bookId) ?? books[0] ?? null;
  const lanesAll = useProjectTable('boardLanes', projectId);
  const cardsAll = useProjectTable('boardCards', projectId);
  const refs = useReferences(projectId);
  const threads = useProjectTable('plotThreads', projectId).filter((t) => !t.archivedAt);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [editing, setEditing] = useState<string | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<string | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [beatMapOpen, setBeatMapOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // Open a card from a link (e.g. search result or backlink).
  useEffect(() => {
    if (!focusId) return;
    const card = cardsAll.find((c) => c.id === focusId);
    if (card) {
      setBookId(card.bookId);
      setEditing(card.id);
    }
  }, [focusId, cardsAll]);

  const lanes = lanesAll.filter((l) => l.bookId === book?.id && !l.archivedAt).sort((a, b) => a.order - b.order);
  const cards = cardsAll.filter((c) => c.bookId === book?.id);
  const tags = useMemo(() => [...new Set(cards.flatMap((c) => c.tags))].sort(), [cards]);
  // Beat cards in story order (lane by lane), for mapping the draft to them.
  const beatCards = lanes.flatMap((l) => cards.filter((c) => c.laneId === l.id && c.type === 'beat' && !c.archivedAt).sort((a, b) => a.order - b.order));
  const characters = refs.filter((r) => r.type === 'character' && !r.archivedAt);
  const locations = refs.filter((r) => r.type === 'location' && !r.archivedAt);

  const matches = (c: BoardCard) => {
    const f = filters;
    if (f.q && !`${c.title}\n${c.summary}\n${c.notes}`.toLowerCase().includes(f.q.toLowerCase())) return false;
    if (f.character && c.povCharacterId !== f.character && !c.referenceIds.includes(f.character)) return false;
    if (f.thread && !c.plotThreadIds.includes(f.thread)) return false;
    if (f.location && c.locationId !== f.location) return false;
    if (f.status && c.status !== f.status) return false;
    if (f.tag && !c.tags.includes(f.tag)) return false;
    return true;
  };
  const filtering = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
  const activeFilters = Object.entries(filters).filter(([k, v]) => k !== 'q' && v).length;

  const applyTemplate = async (t: BoardTemplate) => {
    if (!book) return;
    const start = lanes.length;
    for (let i = 0; i < t.lanes.length; i++) {
      const lane = await createRecord('boardLanes', projectId, { bookId: book.id, title: t.lanes[i].title, order: start + i });
      for (const c of t.lanes[i].cards) await createCard(projectId, book.id, lane.id, { title: c.title, summary: c.summary ?? '', type: c.type ?? 'beat' });
    }
    setTemplateOpen(false);
    toast(`Added “${t.name}”. Rename, move or remove anything you don’t need.`);
  };

  const onDrop = async (laneId: string, index: number) => {
    if (!drag) return;
    try {
      await moveCard(drag, laneId, index);
    } catch (e) {
      reportError(e, 'Move failed');
    }
    setDrag(null);
    setDropAt(null);
  };

  const editingCard = cardsAll.find((c) => c.id === editing) ?? null;

  if (!book) return <EmptyState title="No book yet" />;

  return (
    <div className="page board-page">
      <div className="board-head">
        <div className="row gap wrap">
          <h1>Story board</h1>
          {books.length > 1 && (
            <select value={book.id} onChange={(e) => setBookId(e.target.value)} aria-label="Book">
              {books.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
          )}
          <div className="seg" role="tablist">
            <button role="tab" aria-selected={mode === 'board'} className={mode === 'board' ? 'on' : ''} onClick={() => setMode('board')}>
              Board
            </button>
            <button role="tab" aria-selected={mode === 'outline'} className={mode === 'outline' ? 'on' : ''} onClick={() => setMode('outline')}>
              Outline
            </button>
          </div>
        </div>
        {mode === 'board' && (
          <div className="filters row gap wrap" aria-label="Filter cards">
            <input type="search" placeholder="Search cards…" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} aria-label="Search cards" />
            <button className={activeFilters ? 'on-filter' : ''} aria-expanded={showFilters} onClick={() => setShowFilters((v) => !v)}>
              <Icon name="filter" size={16} /> Filter{activeFilters ? ` (${activeFilters})` : ''}
            </button>
            {filtering && <button onClick={() => setFilters(NO_FILTERS)}>Clear</button>}
            <button onClick={() => setTemplateOpen(true)}>Use a story structure…</button>
            {beatCards.length > 0 && <button onClick={() => setBeatMapOpen(true)}>Map my draft to the beats…</button>}
            {showFilters && (
            <div className="filter-panel row gap wrap">
            <select value={filters.character} onChange={(e) => setFilters({ ...filters, character: e.target.value })} aria-label="Character">
              <option value="">Any character</option>
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select value={filters.thread} onChange={(e) => setFilters({ ...filters, thread: e.target.value })} aria-label="Plot thread">
              <option value="">Any thread</option>
              {threads.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <select value={filters.location} onChange={(e) => setFilters({ ...filters, location: e.target.value })} aria-label="Location">
              <option value="">Any location</option>
              {locations.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} aria-label="Status">
              <option value="">Any status</option>
              {WRITING_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s[0].toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
            {tags.length > 0 && (
              <select value={filters.tag} onChange={(e) => setFilters({ ...filters, tag: e.target.value })} aria-label="Tag">
                <option value="">Any tag</option>
                {tags.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            )}
            </div>
            )}
            <Menu
              label="Board options"
              items={[
                { label: 'Add column', run: async () => {
                  const t = await promptDialog('New column', 'Column name (for example “Act II” or “Ideas”)', `Column ${lanes.length + 1}`, 'Add');
                  if (t) await createRecord('boardLanes', projectId, { bookId: book.id, title: t, order: lanes.length });
                } },
                { label: 'Save columns as my template', run: async () => {
                  const name = await promptDialog('Save as template', 'Template name', 'My structure', 'Save');
                  if (!name) return;
                  const tpl: BoardTemplate = {
                    id: newId(),
                    name,
                    description: 'Custom template',
                    lanes: lanes.map((l) => ({ title: l.title, cards: cards.filter((c) => c.laneId === l.id && !c.archivedAt && c.type === 'beat').sort((a, b) => a.order - b.order).map((c) => ({ title: c.title, summary: c.summary, type: c.type })) })),
                  };
                  const row = await db.settings.get('boardTemplates');
                  await db.settings.put({ key: 'boardTemplates', value: [...((row?.value as BoardTemplate[]) ?? []), tpl] });
                  toast('Template saved (column names and beat cards).');
                } },
                { label: showArchived ? 'Back to the board' : 'Show cards in Trash', run: () => setShowArchived((v) => !v) },
              ]}
            />
          </div>
        )}
      </div>
      {mode === 'outline' ? (
        <Outline projectId={projectId} bookId={book.id} />
      ) : (
        <div className="lanes">
          {lanes.map((lane, li) => {
            const laneCards = cards.filter((c) => c.laneId === lane.id && (showArchived ? !!c.archivedAt : !c.archivedAt)).sort((a, b) => a.order - b.order);
            const shown = laneCards.filter(matches);
            return (
              <section
                key={lane.id}
                className={`lane${dropAt === lane.id ? ' drop' : ''}`}
                aria-label={lane.title}
                onDragOver={(e) => {
                  if (drag) {
                    e.preventDefault();
                    setDropAt(lane.id);
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  void onDrop(lane.id, laneCards.length);
                }}
              >
                <header>
                  <h2>
                    <InlineEdit label="Column name" value={lane.title} onSave={(v) => void updateRecord('boardLanes', lane.id, { title: v })} />
                  </h2>
                  <span className="muted small">{laneCards.length}</span>
                  <Menu
                    label={`Lane ${lane.title} options`}
                    items={[
                      { label: 'Move left', disabled: li === 0, run: () => void reorder('boardLanes', moveInList(lanes.map((l) => l.id), li, li - 1)) },
                      { label: 'Move right', disabled: li === lanes.length - 1, run: () => void reorder('boardLanes', moveInList(lanes.map((l) => l.id), li, li + 1)) },
                      { label: 'Remove column…', danger: true, run: async () => {
                        const others = lanes.filter((l) => l.id !== lane.id);
                        if (laneCards.length && !others.length) return toast('Move the cards to another lane first.');
                        const ok = await confirmDialog('Remove this column?', laneCards.length ? `Its ${laneCards.length} cards will move to “${others[0].title}”.` : 'The column is empty.', { confirmLabel: 'Remove column' });
                        if (!ok) return;
                        for (const c of laneCards) await moveCard(c.id, others[0].id, 9999);
                        await archiveRecord('boardLanes', lane.id);
                      } },
                    ]}
                  />
                </header>
                <ol className="card-list">
                  {shown.map((c) => (
                    <li
                      key={c.id}
                      className={`board-card t-${c.type}${drag === c.id ? ' dragging' : ''}${dropAt === c.id ? ' drop' : ''}`}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move';
                        setDrag(c.id);
                      }}
                      onDragEnd={() => {
                        setDrag(null);
                        setDropAt(null);
                      }}
                      onDragOver={(e) => {
                        if (drag && drag !== c.id) {
                          e.preventDefault();
                          e.stopPropagation();
                          setDropAt(c.id);
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void onDrop(lane.id, laneCards.indexOf(c));
                      }}
                    >
                      <button className="card-body" onClick={() => setEditing(c.id)}>
                        <div className="card-top">
                          <StatusDot status={c.status} />
                          <span className="card-type">{c.type}</span>
                          {c.sceneId && <span className="linked-mark" title="This card is linked to a scene in your manuscript">✎ in book</span>}
                        </div>
                        <strong>{c.title}</strong>
                        {c.summary && <p>{c.summary.slice(0, 160)}</p>}
                        <div className="chips">
                          {c.povCharacterId && <span className="chip">👤 {refs.find((r) => r.id === c.povCharacterId)?.name}</span>}
                          {c.plotThreadIds.map((t) => (
                            <span key={t} className="chip">🧵 {threads.find((x) => x.id === t)?.name}</span>
                          ))}
                          {c.tags.map((t) => (
                            <span key={t} className="chip tag">#{t}</span>
                          ))}
                        </div>
                      </button>
                      <Menu
                        label={`Card ${c.title} options`}
                        items={[
                          { label: 'Move up', disabled: laneCards.indexOf(c) === 0, run: () => void moveCard(c.id, lane.id, laneCards.indexOf(c) - 1) },
                          { label: 'Move down', disabled: laneCards.indexOf(c) === laneCards.length - 1, run: () => void moveCard(c.id, lane.id, laneCards.indexOf(c) + 1) },
                          ...lanes.filter((l) => l.id !== lane.id).map((l) => ({ label: `Move to ${l.title}`, run: () => void moveCard(c.id, l.id, 9999) })),
                          { label: 'Duplicate', run: async () => {
                            const { id: _id, createdAt: _c, updatedAt: _u, rev: _r, ...rest } = c;
                            void _id; void _c; void _u; void _r;
                            const copy = await createCard(projectId, c.bookId, c.laneId, { ...rest, title: `${c.title} (copy)`, sceneId: null, chapterId: null });
                            await moveCard(copy.id, lane.id, laneCards.indexOf(c) + 1);
                          } },
                          c.archivedAt
                            ? { label: 'Restore', run: () => void unarchiveRecord('boardCards', c.id) }
                            : { label: 'Move to Trash', danger: true, run: async () => {
                                await archiveRecord('boardCards', c.id);
                                toast('Card moved to Trash', { action: { label: 'Undo', run: () => void unarchiveRecord('boardCards', c.id) } });
                              } },
                        ]}
                      />
                    </li>
                  ))}
                </ol>
                {!showArchived && <QuickAddCard onAdd={(title) => createCard(projectId, book.id, lane.id, { title })} onOpen={(id) => setEditing(id)} />}
              </section>
            );
          })}
          <button
            className="add-lane"
            onClick={async () => {
              const t = await promptDialog('New column', 'Column name (for example “Act II” or “Ideas”)', `Column ${lanes.length + 1}`, 'Add');
              if (t) await createRecord('boardLanes', projectId, { bookId: book.id, title: t, order: lanes.length });
            }}
          >
            + Add column
          </button>
        </div>
      )}
      {editingCard && <CardEditor card={editingCard} onClose={() => { setEditing(null); if (focusId) navigate(projectId, 'board'); }} />}
      {templateOpen && <TemplatePicker onPick={applyTemplate} onClose={() => setTemplateOpen(false)} />}
      {beatMapOpen && <BeatMapDialog bookId={book.id} beats={beatCards} onClose={() => setBeatMapOpen(false)} />}
    </div>
  );
}

function TemplatePicker({ onPick, onClose }: { onPick: (t: BoardTemplate) => void; onClose: () => void }) {
  const custom = useLiveQuery(async () => ((await db.settings.get('boardTemplates'))?.value as BoardTemplate[]) ?? [], []) ?? [];
  return (
    <Modal title="Add structure from a template" onClose={onClose}>
      <p className="muted">Templates add lanes and beat cards to your board. Nothing existing is changed.</p>
      <ul className="tpl-list">
        {[...BUILTIN_TEMPLATES, ...custom].map((t) => (
          <li key={t.id}>
            <button onClick={() => onPick(t)}>
              <strong>{t.name}</strong>
              <span className="muted small block">{t.description} · {t.lanes.length} lanes</span>
            </button>
            {custom.includes(t) && (
              <button
                className="small"
                onClick={async () => {
                  await db.settings.put({ key: 'boardTemplates', value: custom.filter((x) => x.id !== t.id) });
                }}
              >
                Delete
              </button>
            )}
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function CardEditor({ card, onClose }: { card: BoardCard; onClose: () => void }) {
  const refs = useReferences(card.projectId);
  const threads = useProjectTable('plotThreads', card.projectId).filter((t) => !t.archivedAt);
  const tree = useManuscript(card.bookId);
  const [picker, setPicker] = useState(false);
  const upd = (patch: Partial<BoardCard>) => void updateRecord('boardCards', card.id, patch);
  const characters = refs.filter((r) => r.type === 'character' && !r.archivedAt);
  const locations = refs.filter((r) => r.type === 'location' && !r.archivedAt);
  const linkedScene = tree?.sceneOrder.find((s) => s.id === card.sceneId);

  const toScene = async (chapter: Chapter) => {
    try {
      const s = await convertCardToScene(card.id, chapter.id);
      toast(`Scene “${s.title}” created in ${chapter.title}. The card stays linked to it.`, { action: { label: 'Open', run: () => navigate(card.projectId, 'write', s.id) } });
    } catch (e) {
      reportError(e, 'Could not create scene');
    }
  };

  return (
    <Modal title="Card" onClose={onClose} wide>
      <div className="card-editor">
        <CommitInput className="title-input" label="Title" value={card.title} onCommit={(v) => upd({ title: v })} />
        <div className="row gap wrap">
          <label className="field inline">
            <span>Type</span>
            <select value={card.type} onChange={(e) => upd({ type: e.target.value as BoardCard['type'] })}>
              {CARD_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <StatusSelect value={card.status} onChange={(v) => upd({ status: v })} />
          <label className="field inline">
            <span>POV</span>
            <select value={card.povCharacterId ?? ''} onChange={(e) => upd({ povCharacterId: e.target.value || null })}>
              <option value="">—</option>
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field inline">
            <span>Location</span>
            <select value={card.locationId ?? ''} onChange={(e) => upd({ locationId: e.target.value || null })}>
              <option value="">—</option>
              {locations.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <CommitInput label="Time marker" value={card.timeMarker} onCommit={(v) => upd({ timeMarker: v })} />
        </div>
        <CommitInput label="Summary" multiline rows={4} value={card.summary} onCommit={(v) => upd({ summary: v })} />
        <fieldset className="field">
          <legend>Plot threads</legend>
          {threads.map((t) => (
            <label key={t.id} className="check">
              <input
                type="checkbox"
                checked={card.plotThreadIds.includes(t.id)}
                onChange={(e) => upd({ plotThreadIds: e.target.checked ? [...card.plotThreadIds, t.id] : card.plotThreadIds.filter((x) => x !== t.id) })}
              />{' '}
              {t.name}
            </label>
          ))}
          {!threads.length && <span className="muted small">No plot threads yet.</span>}
        </fieldset>
        <div className="field">
          <span>Linked references</span>
          <div className="chips">
            {card.referenceIds.map((id) => {
              const r = refs.find((x) => x.id === id);
              return (
                <span key={id} className="chip">
                  {r ? `${REFERENCE_TYPE_ICONS[r.type]} ${r.name}` : '(missing)'}{' '}
                  <button className="chip-x" aria-label="Remove link" onClick={() => upd({ referenceIds: card.referenceIds.filter((x) => x !== id) })}>
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
        <TagInput value={card.tags} onChange={(tags) => upd({ tags })} />
        <CommitInput label="Notes" multiline rows={4} value={card.notes} onCommit={(v) => upd({ notes: v })} />
        <h3>Manuscript</h3>
        {linkedScene ? (
          <p>
            Linked to scene <a href={`#/p/${card.projectId}/write/${linkedScene.id}`}>{tree?.chapters.find((c) => c.id === linkedScene.chapterId)?.title} › {linkedScene.title}</a>{' '}
            <button className="small" onClick={() => upd({ sceneId: null, chapterId: null })}>
              Unlink
            </button>
          </p>
        ) : (
          <div className="row gap wrap">
            <label className="field inline">
              <span>Create scene in</span>
              <select
                value=""
                onChange={(e) => {
                  const ch = tree?.chapters.find((c) => c.id === e.target.value);
                  if (ch) void toScene(ch);
                }}
              >
                <option value="">Choose chapter…</option>
                {tree?.chapters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={async () => {
                const { chapter, scene } = await convertCardToChapter(card.id);
                toast(`Chapter “${chapter.title}” created`, { action: { label: 'Open', run: () => navigate(card.projectId, 'write', scene.id) } });
              }}
            >
              Make it a new chapter
            </button>
            <label className="field inline">
              <span>Or link existing scene</span>
              <select value="" onChange={(e) => {
                const s = tree?.sceneOrder.find((x) => x.id === e.target.value);
                if (s) upd({ sceneId: s.id, chapterId: s.chapterId });
              }}>
                <option value="">Choose…</option>
                {tree?.sceneOrder.map((s) => (
                  <option key={s.id} value={s.id}>
                    {tree.chapters.find((c) => c.id === s.chapterId)?.title} › {s.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>
      {picker && (
        <ReferencePicker
          projectId={card.projectId}
          onClose={() => setPicker(false)}
          onPick={(r) => {
            setPicker(false);
            if (!card.referenceIds.includes(r.id)) upd({ referenceIds: [...card.referenceIds, r.id] });
          }}
        />
      )}
    </Modal>
  );
}

/** Nested outline of the book with inline summaries and planning fields. */
function Outline({ projectId, bookId }: { projectId: string; bookId: string }) {
  const tree = useManuscript(bookId);
  const refs = useReferences(projectId);
  const threads = useProjectTable('plotThreads', projectId);
  if (!tree) return null;
  const name = (id: string | null) => refs.find((r) => r.id === id)?.name;
  let lastPart: string | null = null;
  return (
    <ol className="outline">
      {tree.chapters.map((c, i) => {
        const part = tree.parts.find((p) => p.id === c.partId);
        const showPart = part && c.partId !== lastPart;
        lastPart = c.partId;
        const scenes = tree.scenesByChapter.get(c.id) ?? [];
        return (
          <li key={c.id}>
            {showPart && <h2 className="part-head">{part!.title}</h2>}
            <div className="outline-ch">
              <div className="row gap">
                <StatusDot status={c.status} />
                <a href={`#/p/${projectId}/write/${scenes[0]?.id ?? ''}`}>
                  <strong>{c.title}</strong>
                </a>
                <span className="muted small">{scenes.reduce((n, s) => n + s.wordCount, 0).toLocaleString()} words</span>
                <PlanChip notes={c.summary} />
                <span className="grow" />
                <button className="icon-btn" aria-label="Move chapter up" disabled={i === 0} onClick={() => void reorder('chapters', moveInList(tree.chapters.map((x) => x.id), i, i - 1))}>
                  ↑
                </button>
                <button className="icon-btn" aria-label="Move chapter down" disabled={i === tree.chapters.length - 1} onClick={() => void reorder('chapters', moveInList(tree.chapters.map((x) => x.id), i, i + 1))}>
                  ↓
                </button>
              </div>
              <CommitInput multiline rows={2} placeholder="Chapter summary…" value={c.summary} onCommit={(v) => void updateRecord('chapters', c.id, { summary: v })} />
              <ol className="outline-scenes">
                {scenes.map((s) => (
                  <li key={s.id}>
                    <div className="row gap wrap">
                      <StatusDot status={s.status} />
                      <a href={`#/p/${projectId}/write/${s.id}`}>{s.title}</a>
                      {s.povCharacterId && <span className="chip">👤 {name(s.povCharacterId)}</span>}
                      {s.locationId && <span className="chip">📍 {name(s.locationId)}</span>}
                      {s.timeMarker && <span className="chip">⏱ {s.timeMarker}</span>}
                      <PlanChip notes={s.notes} />
                      {s.plotThreadIds.map((t) => (
                        <span key={t} className="chip">🧵 {threads.find((x) => x.id === t)?.name}</span>
                      ))}
                    </div>
                    <CommitInput multiline rows={2} placeholder="Scene summary…" value={s.summary} onCommit={(v) => void updateRecord('scenes', s.id, { summary: v })} />
                  </li>
                ))}
              </ol>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export type { BoardLane };

/** Type a title and press Enter to add a card; the box stays open for the next one. */
function QuickAddCard({ onAdd, onOpen }: { onAdd: (title: string) => Promise<BoardCard>; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [last, setLast] = useState<BoardCard | null>(null);
  if (!open)
    return (
      <button className="add-card" onClick={() => setOpen(true)}>
        + Add a card
      </button>
    );
  const add = async () => {
    const t = title.trim();
    if (!t) return;
    setLast(await onAdd(t));
    setTitle('');
  };
  return (
    <div className="quick-card">
      <textarea
        autoFocus
        rows={2}
        value={title}
        placeholder="What happens? (Enter to add, Esc to close)"
        aria-label="New card title"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void add();
          } else if (e.key === 'Escape') {
            setOpen(false);
            setTitle('');
          }
        }}
        onBlur={() => !title.trim() && setOpen(false)}
      />
      <div className="row gap">
        <button className="primary small" onMouseDown={(e) => e.preventDefault()} onClick={() => void add()}>
          Add card
        </button>
        {last && (
          <button className="small" onMouseDown={(e) => e.preventDefault()} onClick={() => onOpen(last.id)}>
            Details for “{last.title.slice(0, 18)}”…
          </button>
        )}
      </div>
    </div>
  );
}

/** Outline: how much of a plan (the bullet lines in a scene's notes or a chapter's summary) is ticked off. */
function PlanChip({ notes }: { notes: string }) {
  const items = planItems(notes);
  if (!items.length) return null;
  const done = items.filter((i) => i.done).length;
  return (
    <span className="chip" title="Plan points ticked off (in Scene notes)">
      ☑ Plan {done}/{items.length}
    </span>
  );
}
