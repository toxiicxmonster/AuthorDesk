import { db, table } from './db';
import { newId, nowIso } from '../domain/ids';
import type {
  BoardCard,
  BoardLane,
  Book,
  Chapter,
  DocJson,
  Project,
  Scene,
  TableName,
  TableTypes,
} from '../domain/schema';
import { countWords, docReferenceIds, docToPlainText, emptyDoc } from '../domain/text';
import { getDeviceId } from './device';

type BaseKeys = 'id' | 'projectId' | 'createdAt' | 'updatedAt' | 'archivedAt' | 'rev';
export type NewRecord<T extends TableName> = Omit<TableTypes[T], BaseKeys> &
  Partial<Pick<TableTypes[T], BaseKeys>>;

async function logChange(name: TableName, recordId: string, projectId: string, rev: number, op: 'put' | 'delete') {
  // Keep one pending entry per record so the log stays bounded between syncs.
  await db.changes.where('recordId').equals(recordId).delete();
  await db.changes.add({ table: name, recordId, projectId, rev, op, at: nowIso(), deviceId: getDeviceId() });
}

/** Create a record with stable id and timestamps. */
export async function createRecord<T extends TableName>(
  name: T,
  projectId: string,
  data: NewRecord<T>,
): Promise<TableTypes[T]> {
  const now = nowIso();
  const rec = {
    archivedAt: null,
    rev: 1,
    ...data,
    id: data.id ?? newId(),
    projectId,
    createdAt: data.createdAt ?? now,
    updatedAt: data.updatedAt ?? now,
  } as TableTypes[T];
  await db.transaction('rw', [table(name), db.changes], async () => {
    await table(name).add(rec);
    await logChange(name, rec.id, projectId, rec.rev, 'put');
  });
  return rec;
}

/** Patch a record, bumping rev and updatedAt. */
export async function updateRecord<T extends TableName>(
  name: T,
  id: string,
  patch: Partial<TableTypes[T]>,
): Promise<TableTypes[T] | undefined> {
  return db.transaction('rw', [table(name), db.changes], async () => {
    const cur = await table(name).get(id as never);
    if (!cur) return undefined;
    const next = { ...cur, ...patch, id, rev: (cur.rev ?? 0) + 1, updatedAt: nowIso() } as TableTypes[T];
    await table(name).put(next);
    await logChange(name, id, cur.projectId, next.rev, 'put');
    return next;
  });
}

export async function archiveRecord(name: TableName, id: string) {
  return updateRecord(name, id, { archivedAt: nowIso() } as never);
}

export async function unarchiveRecord(name: TableName, id: string) {
  return updateRecord(name, id, { archivedAt: null } as never);
}

export async function deleteRecord(name: TableName, id: string) {
  await db.transaction('rw', [table(name), db.changes], async () => {
    const cur = await table(name).get(id);
    if (!cur) return;
    await table(name).delete(id);
    await logChange(name, id, cur.projectId, (cur.rev ?? 0) + 1, 'delete');
  });
}

/** Persist a new ordering (index = order) for a set of ordered records. */
export async function reorder(name: 'books' | 'parts' | 'chapters' | 'scenes' | 'boardLanes' | 'boardCards', ids: string[]) {
  await db.transaction('rw', [table(name), db.changes], async () => {
    for (let i = 0; i < ids.length; i++) {
      const cur = await table(name).get(ids[i]);
      if (cur && cur.order !== i) await updateRecord(name, ids[i], { order: i } as never);
    }
  });
}

