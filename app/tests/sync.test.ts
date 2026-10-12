// @vitest-environment node
import 'fake-indexeddb/auto';
import { AuthorDb, setDbForTests, db } from '../src/storage/db';
import { createProject, saveSceneContent, updateRecord, createChapter, deleteRecord } from '../src/storage/repo';
import { createReference } from '../src/domain/references';
import { syncOnce, resolveConflict, type SyncTransport } from '../src/sync/engine';
import { plainTextToDoc } from '../src/domain/text';
// The real server store, in memory.
import { openStore } from '../../server/store.js';

type Store = ReturnType<typeof openStore>;

function transportFor(store: Store, userId: number, opts: { failPushOnce?: boolean } = {}): SyncTransport {
  let failed = false;
  return {
    async pull(since) {
      return JSON.parse(JSON.stringify(store.pull(userId, since)));
    },
    async push(changes, device) {
      if (opts.failPushOnce && !failed) {
        failed = true;
        throw new Error('network dropped');
      }
      return JSON.parse(JSON.stringify(store.push(userId, JSON.parse(JSON.stringify(changes)), device)));
    },
  };
}

let store: Store;
let pc: AuthorDb;
let phone: AuthorDb;
let userId: number;

const on = (device: AuthorDb) => setDbForTests(device);

beforeEach(() => {
  store = openStore(':memory:');
  store.addUser('author', 'correct horse battery');
  userId = store.listUsers()[0].id;
  pc = new AuthorDb(`pc-${Math.random()}`);
  phone = new AuthorDb(`phone-${Math.random()}`);
});

afterEach(() => store.close());

