import { backUpNow, backupDue, MAX_WAIT_MS, MIN_GAP_MS, QUIET_MS, shortId } from '../src/backup/autoBackup';
import { lastChangeAt, resetChanges } from '../src/backup/lastChange';
import { resetDbForTests } from '../src/storage/db';
import { createProject, createRecord } from '../src/storage/repo';
import { getSettings } from '../src/storage/settings';

const MIN = 60_000;

describe('when to back up', () => {
  const now = 10_000 * MIN;
  it('backs up a book that has never been backed up', () => {
    expect(backupDue(now, 0, 0)).toBe(true);
  });
  it('waits for a pause in writing', () => {
    const last = now - 30 * MIN;
    expect(backupDue(now, last, now - 30_000)).toBe(false); // still typing
    expect(backupDue(now, last, now - QUIET_MS)).toBe(true); // paused
  });
  it('still backs up hourly during a long session', () => {
    expect(backupDue(now, now - MAX_WAIT_MS, now - 1000)).toBe(true);
  });
  it('does nothing when nothing changed, and never too often', () => {
    expect(backupDue(now, now - 3 * 60 * MIN, now - 4 * 60 * MIN)).toBe(false);
    expect(backupDue(now, now - (MIN_GAP_MS - 1000), now - QUIET_MS - 1)).toBe(false);
  });
  it('names book folders by a short, file-safe id', () => {
    expect(shortId('0c41c941-c1db-4a34-ab66-324a3d589cb3')).toBe('0c41c941');
  });
});

describe('backing up', () => {
  beforeEach(() => {
    resetDbForTests();
    resetChanges();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('notices edits to a book', async () => {
    const { project } = await createProject('Salt Road');
    expect(lastChangeAt(project.id)).toBeGreaterThan(0);
    const before = lastChangeAt(project.id);
    await new Promise((r) => setTimeout(r, 5));
    await createRecord('notes', project.id, { title: 'n', body: '', url: '', tags: [], referenceIds: [] });
    expect(lastChangeAt(project.id)).toBeGreaterThan(before);
  });

  it('sends a real archive to the launcher and counts it as a backup', async () => {
    const { project } = await createProject('Salt Road');
    let sent: { url: string; body: Uint8Array } | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        sent = { url, body: init?.body as Uint8Array };
        return new Response(JSON.stringify({ enabled: true, folder: 'C:\b', books: {} }), { headers: { 'Content-Type': 'application/json' } });
      }),
    );
    await backUpNow(project.id);
    expect(sent!.url).toBe(`/backup/save?project=${project.id}&title=Salt%20Road`);
    expect(String.fromCharCode(sent!.body[0], sent!.body[1])).toBe('PK'); // a zip (.authorproj)
    expect((await getSettings()).lastBackupAt).not.toBeNull();
  });

  it('reports the launcher’s reason when a backup can’t be saved', async () => {
    const { project } = await createProject('Salt Road');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Not enough free space for backups.' }), { status: 507 })));
    await expect(backUpNow(project.id)).rejects.toThrow('Not enough free space');
  });
});