export function moveInList<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice();
  if (from < 0 || from >= next.length || to < 0 || to >= next.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

// ---------- Projects ----------

export const DEFAULT_LANES = ['Act I', 'Act II', 'Act III'];

export async function createProject(name: string, opts: { kind?: Project['kind']; bookTitle?: string } = {}) {
  const projectId = newId();
  const project = await createRecord('projects', projectId, {
    id: projectId,
    name,
    kind: opts.kind ?? 'book',
    description: '',
    dailyGoal: 0,
  });
  const book = await createBook(projectId, opts.bookTitle ?? name);
  return { project, book };
}

/**
 * Rename a project. In a one-book project the book *is* the project to the writer, so its title
 * follows; in a series, only books still sharing the old name are carried along.
 */
export async function renameProject(projectId: string, name: string) {
  const project = await db.projects.get(projectId);
  if (!project) return;
  const books = (await db.books.where('projectId').equals(projectId).toArray()).filter((b) => !b.archivedAt);
  await updateRecord('projects', projectId, { name });
  for (const b of books) {
    if (b.title !== name && (books.length === 1 || b.title === project.name)) await updateRecord('books', b.id, { title: name });
  }
}

/** Rename a book; in a one-book project the project name follows so the header, Home and exports agree. */
export async function renameBook(bookId: string, title: string) {
  const book = await db.books.get(bookId);
  if (!book) return;
  await updateRecord('books', bookId, { title });
  const project = await db.projects.get(book.projectId);
  const books = (await db.books.where('projectId').equals(book.projectId).toArray()).filter((b) => !b.archivedAt);
  if (project && books.length === 1 && project.name !== title) await updateRecord('projects', project.id, { name: title });
}

export const DEFAULT_BOOK_TITLE = 'Untitled novel';

/**
 * Older versions renamed only one of project name / book title, leaving a one-book project half "Untitled novel".
 * Copy the real title over the placeholder. Safe to run on every start: it only touches the placeholder.
 */
export async function repairUntitledBooks() {
  for (const project of await db.projects.toArray()) {
    if (project.archivedAt) continue;
    const books = (await db.books.where('projectId').equals(project.id).toArray()).filter((b) => !b.archivedAt);
    if (books.length !== 1) continue;
    const [book] = books;
    if (book.title === DEFAULT_BOOK_TITLE && project.name.trim() && project.name !== DEFAULT_BOOK_TITLE) await updateRecord('books', book.id, { title: project.name });
    else if (project.name === DEFAULT_BOOK_TITLE && book.title.trim() && book.title !== DEFAULT_BOOK_TITLE) await updateRecord('projects', project.id, { name: book.title });
  }
}

export async function createBook(projectId: string, title: string): Promise<Book> {
  const order = await db.books.where('projectId').equals(projectId).count();
  const book = await createRecord('books', projectId, { title, subtitle: '', order });
  const chapter = await createChapter(projectId, book.id, 'Chapter 1');
  void chapter;
  for (let i = 0; i < DEFAULT_LANES.length; i++) {
    await createRecord('boardLanes', projectId, { bookId: book.id, title: DEFAULT_LANES[i], order: i });
  }
  return book;
}

export async function createChapter(
  projectId: string,
  bookId: string,
  title: string,
  opts: { partId?: string | null; atIndex?: number; withScene?: boolean } = {},
): Promise<Chapter> {
  const siblings = (await db.chapters.where('bookId').equals(bookId).toArray())
    .filter((c) => !c.archivedAt)
    .sort((a, b) => a.order - b.order);
  const chapter = await createRecord('chapters', projectId, {
    bookId,
    partId: opts.partId ?? null,
    title,
    order: siblings.length,
    summary: '',
    status: 'drafting',
    pinned: false,
  });
  if (opts.atIndex !== undefined && opts.atIndex < siblings.length) {
    const ids = siblings.map((c) => c.id);
    ids.splice(opts.atIndex, 0, chapter.id);
    await reorder('chapters', ids);
  }
  if (opts.withScene !== false) await createScene(projectId, chapter.id, 'Scene 1');
  return chapter;
}

export async function createScene(
  projectId: string,
  chapterId: string,
  title: string,
  content: DocJson = emptyDoc(),
  extra: Partial<Scene> = {},
): Promise<Scene> {
  const order = (await db.scenes.where('chapterId').equals(chapterId).toArray()).filter((s) => !s.archivedAt).length;
  const plainText = docToPlainText(content);
  return createRecord('scenes', projectId, {
    chapterId,
    title,
    order,
    content,
    plainText,
    wordCount: countWords(plainText),
    summary: '',
    status: 'drafting',
    povCharacterId: null,
    locationId: null,
    timeMarker: '',
    notes: '',
    plotThreadIds: [],
    referenceIds: docReferenceIds(content),
    ...extra,
  });
}

const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000;
const MAX_AUTO_SNAPSHOTS = 40;

/** Save scene prose. Derived fields are recomputed; periodic recovery snapshots are kept. */
export async function saveSceneContent(sceneId: string, content: DocJson): Promise<Scene | undefined> {
  const plainText = docToPlainText(content);
  const before = await db.scenes.get(sceneId);
  if (!before) return undefined;
  await maybeSnapshot(before, 'auto');
  const wordCount = countWords(plainText);
  if (wordCount !== before.wordCount) await logWords(before.projectId, wordCount - before.wordCount);
  return updateRecord('scenes', sceneId, {
    content,
    plainText,
    wordCount: countWords(plainText),
    referenceIds: docReferenceIds(content),
  });
}

export function localDateKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Net words written per day, per project (local convenience stats; kept for 90 days). */
export async function logWords(projectId: string, delta: number) {
  const key = `wordlog:${projectId}`;
  const row = await db.settings.get(key);
  const log = { ...((row?.value as Record<string, number>) ?? {}) };
  const today = localDateKey();
  log[today] = (log[today] ?? 0) + delta;
  const keys = Object.keys(log).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - 90))) delete log[k];
  await db.settings.put({ key, value: log });
}

