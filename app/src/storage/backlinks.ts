import { db } from './db';
import { updateRecord } from './repo';
import { countMentions } from '../domain/references';
import { snippet } from '../domain/text';
import type { ReferenceEntry } from '../domain/schema';

export interface Backlink {
  kind: 'scene' | 'card' | 'event' | 'note' | 'reference' | 'thread';
  id: string;
  title: string;
  /** Linked explicitly by id, or just mentioned by name in text. */
  how: 'linked' | 'mentioned' | 'field';
  detail?: string;
  /** For scenes: chapter id to open. */
  sceneId?: string;
}

/** Everything that links to or mentions a reference entry. */
export async function referenceBacklinks(ref: ReferenceEntry): Promise<Backlink[]> {
  const pid = ref.projectId;
  const [scenes, chapters, cards, events, notes, refs, threads] = await Promise.all([
    db.scenes.where('projectId').equals(pid).toArray(),
    db.chapters.where('projectId').equals(pid).toArray(),
    db.boardCards.where('projectId').equals(pid).toArray(),
    db.timelineEvents.where('projectId').equals(pid).toArray(),
    db.notes.where('projectId').equals(pid).toArray(),
    db.references.where('projectId').equals(pid).toArray(),
    db.plotThreads.where('projectId').equals(pid).toArray(),
  ]);
  const chapterTitle = new Map(chapters.map((c) => [c.id, c.title]));
  const out: Backlink[] = [];
  for (const s of scenes) {
    if (s.archivedAt) continue;
    const title = `${chapterTitle.get(s.chapterId) ?? '?'} › ${s.title}`;
    if (s.referenceIds.includes(ref.id)) out.push({ kind: 'scene', id: s.id, sceneId: s.id, title, how: 'linked' });
    else if (s.povCharacterId === ref.id) out.push({ kind: 'scene', id: s.id, sceneId: s.id, title, how: 'field', detail: 'POV' });
    else if (s.locationId === ref.id) out.push({ kind: 'scene', id: s.id, sceneId: s.id, title, how: 'field', detail: 'Location' });
    else {
      const n = countMentions(s.plainText, ref);
      if (n) out.push({ kind: 'scene', id: s.id, sceneId: s.id, title, how: 'mentioned', detail: `${n}×` + (snippet(s.plainText, ref.name, 40) ? ` — ${snippet(s.plainText, ref.name, 40)}` : '') });
    }
  }
  for (const c of cards) {
    if (c.archivedAt) continue;
    if (c.referenceIds.includes(ref.id) || c.povCharacterId === ref.id || c.locationId === ref.id)
      out.push({ kind: 'card', id: c.id, title: c.title, how: 'linked' });
    else if (countMentions(`${c.title}\n${c.summary}\n${c.notes}`, ref)) out.push({ kind: 'card', id: c.id, title: c.title, how: 'mentioned' });
  }
  for (const e of events) {
    if (e.archivedAt) continue;
    if (e.characterIds.includes(ref.id) || e.locationId === ref.id) out.push({ kind: 'event', id: e.id, title: e.title, how: 'linked' });
  }
  for (const n of notes) {
    if (n.archivedAt) continue;
    if (n.referenceIds.includes(ref.id)) out.push({ kind: 'note', id: n.id, title: n.title, how: 'linked' });
    else if (countMentions(`${n.title}\n${n.body}`, ref)) out.push({ kind: 'note', id: n.id, title: n.title, how: 'mentioned' });
  }
  for (const r of refs) {
    if (r.id === ref.id || r.archivedAt) continue;
    const link = r.links.find((l) => l.targetId === ref.id);
    if (link) out.push({ kind: 'reference', id: r.id, title: r.name, how: 'linked', detail: link.label ? `lists this as “${link.label}”` : '' });
  }
  for (const t of threads) {
    if (!t.archivedAt && t.keyCharacterIds.includes(ref.id)) out.push({ kind: 'thread', id: t.id, title: t.name, how: 'linked' });
  }
  return out;
}

/** Count of explicit links that would break if this reference were deleted. */
export async function explicitLinkCount(ref: ReferenceEntry): Promise<number> {
  return (await referenceBacklinks(ref)).filter((b) => b.how !== 'mentioned').length;
}

/** Remove all id-based links to a reference (used when the author chooses to delete it permanently). */
export async function unlinkReferenceEverywhere(refId: string, projectId: string) {
  const strip = <T extends { type?: string; marks?: { type: string; attrs?: Record<string, unknown> }[]; content?: T[] }>(n: T): T => ({
    ...n,
    marks: n.marks?.filter((m) => !(m.type === 'refLink' && m.attrs?.refId === refId)),
    content: n.content?.map(strip),
  });
  for (const s of await db.scenes.where('projectId').equals(projectId).toArray()) {
    const patch: Record<string, unknown> = {};
    if (s.referenceIds.includes(refId)) {
      patch.content = strip(s.content as never);
      patch.referenceIds = s.referenceIds.filter((x) => x !== refId);
    }
    if (s.povCharacterId === refId) patch.povCharacterId = null;
    if (s.locationId === refId) patch.locationId = null;
    if (Object.keys(patch).length) await updateRecord('scenes', s.id, patch);
  }
  for (const c of await db.boardCards.where('projectId').equals(projectId).toArray()) {
    if (c.referenceIds.includes(refId) || c.povCharacterId === refId || c.locationId === refId)
      await updateRecord('boardCards', c.id, {
        referenceIds: c.referenceIds.filter((x) => x !== refId),
        povCharacterId: c.povCharacterId === refId ? null : c.povCharacterId,
        locationId: c.locationId === refId ? null : c.locationId,
      });
  }
  for (const e of await db.timelineEvents.where('projectId').equals(projectId).toArray()) {
    if (e.characterIds.includes(refId) || e.locationId === refId)
      await updateRecord('timelineEvents', e.id, {
        characterIds: e.characterIds.filter((x) => x !== refId),
        locationId: e.locationId === refId ? null : e.locationId,
      });
  }
  for (const n of await db.notes.where('projectId').equals(projectId).toArray()) {
    if (n.referenceIds.includes(refId)) await updateRecord('notes', n.id, { referenceIds: n.referenceIds.filter((x) => x !== refId) });
  }
  for (const r of await db.references.where('projectId').equals(projectId).toArray()) {
    if (r.links.some((l) => l.targetId === refId)) await updateRecord('references', r.id, { links: r.links.filter((l) => l.targetId !== refId) });
  }
  for (const t of await db.plotThreads.where('projectId').equals(projectId).toArray()) {
    if (t.keyCharacterIds.includes(refId)) await updateRecord('plotThreads', t.id, { keyCharacterIds: t.keyCharacterIds.filter((x) => x !== refId) });
  }
}