async function firstScene() {
  const s = (await db.scenes.toArray()).filter((x) => !x.archivedAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return s[0];
}

describe('two-device sync', () => {
  it('moves a chapter written on the PC to the phone', async () => {
    on(pc);
    const { project } = await createProject('Shared Book');
    const sc = await firstScene();
    await saveSceneContent(sc.id, plainTextToDoc('Written on the PC.'));
    await createReference(project.id, 'character', 'Elara');
    const r1 = await syncOnce(transportFor(store, userId));
    expect(r1.pushed).toBeGreaterThan(5);
    expect(await db.changes.count()).toBe(0);

    on(phone);
    await syncOnce(transportFor(store, userId));
    expect((await db.projects.get(project.id))?.name).toBe('Shared Book');
    expect((await db.scenes.get(sc.id))?.plainText).toBe('Written on the PC.');
    expect((await db.references.toArray()).map((r) => r.name)).toEqual(['Elara']);
    // Snapshots stay local
    expect(await db.snapshots.count()).toBe(0);
  });

  it('merges independent edits to different records and fields automatically', async () => {
    on(pc);
    const { project, book } = await createProject('B');
    const sc = await firstScene();
    await syncOnce(transportFor(store, userId));
    on(phone);
    await syncOnce(transportFor(store, userId));

    on(pc);
    await saveSceneContent(sc.id, plainTextToDoc('PC prose.'));
    on(phone);
    await updateRecord('scenes', sc.id, { summary: 'Phone summary' });
    await createChapter(project.id, book.id, 'Phone chapter');

    on(pc);
    await syncOnce(transportFor(store, userId));
    on(phone);
    const r = await syncOnce(transportFor(store, userId));
    expect(r.conflicts).toBe(0);
    const phoneScene = await db.scenes.get(sc.id);
    expect(phoneScene?.plainText).toBe('PC prose.');
    expect(phoneScene?.summary).toBe('Phone summary');

    on(pc);
    await syncOnce(transportFor(store, userId));
    const pcScene = await db.scenes.get(sc.id);
    expect(pcScene?.summary).toBe('Phone summary');
    expect(pcScene?.plainText).toBe('PC prose.');
    expect((await db.chapters.toArray()).map((c) => c.title).sort()).toEqual(['Chapter 1', 'Phone chapter']);
  });

  it('never loses either version when the same prose is edited on both devices', async () => {
    on(pc);
    await createProject('C');
    const sc = await firstScene();
    await saveSceneContent(sc.id, plainTextToDoc('Original.'));
    await syncOnce(transportFor(store, userId));
    on(phone);
    await syncOnce(transportFor(store, userId));

    on(pc);
    await saveSceneContent(sc.id, plainTextToDoc('PC rewrite.'));
    on(phone);
    await saveSceneContent(sc.id, plainTextToDoc('Phone rewrite.'));

    on(pc);
    await syncOnce(transportFor(store, userId));
    on(phone);
    const r = await syncOnce(transportFor(store, userId));
    expect(r.conflicts).toBe(1);
    // Phone keeps its own text, and the PC version is preserved in a snapshot and a conflict entry.
    expect((await db.scenes.get(sc.id))?.plainText).toBe('Phone rewrite.');
    const snaps = await db.snapshots.where('sceneId').equals(sc.id).toArray();
    expect(snaps.some((s) => s.plainText === 'PC rewrite.')).toBe(true);
    const [conflict] = await db.conflicts.toArray();
    expect(conflict.other.plainText).toBe('PC rewrite.');

    // Keep both: the PC version becomes its own scene next to the phone version.
    await resolveConflict(conflict.id, 'both');
    await syncOnce(transportFor(store, userId));
    const texts = (await db.scenes.toArray()).map((s) => s.plainText).sort();
    expect(texts).toEqual(['PC rewrite.', 'Phone rewrite.']);

    on(pc);
    await syncOnce(transportFor(store, userId));
    expect((await db.scenes.toArray()).map((s) => s.plainText).sort()).toEqual(['PC rewrite.', 'Phone rewrite.']);
    // The PC's overwritten text also stays recoverable on the PC.
    expect((await db.snapshots.where('sceneId').equals(sc.id).toArray()).some((s) => s.plainText === 'PC rewrite.')).toBe(true);
  });

  it('can take the other version when resolving', async () => {
    on(pc);
    await createProject('D');
    const sc = await firstScene();
    await syncOnce(transportFor(store, userId));
    on(phone);
    await syncOnce(transportFor(store, userId));
    on(pc);
    await saveSceneContent(sc.id, plainTextToDoc('PC text.'));
    await syncOnce(transportFor(store, userId));
    on(phone);
    await saveSceneContent(sc.id, plainTextToDoc('Phone text.'));
    await syncOnce(transportFor(store, userId));
    const [c] = await db.conflicts.toArray();
    await resolveConflict(c.id, 'theirs');
    expect((await db.scenes.get(sc.id))?.plainText).toBe('PC text.');
    await syncOnce(transportFor(store, userId));
    on(pc);
    await syncOnce(transportFor(store, userId));
    expect((await db.scenes.get(sc.id))?.plainText).toBe('PC text.');
  });

  it('keeps an edit when the other device deleted the record', async () => {
    on(pc);
    const { project } = await createProject('E');
    const ref = await createReference(project.id, 'character', 'Marcus');
    await syncOnce(transportFor(store, userId));
    on(phone);
    await syncOnce(transportFor(store, userId));
    on(pc);
    await deleteRecord('references', ref.id);
    await syncOnce(transportFor(store, userId));
    on(phone);
    await updateRecord('references', ref.id, { summary: 'Edited on phone' });
    await syncOnce(transportFor(store, userId));
    expect((await db.references.get(ref.id))?.summary).toBe('Edited on phone');
    on(pc);
    await syncOnce(transportFor(store, userId));
    expect((await db.references.get(ref.id))?.summary).toBe('Edited on phone');
  });

  it('recovers from an interrupted upload without duplicating or losing data', async () => {
    on(pc);
    await createProject('F');
    const sc = await firstScene();
    await saveSceneContent(sc.id, plainTextToDoc('Before drop.'));
    await expect(syncOnce(transportFor(store, userId, { failPushOnce: true }))).rejects.toThrow('network dropped');
    expect(await db.changes.count()).toBeGreaterThan(0);
    await syncOnce(transportFor(store, userId));
    expect(await db.changes.count()).toBe(0);
    on(phone);
    await syncOnce(transportFor(store, userId));
    expect((await db.scenes.get(sc.id))?.plainText).toBe('Before drop.');
    expect(await db.scenes.count()).toBe(1);
  });
});

describe('sync server store', () => {
  it('rejects a push based on an outdated version', () => {
    const rec = { table: 'notes', id: 'n1', projectId: 'p', rev: 1, deleted: false, data: { id: 'n1' } };
    const a = store.push(userId, [{ record: rec, baseVersion: null }]);
    expect(a.accepted).toHaveLength(1);
    const v = a.accepted[0].serverVersion;
    expect(store.push(userId, [{ record: { ...rec, rev: 2 }, baseVersion: v }]).accepted).toHaveLength(1);
    const stale = store.push(userId, [{ record: { ...rec, rev: 3 }, baseVersion: v }]);
    expect(stale.rejected).toHaveLength(1);
    expect(stale.rejected[0].current.rev).toBe(2);
  });

  it('isolates users and authenticates with sessions', () => {
    store.addUser('other', 'another long passphrase');
    const other = store.listUsers().find((u: { username: string }) => u.username === 'other')!.id;
    store.push(userId, [{ record: { table: 'notes', id: 'n1', projectId: 'p', rev: 1, deleted: false, data: {} }, baseVersion: null }]);
    expect(store.pull(other, '0').records).toHaveLength(0);
    expect(store.login('author', 'wrong password!')).toBeNull();
    const token = store.login('author', 'correct horse battery');
    expect(store.session(token)?.username).toBe('author');
    store.logout(token);
    expect(store.session(token)).toBeNull();
  });

  it('rejects unknown tables and short passphrases', () => {
    expect(() => store.push(userId, [{ record: { table: 'users', id: 'x', projectId: 'p', rev: 1, deleted: false, data: {} }, baseVersion: null }])).toThrow();
    expect(() => store.addUser('weak', 'short')).toThrow();
  });
});
