import { db } from './db';
import { snippet } from '../domain/text';
import { referenceText } from '../domain/references';
import { REFERENCE_TYPE_LABELS } from '../domain/referenceTemplates';

export type SearchKind = 'chapter' | 'scene' | 'reference' | 'card' | 'event' | 'thread' | 'note';

export interface SearchResult {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string;
  snippet: string | null;
  /** Where to open: the scene to edit, or the record id within its view. */
  target: { view: 'write' | 'refs' | 'board' | 'timeline' | 'threads' | 'notes'; itemId: string };
  score: number;
}

export interface SearchOptions {
  kinds?: SearchKind[];
  bookId?: string | null;
  status?: string | null;
  tag?: string | null;
  limit?: number;
}

/** Search all local project data. Works offline; manuscript never leaves the device. */
export async function searchProject(projectId: string, query: string, opts: SearchOptions = {}): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const lower = q.toLowerCase();
  const want = (k: SearchKind) => !opts.kinds?.length || opts.kinds.includes(k);
  const hit = (s: string) => s.toLowerCase().includes(lower);
  const out: SearchResult[] = [];

  const [books, chapters, scenes] = await Promise.all([
    db.books.where('projectId').equals(projectId).toArray(),
    db.chapters.where('projectId').equals(projectId).toArray(),
    want('scene') || want('chapter') ? db.scenes.where('projectId').equals(projectId).toArray() : Promise.resolve([]),
  ]);
  const bookTitle = new Map(books.map((b) => [b.id, b.title]));
  const chapterById = new Map(chapters.map((c) => [c.id, c]));
  const firstScene = new Map<string, string>();
  for (const s of scenes.filter((s) => !s.archivedAt).sort((a, b) => a.order - b.order)) {
    if (!firstScene.has(s.chapterId)) firstScene.set(s.chapterId, s.id);
  }

  if (want('chapter')) {
    for (const c of chapters) {
      if (c.archivedAt || (opts.bookId && c.bookId !== opts.bookId) || (opts.status && c.status !== opts.status)) continue;
      if (hit(c.title) || hit(c.summary)) {
        const sid = firstScene.get(c.id);
        if (!sid) continue;
        out.push({ kind: 'chapter', id: c.id, title: c.title, subtitle: bookTitle.get(c.bookId) ?? '', snippet: snippet(c.summary, q), target: { view: 'write', itemId: sid }, score: hit(c.title) ? 3 : 1 });
      }
    }
  }
  if (want('scene')) {
    for (const s of scenes) {
      if (s.archivedAt) continue;
      const ch = chapterById.get(s.chapterId);
      if (!ch || ch.archivedAt) continue;
      if (opts.bookId && ch.bookId !== opts.bookId) continue;
      if (opts.status && s.status !== opts.status) continue;
      const inTitle = hit(s.title);
      const inText = hit(s.plainText);
      const inMeta = hit(s.summary) || hit(s.notes);
      if (!inTitle && !inText && !inMeta) continue;
      const count = inText ? s.plainText.toLowerCase().split(lower).length - 1 : 0;
      out.push({
        kind: 'scene',
        id: s.id,
        title: `${ch.title} › ${s.title}`,
        subtitle: `${bookTitle.get(ch.bookId) ?? ''}${count ? ` · ${count} match${count === 1 ? '' : 'es'}` : ''}`,
        snippet: snippet(s.plainText, q) ?? snippet(s.summary, q) ?? snippet(s.notes, q),
        target: { view: 'write', itemId: s.id },
        score: (inTitle ? 3 : 0) + Math.min(count, 5),
      });
    }
  }
  if (want('reference')) {
    for (const r of await db.references.where('projectId').equals(projectId).toArray()) {
      if (r.archivedAt) continue;
      if (opts.tag && !r.tags.includes(opts.tag)) continue;
      const text = referenceText(r);
      if (!hit(text)) continue;
      out.push({ kind: 'reference', id: r.id, title: r.name, subtitle: REFERENCE_TYPE_LABELS[r.type], snippet: snippet(text, q), target: { view: 'refs', itemId: r.id }, score: hit(r.name) ? 4 : 1 });
    }
  }
  if (want('card')) {
    for (const c of await db.boardCards.where('projectId').equals(projectId).toArray()) {
      if (c.archivedAt || (opts.status && c.status !== opts.status) || (opts.tag && !c.tags.includes(opts.tag))) continue;
      const text = `${c.title}\n${c.summary}\n${c.notes}\n${c.tags.join(' ')}`;
      if (hit(text)) out.push({ kind: 'card', id: c.id, title: c.title, subtitle: `Board card · ${c.type}`, snippet: snippet(text, q), target: { view: 'board', itemId: c.id }, score: hit(c.title) ? 2 : 1 });
    }
  }
  if (want('event')) {
    for (const e of await db.timelineEvents.where('projectId').equals(projectId).toArray()) {
      if (e.archivedAt) continue;
      const text = `${e.title}\n${e.when}\n${e.description}`;
      if (hit(text)) out.push({ kind: 'event', id: e.id, title: e.title, subtitle: `Timeline · ${e.when || 'undated'}`, snippet: snippet(text, q), target: { view: 'timeline', itemId: e.id }, score: 1 });
    }
  }
  if (want('thread')) {
    for (const t of await db.plotThreads.where('projectId').equals(projectId).toArray()) {
      if (t.archivedAt) continue;
      const text = `${t.name}\n${t.description}\n${t.stakes}\n${t.resolution}`;
      if (hit(text)) out.push({ kind: 'thread', id: t.id, title: t.name, subtitle: `Plot thread · ${t.status}`, snippet: snippet(text, q), target: { view: 'threads', itemId: t.id }, score: 2 });
    }
  }
  if (want('note')) {
    for (const n of await db.notes.where('projectId').equals(projectId).toArray()) {
      if (n.archivedAt || (opts.tag && !n.tags.includes(opts.tag))) continue;
      const text = `${n.title}\n${n.body}\n${n.url}\n${n.tags.join(' ')}`;
      if (hit(text)) out.push({ kind: 'note', id: n.id, title: n.title, subtitle: 'Note', snippet: snippet(text, q), target: { view: 'notes', itemId: n.id }, score: hit(n.title) ? 2 : 1 });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 200);
}
