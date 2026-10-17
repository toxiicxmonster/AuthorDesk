import { threeWayMerge, resolveDeleteEdit } from '../src/sync/merge';
import { continuityFlags, chronological, threadAppearances } from '../src/domain/continuity';
import { likelyDuplicates, detectMentions } from '../src/domain/references';
import { projectSchema, sceneSchema } from '../src/domain/schema';
import type { Chapter, PlotThread, ReferenceEntry, Scene, TimelineEvent } from '../src/domain/schema';
import { parseHash, href } from '../src/ui/router';

const base = { projectId: 'p', createdAt: '2026-01-01', updatedAt: '2026-01-01', archivedAt: null, rev: 1 };

describe('sync merge', () => {
  const b = { id: 'x', title: 'A', summary: 'S', content: { t: 1 }, rev: 1 };
  it('takes remote when only remote changed', () => {
    expect(threeWayMerge(b, { ...b }, { ...b, title: 'B', rev: 2 }).kind).toBe('take-remote');
  });
  it('keeps local when only local changed', () => {
    expect(threeWayMerge(b, { ...b, title: 'L', rev: 2 }, { ...b }).kind).toBe('keep-local');
  });
  it('merges independent field edits', () => {
    const r = threeWayMerge(b, { ...b, title: 'L' }, { ...b, summary: 'R' });
    expect(r).toEqual({ kind: 'merged', result: expect.objectContaining({ title: 'L', summary: 'R' }) });
  });
  it('reports a conflict when both edit the prose, never silently dropping either', () => {
    const r = threeWayMerge(b, { ...b, content: { t: 2 } }, { ...b, content: { t: 3 } });
    expect(r.kind).toBe('conflict');
    if (r.kind === 'conflict') expect(r.conflictingFields).toEqual(['content']);
  });
  it('ignores metadata-only differences', () => {
    expect(threeWayMerge(b, { ...b, rev: 5, updatedAt: 'x' }, { ...b, rev: 9 }).kind).toBe('take-remote');
  });
  it('lets edits win over deletes', () => {
    expect(resolveDeleteEdit(true, false, false, true)).toBe('restore-remote');
    expect(resolveDeleteEdit(false, true, true, false)).toBe('keep-local');
    expect(resolveDeleteEdit(true, false, false, false)).toBe('delete');
  });
});

const ev = (over: Partial<TimelineEvent>): TimelineEvent =>
  ({ ...base, id: Math.random().toString(), bookId: null, title: 'e', when: '', sortKey: null, description: '', characterIds: [], locationId: null, chapterId: null, sceneId: null, plotThreadIds: [], ...over }) as TimelineEvent;

describe('continuity', () => {
  it('flags a character in two places at once', () => {
    const flags = continuityFlags([ev({ sortKey: 5, characterIds: ['c'], locationId: 'L1' }), ev({ sortKey: 5, characterIds: ['c'], locationId: 'L2' })], []);
    expect(flags).toHaveLength(1);
    expect(flags[0].locations.sort()).toEqual(['L1', 'L2']);
  });
  it('does not flag different times or same place', () => {
    expect(continuityFlags([ev({ sortKey: 5, characterIds: ['c'], locationId: 'L1' }), ev({ sortKey: 6, characterIds: ['c'], locationId: 'L2' })], [])).toHaveLength(0);
    expect(continuityFlags([ev({ when: 'Dawn', characterIds: ['c'], locationId: 'L1' }), ev({ when: 'dawn', characterIds: ['c'], locationId: 'L1' })], [])).toHaveLength(0);
  });
  it('orders events with unknown dates last', () => {
    const a = ev({ sortKey: 2, title: 'a' });
    const u = ev({ title: 'u' });
    const c = ev({ sortKey: 1, title: 'c' });
    expect(chronological([a, u, c]).map((e) => e.title)).toEqual(['c', 'a', 'u']);
  });
  it('flags quiet plot threads only for review', () => {
    const chapters = Array.from({ length: 8 }, (_, i) => ({ ...base, id: `ch${i}`, order: i }) as unknown as Chapter);
    const scenes = [{ ...base, id: 's', chapterId: 'ch1', plotThreadIds: ['t1'] } as unknown as Scene];
    const threads = [{ ...base, id: 't1', status: 'open' } as PlotThread, { ...base, id: 't2', status: 'open' } as PlotThread];
    const r = threadAppearances(threads, chapters, scenes, [], 5);
    expect(r[0]).toMatchObject({ chapters: [1], gap: 6, stale: true });
    expect(r[1].stale).toBe(false); // never appeared: not "abandoned", just unplaced
  });
  it('doesn’t count chapters that aren’t written yet toward a quiet stretch', () => {
    const chapters = Array.from({ length: 8 }, (_, i) => ({ ...base, id: `ch${i}`, order: i }) as unknown as Chapter);
    const scenes = [{ ...base, id: 's', chapterId: 'ch1', plotThreadIds: ['t1'] } as unknown as Scene];
    const threads = [{ ...base, id: 't1', status: 'open' } as PlotThread];
    expect(threadAppearances(threads, chapters, scenes, [], 5, new Set([0, 1, 2, 3]))[0]).toMatchObject({ gap: 2, stale: false });
    expect(threadAppearances(threads, chapters, scenes, [], 5, new Set([0, 1, 2, 3, 4, 5, 6, 7]))[0]).toMatchObject({ gap: 6, stale: true });
  });
});

const ref = (name: string, aliases: string[] = []): ReferenceEntry =>
  ({ ...base, id: name, type: 'character', name, aliases, summary: '', fields: {}, tags: [], favorite: false, status: '', links: [], notes: '', image: '' }) as ReferenceEntry;

describe('references', () => {
  it('warns about likely duplicates without blocking', () => {
    const all = [ref('Elara'), ref('Marcus')];
    expect(likelyDuplicates({ id: 'new', name: 'Elarra', aliases: [] }, all).map((r) => r.name)).toEqual(['Elara']);
    expect(likelyDuplicates({ id: 'new', name: 'Bob', aliases: [] }, all)).toHaveLength(0);
  });
  it('detects unlinked mentions by name or alias as whole words', () => {
    const r = detectMentions('Elara met the Captain. Elaras? No.', [ref('Elara'), ref('Marcus', ['the Captain'])], []);
    expect(r.map((x) => [x.ref.name, x.count])).toEqual([
      ['Elara', 1],
      ['Marcus', 1],
    ]);
  });
});

describe('schema validation', () => {
  it('fills defaults and preserves unknown fields from newer versions', () => {
    const p = projectSchema.parse({ id: 'p', projectId: 'p', createdAt: 'x', updatedAt: 'x', name: 'N', futureField: 42 });
    expect(p.kind).toBe('book');
    expect((p as Record<string, unknown>).futureField).toBe(42);
  });
  it('rejects records missing required fields', () => {
    expect(sceneSchema.safeParse({ id: 's' }).success).toBe(false);
  });
});

describe('router', () => {
  it('parses and builds hashes', () => {
    expect(parseHash('#/p/abc/write/s1?find=x')).toMatchObject({ projectId: 'abc', view: 'write', itemId: 's1' });
    expect(parseHash('#/')).toMatchObject({ projectId: null, view: 'home' });
    expect(href('abc', 'refs', 'r1')).toBe('#/p/abc/refs/r1');
  });
});
