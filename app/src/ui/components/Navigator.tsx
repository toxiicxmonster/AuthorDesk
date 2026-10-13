import { useMemo, useState } from 'react';
import type { Book, Chapter, Scene } from '../../domain/schema';
import type { ManuscriptTree } from '../data';
import { getRecent } from '../data';
import { navigate } from '../router';
import { Menu } from './Menu';
import { InlineEdit, StatusDot, relativeTime } from './common';
import { confirmDialog, promptDialog, reportError, setUi, toast } from '../store';
import {
  archiveRecord,
  createBook,
  createChapter,
  createRecord,
  createScene,
  moveInList,
  moveScene,
  reorder,
  unarchiveRecord,
  renameBook,
  updateRecord,
} from '../../storage/repo';
import { flushAllEdits } from '../../editor/EditorContext';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../storage/db';

interface Props {
  projectId: string;
  books: Book[];
  book: Book | null;
  tree: ManuscriptTree;
  currentSceneId: string | null;
}

type Drag = { kind: 'chapter'; id: string } | { kind: 'scene'; id: string } | null;

export function Navigator({ projectId, books, book, tree, currentSceneId }: Props) {
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<Drag>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const currentChapterId = tree.sceneOrder.find((s) => s.id === currentSceneId)?.chapterId ?? null;

  const archived = useLiveQuery(async () => {
    if (!book) return { chapters: [] as Chapter[], scenes: [] as Scene[] };
    const chapters = (await db.chapters.where('bookId').equals(book.id).toArray()).filter((c) => c.archivedAt);
    const liveIds = tree.chapters.map((c) => c.id);
    const scenes = (await db.scenes.where('chapterId').anyOf(liveIds).toArray()).filter((s) => s.archivedAt);
    return { chapters, scenes };
  }, [book?.id, tree.chapters.length]);

  const open = async (sceneId: string) => {
    await flushAllEdits();
    navigate(projectId, 'write', sceneId);
    if (window.innerWidth <= 900) setUi({ leftOpen: false });
  };

  const q = filter.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!q) return tree.chapters;
    return tree.chapters.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        (tree.scenesByChapter.get(c.id) ?? []).some((s) => s.title.toLowerCase().includes(q) || s.plainText.toLowerCase().includes(q)),
    );
  }, [q, tree]);

  const recent = getRecent(projectId)
    .map((id) => tree.sceneOrder.find((s) => s.id === id))
    .filter((s): s is Scene => !!s && s.id !== currentSceneId)
    .slice(0, 4);
  const pinned = tree.chapters.filter((c) => c.pinned);
  const chapterTitle = (id: string) => tree.chapters.find((c) => c.id === id)?.title ?? '';
  const partTitle = (id: string | null) => tree.parts.find((p) => p.id === id)?.title ?? null;

  const addChapter = async (atIndex?: number) => {
    if (!book) return;
    const ch = await createChapter(projectId, book.id, `Chapter ${tree.chapters.length + 1}`, { atIndex });
    const first = await db.scenes.where('chapterId').equals(ch.id).first();
    if (first) await open(first.id);
  };

  const moveChapter = async (id: string, delta: number) => {
    const ids = tree.chapters.map((c) => c.id);
    const i = ids.indexOf(id);
    await reorder('chapters', moveInList(ids, i, i + delta));
  };

  const archiveChapter = async (c: Chapter) => {
    const scenes = tree.scenesByChapter.get(c.id) ?? [];
    const words = scenes.reduce((n, s) => n + s.wordCount, 0);
    const ok = await confirmDialog('Move chapter to Trash?', `“${c.title}” (${words.toLocaleString()} words) will be removed from the book. You can bring it back any time from Trash at the bottom of the chapter list.`, { confirmLabel: 'Move to Trash', danger: true });
    if (!ok) return;
    await flushAllEdits();
    await archiveRecord('chapters', c.id);
    toast(`Moved “${c.title}” to Trash`, { action: { label: 'Undo', run: () => void unarchiveRecord('chapters', c.id) } });
    if (c.id === currentChapterId) {
      const next = tree.sceneOrder.find((s) => s.chapterId !== c.id);
      navigate(projectId, 'write', next?.id ?? null);
    }
  };

  const archiveScene = async (s: Scene) => {
    const siblings = tree.scenesByChapter.get(s.chapterId) ?? [];
    if (siblings.length <= 1) {
      toast('A chapter needs at least one scene. Move the whole chapter to Trash instead.');
      return;
    }
    const ok = await confirmDialog('Move scene to Trash?', `“${s.title}” (${s.wordCount.toLocaleString()} words) will be removed from the chapter. You can bring it back from Trash at the bottom of the chapter list.`, { confirmLabel: 'Move to Trash', danger: true });
    if (!ok) return;
    await flushAllEdits();
    await archiveRecord('scenes', s.id);
    toast(`Moved “${s.title}” to Trash`, { action: { label: 'Undo', run: () => void unarchiveRecord('scenes', s.id) } });
    if (s.id === currentSceneId) navigate(projectId, 'write', siblings.find((x) => x.id !== s.id)?.id ?? null);
  };

  const onDropChapter = async (targetChapterId: string) => {
    if (!drag) return;
    try {
      if (drag.kind === 'chapter' && drag.id !== targetChapterId) {
        const ids = tree.chapters.map((c) => c.id);
        await reorder('chapters', moveInList(ids, ids.indexOf(drag.id), ids.indexOf(targetChapterId)));
      } else if (drag.kind === 'scene') {
        await flushAllEdits();
        await moveScene(drag.id, targetChapterId);
        setExpanded((e) => new Set(e).add(targetChapterId));
      }
    } catch (e) {
      reportError(e, 'Move failed');
    }
    setDrag(null);
    setDropTarget(null);
  };

  const onDropScene = async (target: Scene) => {
    if (drag?.kind !== 'scene' || drag.id === target.id) return;
    await flushAllEdits();
    await moveScene(drag.id, target.chapterId, target.order);
    setDrag(null);
    setDropTarget(null);
  };

  let lastPart: string | null = null;

  return (
    <nav className="navigator" aria-label="Chapters">
      <div className="nav-head">
        <select
          aria-label="Book"
          value={book?.id ?? ''}
          onChange={async (e) => {
            if (e.target.value === '__new') {
              const title = await promptDialog('New book', 'Book title', `Book ${books.length + 1}`, 'Create');
              if (title) {
                const b = await createBook(projectId, title);
                const ch = await db.chapters.where('bookId').equals(b.id).first();
                const sc = ch && (await db.scenes.where('chapterId').equals(ch.id).first());
                if (sc) navigate(projectId, 'write', sc.id);
              }
              return;
            }
            const ch = (await db.chapters.where('bookId').equals(e.target.value).toArray()).filter((c) => !c.archivedAt).sort((a, b) => a.order - b.order)[0];
            const sc = ch && (await db.scenes.where('chapterId').equals(ch.id).toArray()).filter((s) => !s.archivedAt).sort((a, b) => a.order - b.order)[0];
            navigate(projectId, 'write', sc?.id ?? null);
          }}
        >
          {books.map((b) => (
            <option key={b.id} value={b.id}>
              {b.title}
            </option>
          ))}
          <option value="__new">+ New book…</option>
        </select>
        <Menu
          label="Book actions"
          items={[
            book && {
              label: 'Rename book',
              run: async () => {
                const t = await promptDialog('Rename book', 'Title', book.title);
                if (t?.trim()) await renameBook(book.id, t.trim());
              },
            },
            book && {
              label: 'Add part',
              run: async () => {
                const t = await promptDialog('New part', 'Part title', `Part ${tree.parts.length + 1}`, 'Create');
                if (t) await createRecord('parts', projectId, { bookId: book.id, title: t, order: tree.parts.length });
                toast('Part created. Assign chapters to it from each chapter’s ⋯ menu.');
              },
            },
          ]}
        />
      </div>
      <input
        className="nav-filter"
        type="search"
        placeholder="Filter chapters…"
        aria-label="Filter chapters by title or text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {!q && pinned.length > 0 && (
        <div className="nav-section">
          <h4>Pinned</h4>
          {pinned.map((c) => {
            const first = tree.scenesByChapter.get(c.id)?.[0];
            return (
              <button key={c.id} className="nav-mini" onClick={() => first && open(first.id)}>
                📌 {c.title}
              </button>
            );
          })}
        </div>
      )}
      {!q && recent.length > 0 && (
        <div className="nav-section">
          <h4>Recent</h4>
          {recent.map((s) => (
            <button key={s.id} className="nav-mini" onClick={() => open(s.id)} title={relativeTime(s.updatedAt)}>
              ↺ {chapterTitle(s.chapterId)}
              {(tree.scenesByChapter.get(s.chapterId)?.length ?? 0) > 1 ? ` › ${s.title}` : ''}
            </button>
          ))}
        </div>
      )}
      <ol className="chapter-list">
        {visible.map((c, idx) => {
          const scenes = tree.scenesByChapter.get(c.id) ?? [];
          const words = scenes.reduce((n, s) => n + s.wordCount, 0);
          const isCurrent = c.id === currentChapterId;
          const isOpen = expanded.has(c.id) || (isCurrent && scenes.length > 1) || (!!q && scenes.length > 1);
          const part = partTitle(c.partId);
          const showPart = part && c.partId !== lastPart;
          lastPart = c.partId;
          return (
            <li key={c.id}>
              {showPart && <div className="part-head">{part}</div>}
              <div
                className={`chapter-row${isCurrent ? ' current' : ''}${dropTarget === c.id ? ' drop' : ''}`}
                draggable={!q}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  setDrag({ kind: 'chapter', id: c.id });
                }}
                onDragOver={(e) => {
                  if (drag) {
                    e.preventDefault();
                    setDropTarget(c.id);
                  }
                }}
                onDragLeave={() => setDropTarget(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  void onDropChapter(c.id);
                }}
                onDragEnd={() => {
                  setDrag(null);
                  setDropTarget(null);
                }}
              >
                {scenes.length > 1 ? (
                  <button
                    className="twisty"
                    aria-label={isOpen ? 'Collapse scenes' : 'Expand scenes'}
                    aria-expanded={isOpen}
                    onClick={() =>
                      setExpanded((e) => {
                        const n = new Set(e);
                        if (n.has(c.id)) n.delete(c.id);
                        else n.add(c.id);
                        return n;
                      })
                    }
                  >
                    {isOpen ? '▾' : '▸'}
                  </button>
                ) : (
                  <span className="twisty" />
                )}
                {renaming === c.id ? (
                  <InlineEdit
                    className="nav-rename"
                    label="Chapter title"
                    value={c.title}
                    editing
                    onEditingChange={(v) => !v && setRenaming(null)}
                    onSave={(v) => void updateRecord('chapters', c.id, { title: v })}
                  />
                ) : (
                  <button
                    className="chapter-title"
                    onClick={() => scenes[0] && open(scenes[0].id)}
                    onDoubleClick={() => setRenaming(c.id)}
                    onKeyDown={(e) => e.key === 'F2' && setRenaming(c.id)}
                    title={`${c.title} — ${words.toLocaleString()} words, ${c.status}. Double-click to rename.`}
                    aria-current={isCurrent ? 'true' : undefined}
                  >
                    <StatusDot status={c.status} />
                    <span className="t">{c.title}</span>
                    <span className="wc">{words.toLocaleString()}</span>
                  </button>
                )}
                <Menu
                  label={`Actions for ${c.title}`}
                  items={[
                    {
                      label: 'Rename',
                      run: () => setRenaming(c.id),
                    },
                    { label: 'Move up', run: () => void moveChapter(c.id, -1), disabled: idx === 0 || !!q },
                    { label: 'Move down', run: () => void moveChapter(c.id, 1), disabled: idx === visible.length - 1 || !!q },
                    {
                      label: 'Add scene',
                      run: async () => {
                        const s = await createScene(projectId, c.id, `Scene ${scenes.length + 1}`);
                        setExpanded((e) => new Set(e).add(c.id));
                        await open(s.id);
                      },
                    },
                    { label: 'Insert chapter after', run: () => void addChapter(tree.chapters.indexOf(c) + 1) },
                    { label: c.pinned ? 'Unpin' : 'Pin', run: () => void updateRecord('chapters', c.id, { pinned: !c.pinned }) },
                    ...tree.parts.map((p) => ({
                      label: c.partId === p.id ? `✓ In ${p.title}` : `Put in ${p.title}`,
                      run: () => void updateRecord('chapters', c.id, { partId: c.partId === p.id ? null : p.id }),
                    })),
                    { label: 'Move to Trash…', danger: true, run: () => void archiveChapter(c) },
                  ]}
                />
              </div>
              {isOpen && (
                <ol className="scene-list">
                  {scenes
                    .filter((s) => !q || s.title.toLowerCase().includes(q) || s.plainText.toLowerCase().includes(q) || c.title.toLowerCase().includes(q))
                    .map((s, si) => (
                      <li
                        key={s.id}
                        className={`scene-row${s.id === currentSceneId ? ' current' : ''}${dropTarget === s.id ? ' drop' : ''}`}
                        draggable={!q}
                        onDragStart={(e) => {
                          e.stopPropagation();
                          setDrag({ kind: 'scene', id: s.id });
                        }}
                        onDragOver={(e) => {
                          if (drag?.kind === 'scene') {
                            e.preventDefault();
                            e.stopPropagation();
                            setDropTarget(s.id);
                          }
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void onDropScene(s);
                        }}
                      >
                        <button className="scene-title" onClick={() => open(s.id)} aria-current={s.id === currentSceneId ? 'true' : undefined}>
                          <StatusDot status={s.status} />
                          <span className="t">{s.title}</span>
                          <span className="wc">{s.wordCount.toLocaleString()}</span>
                        </button>
                        <Menu
                          label={`Actions for ${s.title}`}
                          items={[
                            {
                              label: 'Rename',
                              run: async () => {
                                const t = await promptDialog('Rename scene', 'Title', s.title);
                                if (t) await updateRecord('scenes', s.id, { title: t });
                              },
                            },
                            { label: 'Move up', disabled: si === 0, run: () => void moveScene(s.id, c.id, si - 1) },
                            { label: 'Move down', disabled: si === scenes.length - 1, run: () => void moveScene(s.id, c.id, si + 1) },
                            ...tree.chapters
                              .filter((o) => o.id !== c.id)
                              .slice(0, 30)
                              .map((o) => ({ label: `Move to ${o.title}`, run: async () => { await flushAllEdits(); await moveScene(s.id, o.id); } })),
                            { label: 'Move to Trash…', danger: true, run: () => void archiveScene(s) },
                          ]}
                        />
                      </li>
                    ))}
                </ol>
              )}
            </li>
          );
        })}
      </ol>
      {book && (
        <button className="add-btn" onClick={() => void addChapter()}>
          + New chapter
        </button>
      )}
      {archived && (archived.chapters.length > 0 || archived.scenes.length > 0) && (
        <div className="nav-section">
          <button className="link" onClick={() => setShowArchived((v) => !v)} aria-expanded={showArchived}>
            Trash ({archived.chapters.length + archived.scenes.length})
          </button>
          {showArchived && (
            <ul className="archived">
              {archived.chapters.map((c) => (
                <li key={c.id}>
                  {c.title} <button onClick={() => void unarchiveRecord('chapters', c.id)}>Restore</button>
                </li>
              ))}
              {archived.scenes.map((s) => (
                <li key={s.id}>
                  {chapterTitle(s.chapterId)} › {s.title} <button onClick={() => void unarchiveRecord('scenes', s.id)}>Restore</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="nav-total muted">Book total {tree.wordCount.toLocaleString()} words</div>
    </nav>
  );
}
