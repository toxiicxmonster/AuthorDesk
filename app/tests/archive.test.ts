import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { resetDbForTests, db } from '../src/storage/db';
import { createProject, createRecord, saveSceneContent, createCard } from '../src/storage/repo';
import { createReference } from '../src/domain/references';
import { buildArchive, parseArchive, previewImport, applyImport, remapIds, ArchiveError, collectProject } from '../src/importExport/archive';
import { exportMarkdownZip, exportText, exportReferencesCsv, docToMarkdown } from '../src/importExport/exporters';
import { parseManuscriptText } from '../src/importExport/textImport';
import { plainTextToDoc } from '../src/domain/text';

beforeEach(() => {
  resetDbForTests();
});

async function seed() {
  const { project, book } = await createProject('Round Trip');
  const ch = (await db.chapters.where('bookId').equals(book.id).toArray())[0];
  const sc = (await db.scenes.where('chapterId').equals(ch.id).toArray())[0];
  const elara = await createReference(project.id, 'character', 'Elara', { fields: { role: 'protagonist' } });
  const keep = await createReference(project.id, 'location', 'Kethmoor Keep');
  await db.references.update(elara.id, { links: [{ targetId: keep.id, label: 'home' }] });
  await saveSceneContent(sc.id, {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Elara', marks: [{ type: 'refLink', attrs: { refId: elara.id } }] }, { type: 'text', text: ' returned to the keep.' }] },
    ],
  });
  await db.scenes.update(sc.id, { povCharacterId: elara.id, locationId: keep.id });
  const thread = await createRecord('plotThreads', project.id, { name: 'Revenge', description: '', stakes: '', keyCharacterIds: [elara.id], status: 'open', resolution: '' });
  await db.scenes.update(sc.id, { plotThreadIds: [thread.id] });
  const lane = (await db.boardLanes.where('bookId').equals(book.id).toArray())[0];
  await createCard(project.id, book.id, lane.id, { title: 'Return', sceneId: sc.id, chapterId: ch.id, povCharacterId: elara.id });
  await createRecord('dictionary', project.id, { word: 'Kethmoor' });
  return { project, book, ch, sc, elara, keep, thread };
}