async function maybeSnapshot(scene: Scene, reason: string) {
  if (!scene.plainText.trim()) return;
  const snaps = await db.snapshots.where('sceneId').equals(scene.id).toArray();
  const latest = snaps.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (latest && reason === 'auto') {
    if (Date.now() - Date.parse(latest.createdAt) < SNAPSHOT_INTERVAL_MS) return;
    if (latest.plainText === scene.plainText) return;
  }
  await createSnapshot(scene, reason);
  const autos = snaps.filter((s) => s.reason === 'auto');
  if (autos.length >= MAX_AUTO_SNAPSHOTS) {
    const excess = autos.slice(MAX_AUTO_SNAPSHOTS - 1);
    await db.snapshots.bulkDelete(excess.map((s) => s.id));
  }
}

export async function createSnapshot(scene: Scene, reason: string) {
  return createRecord('snapshots', scene.projectId, {
    sceneId: scene.id,
    content: scene.content,
    plainText: scene.plainText,
    wordCount: scene.wordCount,
    reason,
  });
}

export async function restoreSnapshot(snapshotId: string) {
  const snap = await db.snapshots.get(snapshotId);
  if (!snap) throw new Error('Snapshot not found');
  const scene = await db.scenes.get(snap.sceneId);
  if (!scene) throw new Error('The scene for this snapshot no longer exists');
  await createSnapshot(scene, 'before restore');
  return saveSceneContent(scene.id, snap.content);
}

/** Move a scene to another chapter (or position) while preserving its id and links. */
export async function moveScene(sceneId: string, targetChapterId: string, targetIndex?: number) {
  await db.transaction('rw', [db.scenes, db.changes], async () => {
    const scene = await db.scenes.get(sceneId);
    if (!scene) return;
    const target = (await db.scenes.where('chapterId').equals(targetChapterId).toArray())
      .filter((s) => !s.archivedAt && s.id !== sceneId)
      .sort((a, b) => a.order - b.order)
      .map((s) => s.id);
    const idx = targetIndex === undefined ? target.length : Math.max(0, Math.min(targetIndex, target.length));
    target.splice(idx, 0, sceneId);
    if (scene.chapterId !== targetChapterId) {
      await updateRecord('scenes', sceneId, { chapterId: targetChapterId });
      const source = (await db.scenes.where('chapterId').equals(scene.chapterId).toArray())
        .filter((s) => !s.archivedAt)
        .sort((a, b) => a.order - b.order)
        .map((s) => s.id);
      await reorder('scenes', source);
    }
    await reorder('scenes', target);
  });
}

/** Split a scene at a block index: blocks from `blockIndex` onward move to a new scene after it. */
export async function splitScene(sceneId: string, blockIndex: number, newTitle: string) {
  const scene = await db.scenes.get(sceneId);
  if (!scene) throw new Error('Scene not found');
  const blocks = scene.content.content ?? [];
  if (blockIndex <= 0 || blockIndex >= blocks.length) throw new Error('Choose a split point inside the scene');
  await createSnapshot(scene, 'before split');
  const first: DocJson = { type: 'doc', content: blocks.slice(0, blockIndex) };
  const second: DocJson = { type: 'doc', content: blocks.slice(blockIndex) };
  await saveSceneContent(sceneId, first);
  const created = await createScene(scene.projectId, scene.chapterId, newTitle, second, {
    povCharacterId: scene.povCharacterId,
    locationId: scene.locationId,
    plotThreadIds: scene.plotThreadIds,
  });
  await moveScene(created.id, scene.chapterId, scene.order + 1);
  return created;
}

/** Merge `nextId` into `sceneId` (appending its prose and notes) and archive the merged scene. */
export async function mergeScenes(sceneId: string, nextId: string) {
  const a = await db.scenes.get(sceneId);
  const b = await db.scenes.get(nextId);
  if (!a || !b) throw new Error('Scene not found');
  await createSnapshot(a, 'before merge');
  await createSnapshot(b, 'before merge');
  const merged: DocJson = {
    type: 'doc',
    content: [...(a.content.content ?? []), { type: 'horizontalRule' }, ...(b.content.content ?? [])],
  };
  await saveSceneContent(sceneId, merged);
  await updateRecord('scenes', sceneId, {
    notes: [a.notes, b.notes].filter(Boolean).join('\n\n'),
    plotThreadIds: [...new Set([...a.plotThreadIds, ...b.plotThreadIds])],
  });
  // Re-point anything that referenced the merged scene so links are not broken.
  const cards = await db.boardCards.where('projectId').equals(a.projectId).toArray();
  for (const c of cards) if (c.sceneId === nextId) await updateRecord('boardCards', c.id, { sceneId, chapterId: a.chapterId });
  const events = await db.timelineEvents.where('projectId').equals(a.projectId).toArray();
  for (const e of events) if (e.sceneId === nextId) await updateRecord('timelineEvents', e.id, { sceneId, chapterId: a.chapterId });
  await archiveRecord('scenes', nextId);
}

