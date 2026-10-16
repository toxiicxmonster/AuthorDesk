import { db } from './db';
import { createRecords, deleteRecord } from './repo';
import { newId } from '../domain/ids';
import { paragraphsOf } from '../proofreading/continuityData';
import { buildProofreadContext, ignoreKey } from '../editor/proofreadRunner';
import { fetchAiStatus } from '../ai/aiEditor';
import { collectPassItems, type PassScene } from '../review/editPass';

const live = <T>(r: T) => !(r as { archivedAt?: string | null }).archivedAt;

/** The scenes of a book (or of one chapter of it), in reading order, as the pass reads them. */
async function passScenes(bookId: string, chapterId: string | null): Promise<PassScene[]> {
  const chapters = (await db.chapters.where('bookId').equals(bookId).toArray()).filter(live).sort((a, b) => a.order - b.order);
  const titles = new Map(chapters.map((c, i) => [c.id, c.title || `Chapter ${i + 1}`]));
  const index = new Map(chapters.map((c, i) => [c.id, i]));
  const wanted = chapterId ? chapters.filter((c) => c.id === chapterId) : chapters;
  const scenes = (await db.scenes.where('chapterId').anyOf(wanted.map((c) => c.id)).toArray())
    .filter(live)
    .sort((a, b) => index.get(a.chapterId)! - index.get(b.chapterId)! || a.order - b.order);
  return scenes.map((s) => ({ sceneId: s.id, chapterId: s.chapterId, chapterTitle: titles.get(s.chapterId) ?? '', paragraphs: paragraphsOf(s.plainText) }));
}

/** Everything an edit pass of a chapter (or the book) would list, leaving out what the author ignored. Saves nothing. */
export async function passDrafts(projectId: string, bookId: string, chapterId: string | null) {
  const [scenes, ctx, ignoredRows, ai] = await Promise.all([
    passScenes(bookId, chapterId),
    buildProofreadContext(projectId),
    db.ignored.where('projectId').equals(projectId).toArray(),
    fetchAiStatus().catch(() => null),
  ]);
  const ignored = new Set(ignoredRows.map((i) => i.key));
  return collectPassItems(scenes, ctx, { aiInstalled: !!ai?.installed, skip: (ruleId, original, context) => ignored.has(ignoreKey(ruleId, original, context)) });
}

/** Starts an edit pass over a book or one chapter: collects its items and saves them as a checklist. */
export async function startEditPass(projectId: string, bookId: string, chapterId: string | null, name: string): Promise<{ passId: string; count: number }> {
  const drafts = await passDrafts(projectId, bookId, chapterId);
  const passId = newId();
  await createRecords(
    'revisions',
    projectId,
    drafts.map((d) => ({ ...d, passId, passName: name, status: 'open' as const, note: '' })),
  );
  return { passId, count: drafts.length };
}

/** Deletes a whole pass (its items only; the manuscript is untouched). */
export async function deleteEditPass(passId: string): Promise<void> {
  const items = await db.revisions.where('passId').equals(passId).toArray();
  for (const it of items) await deleteRecord('revisions', it.id);
}