describe('project archive', () => {
  it('round-trips a project into a clean workspace with content and links intact', async () => {
    const s = await seed();
    const original = await collectProject(s.project.id);
    const { bytes, manifest } = await buildArchive(s.project.id);
    expect(manifest.counts.scenes).toBe(1);

    resetDbForTests(); // clean workspace
    const parsed = await parseArchive(bytes);
    const preview = await previewImport(parsed);
    expect(preview.projectExists).toBe(false);
    const report = await applyImport(parsed, 'restore');
    expect(report.projectId).toBe(s.project.id);

    const restored = await collectProject(s.project.id);
    for (const t of Object.keys(original) as (keyof typeof original)[]) {
      expect(restored[t].length).toBe(original[t].length);
    }
    const scene = await db.scenes.get(s.sc.id);
    expect(scene?.plainText).toBe('Elara returned to the keep.');
    expect(scene?.referenceIds).toEqual([s.elara.id]);
    expect(scene?.povCharacterId).toBe(s.elara.id);
    expect(scene?.plotThreadIds).toEqual([s.thread.id]);
    expect((await db.references.get(s.elara.id))?.links[0].targetId).toBe(s.keep.id);
  });

  it('imports as a copy with fresh ids and consistent relationships', async () => {
    const s = await seed();
    const { bytes } = await buildArchive(s.project.id);
    const report = await applyImport(await parseArchive(bytes), 'copy');
    expect(report.projectId).not.toBe(s.project.id);
    const copy = await collectProject(report.projectId);
    const scene = copy.scenes[0];
    const elara = copy.references.find((r) => r.name === 'Elara')!;
    const keep = copy.references.find((r) => r.name === 'Kethmoor Keep')!;
    expect(elara.id).not.toBe(s.elara.id);
    expect(scene.referenceIds).toEqual([elara.id]);
    expect(scene.povCharacterId).toBe(elara.id);
    expect(scene.locationId).toBe(keep.id);
    expect(JSON.stringify(scene.content)).toContain(elara.id);
    expect(copy.boardCards[0].sceneId).toBe(scene.id);
    expect(copy.plotThreads[0].keyCharacterIds).toEqual([elara.id]);
    // Original untouched
    expect((await db.scenes.get(s.sc.id))?.projectId).toBe(s.project.id);
  });

  it('refuses a plain restore over an existing project and merges safely', async () => {
    const s = await seed();
    const { bytes } = await buildArchive(s.project.id);
    const parsed = await parseArchive(bytes);
    await expect(applyImport(parsed, 'restore')).rejects.toBeInstanceOf(ArchiveError);

    // Local edit after export; merge with keep-existing must not overwrite it.
    await saveSceneContent(s.sc.id, plainTextToDoc('Newer local text.'));
    const preview = await previewImport(parsed);
    expect(preview.perTable.find((t) => t.table === 'scenes')?.differs).toBe(1);
    await applyImport(parsed, 'merge', 'keep-existing');
    expect((await db.scenes.get(s.sc.id))?.plainText).toBe('Newer local text.');

    // use-imported replaces but snapshots the local version first.
    await applyImport(parsed, 'merge', 'use-imported');
    expect((await db.scenes.get(s.sc.id))?.plainText).toBe('Elara returned to the keep.');
    const snaps = await db.snapshots.where('sceneId').equals(s.sc.id).toArray();
    expect(snaps.some((x) => x.plainText === 'Newer local text.')).toBe(true);
  });

  it('keeps both versions when asked', async () => {
    const s = await seed();
    const { bytes } = await buildArchive(s.project.id);
    await saveSceneContent(s.sc.id, plainTextToDoc('Changed.'));
    const r = await applyImport(await parseArchive(bytes), 'merge', 'keep-both');
    expect(r.copied).toBeGreaterThan(0);
    const scenes = await db.scenes.where('chapterId').equals(s.ch.id).toArray();
    expect(scenes.map((x) => x.plainText).sort()).toEqual(['Changed.', 'Elara returned to the keep.']);
  });

  it('rejects tampered or malformed archives', async () => {
    const s = await seed();
    const { bytes } = await buildArchive(s.project.id);
    const files = unzipSync(bytes);
    const scenes = JSON.parse(strFromU8(files['data/scenes.json']));
    scenes[0].plainText = 'tampered';
    files['data/scenes.json'] = strToU8(JSON.stringify(scenes));
    await expect(parseArchive(zipSync(files))).rejects.toThrow(/Integrity check failed/);
    await expect(parseArchive(strToU8('not a zip'))).rejects.toThrow(/not a zip/);
    await expect(parseArchive(zipSync({ 'hello.txt': strToU8('x') }))).rejects.toThrow(/manifest/);
  });

  it('skips unsafe paths and invalid records with warnings', async () => {
    const s = await seed();
    const { bytes } = await buildArchive(s.project.id);
    const files = unzipSync(bytes);
    files['../evil.json'] = strToU8('{}');
    const parsed = await parseArchive(zipSync(files));
    expect(parsed.warnings.join(' ')).toMatch(/unsafe path/);
  });

  it('remaps ids deeply', () => {
    const map = new Map([['a', 'x']]);
    expect(remapIds({ id: 'a', list: ['a', 'b'], nested: { ref: 'a', text: 'a cat' } }, map)).toEqual({ id: 'x', list: ['x', 'b'], nested: { ref: 'x', text: 'a cat' } });
  });
});

describe('other exports', () => {
  it('exports markdown, text and csv', async () => {
    const s = await seed();
    const md = unzipSync(await exportMarkdownZip(s.project.id));
    const names = Object.keys(md);
    expect(names.some((n) => n.endsWith('01 - Chapter 1.md'))).toBe(true);
    expect(names.some((n) => n.includes('References/Character/Elara.md'))).toBe(true);
    const txt = await exportText(s.project.id, s.book.id);
    expect(txt).toContain('Elara returned to the keep.');
    const csv = await exportReferencesCsv(s.project.id);
    expect(csv).toContain('Elara');
    expect(csv.split('\r\n')[0]).toContain('role');
  });

  it('neutralises spreadsheet formulas in CSV', async () => {
    const { project } = await createProject('P');
    await createReference(project.id, 'character', '=HYPERLINK("x")');
    expect(await exportReferencesCsv(project.id)).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it('converts docs to markdown', () => {
    expect(
      docToMarkdown({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Bold', marks: [{ type: 'bold' }] }, { type: 'text', text: ' and ' }, { type: 'text', text: 'it', marks: [{ type: 'italic' }] }] },
          { type: 'horizontalRule' },
          { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'q' }] }] },
        ],
      }),
    ).toBe('**Bold** and *it*\n\n* * *\n\n> q');
  });
});

describe('text import', () => {
  it('splits chapters on headings and Chapter lines', () => {
    const r = parseManuscriptText('# Prologue\n\nIt began.\n\nChapter 1\n\nShe *ran*.\n\n* * *\n\nLater.');
    expect(r.map((c) => c.title)).toEqual(['Prologue', 'Chapter 1']);
    expect(r[1].doc.content?.[1]).toEqual({ type: 'horizontalRule' });
    expect(JSON.stringify(r[1].doc)).toContain('"italic"');
  });
  it('handles text with no chapter markers', () => {
    const r = parseManuscriptText('Line one\nLine two', 'My file');
    expect(r).toHaveLength(1);
    expect(r[0].title).toBe('My file');
    expect(r[0].doc.content).toHaveLength(2);
  });
});