/** Delete a whole project and everything in it. Caller must confirm with the user first. */
export async function deleteProjectCascade(projectId: string) {
  const names: TableName[] = [
    'books', 'parts', 'chapters', 'scenes', 'references', 'plotThreads', 'timelineEvents',
    'boardLanes', 'boardCards', 'notes', 'snapshots', 'dictionary',
  ];
  await db.transaction('rw', [...names.map((n) => table(n)), db.projects, db.changes, db.ignored], async () => {
    for (const n of names) await table(n).where('projectId').equals(projectId).delete();
    await db.ignored.where('projectId').equals(projectId).delete();
    await db.changes.where('projectId').equals(projectId).delete();
    await db.projects.delete(projectId);
  });
}

// ---------- Board ----------

export async function createCard(projectId: string, bookId: string, laneId: string, data: Partial<BoardCard> = {}) {
  const order = (await db.boardCards.where('laneId').equals(laneId).toArray()).filter((c) => !c.archivedAt).length;
  return createRecord('boardCards', projectId, {
    bookId,
    laneId,
    order,
    title: 'New card',
    summary: '',
    type: 'scene',
    status: 'idea',
    chapterId: null,
    sceneId: null,
    povCharacterId: null,
    locationId: null,
    timeMarker: '',
    plotThreadIds: [],
    referenceIds: [],
    tags: [],
    notes: '',
    ...data,
  });
}

export async function moveCard(cardId: string, laneId: string, index: number) {
  await db.transaction('rw', [db.boardCards, db.changes], async () => {
    const card = await db.boardCards.get(cardId);
    if (!card) return;
    const target = (await db.boardCards.where('laneId').equals(laneId).toArray())
      .filter((c) => !c.archivedAt && c.id !== cardId)
      .sort((a, b) => a.order - b.order)
      .map((c) => c.id);
    target.splice(Math.max(0, Math.min(index, target.length)), 0, cardId);
    if (card.laneId !== laneId) {
      await updateRecord('boardCards', cardId, { laneId });
      const src = (await db.boardCards.where('laneId').equals(card.laneId).toArray())
        .filter((c) => !c.archivedAt)
        .sort((a, b) => a.order - b.order)
        .map((c) => c.id);
      await reorder('boardCards', src);
    }
    await reorder('boardCards', target);
  });
}

/** Convert a board card into a scene (in a chapter), keeping summary/notes/links and linking the card. */
export async function convertCardToScene(cardId: string, chapterId: string) {
  const card = await db.boardCards.get(cardId);
  if (!card) throw new Error('Card not found');
  const scene = await createScene(card.projectId, chapterId, card.title, emptyDoc(), {
    summary: card.summary,
    notes: card.notes,
    povCharacterId: card.povCharacterId,
    locationId: card.locationId,
    timeMarker: card.timeMarker,
    plotThreadIds: card.plotThreadIds,
    status: card.status === 'idea' ? 'planned' : card.status,
  });
  await updateRecord('boardCards', cardId, { sceneId: scene.id, chapterId });
  return scene;
}

/** Convert a board card into a new chapter (with one scene carrying the card's planning data). */
export async function convertCardToChapter(cardId: string) {
  const card = await db.boardCards.get(cardId);
  if (!card) throw new Error('Card not found');
  const chapter = await createChapter(card.projectId, card.bookId, card.title, { withScene: false });
  await updateRecord('chapters', chapter.id, { summary: card.summary });
  const scene = await convertCardToScene(cardId, chapter.id);
  return { chapter, scene };
}

/** Create a board card from an existing scene, linked to it. */
export async function cardFromScene(sceneId: string, laneId: string) {
  const scene = await db.scenes.get(sceneId);
  if (!scene) throw new Error('Scene not found');
  const chapter = await db.chapters.get(scene.chapterId);
  if (!chapter) throw new Error('Chapter not found');
  return createCard(scene.projectId, chapter.bookId, laneId, {
    title: scene.title,
    summary: scene.summary,
    notes: scene.notes,
    chapterId: scene.chapterId,
    sceneId: scene.id,
    povCharacterId: scene.povCharacterId,
    locationId: scene.locationId,
    timeMarker: scene.timeMarker,
    plotThreadIds: scene.plotThreadIds,
    status: scene.status,
  });
}

export type { BoardLane };
