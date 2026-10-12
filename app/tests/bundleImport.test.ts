import { zipSync, strToU8, unzipSync } from 'fflate';
import { parseCsv, readSheet, splitList, detectDelimiter } from '../src/importExport/csv';
import {
  buildImportPlan,
  applyImportPlan,
  chapterFromFile,
  chaptersFromManuscript,
  refFromMarkdown,
  filesFromZip,
  stripCommonRoot,
  templateFiles,
  starterTemplateZip,
} from '../src/importExport/bundleImport';
import { resetDbForTests, db } from '../src/storage/db';
import { createProject } from '../src/storage/repo';
import { createReference } from '../src/domain/references';

describe('CSV reading', () => {
  it('handles quotes, embedded commas, newlines and doubled quotes', () => {
    const rows = parseCsv('Name,Notes\r\n"Quill, Mara","She said ""no"".\nTwice."\r\nTobias,\r\n\r\n');
    expect(rows).toEqual([
      ['Name', 'Notes'],
      ['Quill, Mara', 'She said "no".\nTwice.'],
      ['Tobias', ''],
    ]);
  });
  it('detects semicolon and tab separated files (European Excel, TSV)', () => {
    expect(detectDelimiter('Name;Role\nA;B')).toBe(';');
    expect(parseCsv('Name\tRole\nMara\tLead')[1]).toEqual(['Mara', 'Lead']);
  });
  it('strips a byte-order mark and normalises headings', () => {
    const sheet = readSheet(String.fromCharCode(0xfeff) + 'Also Known As,Name\nMara;Quill,Mara Quill');
    expect(sheet.rows[0]).toEqual({ alsoknownas: 'Mara;Quill', name: 'Mara Quill' });
  });
  it('splits lists on semicolons (and commas only when allowed)', () => {
    expect(splitList('a; b | c')).toEqual(['a', 'b', 'c']);
    expect(splitList('Smith, John')).toEqual(['Smith, John']);
    expect(splitList('x, y', true)).toEqual(['x', 'y']);
  });
});

describe('chapter files', () => {
  it('uses # as the chapter title and ## as scene titles', () => {
    const c = chapterFromFile('# The Lamp\n\n## Steps\n\nOne.\n\nTwo *it*.\n\n* * *\n\nThree.\n\n## Quay\n\nFour.', 'chapters/01 - x.md');
    expect(c.title).toBe('The Lamp');
    expect(c.scenes.map((s) => s.title)).toEqual(['Steps', 'Quay']);
    expect(c.scenes[0].doc.content?.map((n: { type: string }) => n.type)).toEqual(['paragraph', 'paragraph', 'horizontalRule', 'paragraph']);
    expect(JSON.stringify(c.scenes[0].doc)).toContain('"italic"');
  });
  it('takes a short first line as the title in plain text, else the file name', () => {
    expect(chapterFromFile('Below\n\nThe tunnel.', 'chapters/02 - Below.txt').title).toBe('Below');
    const noTitle = chapterFromFile('It was dark. Very dark.\n\nThen light.', 'chapters/07 - The Storm.txt');
    expect(noTitle.title).toBe('The Storm');
    expect(noTitle.scenes[0].doc.content).toHaveLength(2);
  });
  it('splits a single manuscript file into chapters', () => {
    const cs = chaptersFromManuscript('Prologue\n\nBefore.\n\n# One\n\nA.\n\nChapter Two\n\nB.', 'manuscript.md');
    expect(cs.map((c) => c.title)).toEqual(['Prologue', 'One', 'Chapter Two']);
  });
});

describe('profile files', () => {
  it('reads Key: value lines then notes', () => {
    const r = refFromMarkdown('# Elsie\n\nAlso known as: Old Elsie; the net-mender\nRole: Minor\nLooks: Small\nFavourite food: Eels\n\nShe saw: everything.', 'characters/Elsie.md', 'character', 'x');
    expect(r).toMatchObject({ name: 'Elsie', aliases: ['Old Elsie', 'the net-mender'], fields: { role: 'Minor', appearance: 'Small', 'Favourite food': 'Eels' }, notes: 'She saw: everything.' });
  });
});

describe('the documented template', () => {
  it('parses with no warnings and finds every kind of content', () => {
    const files = templateFiles();
    expect(files.length).toBeGreaterThanOrEqual(10);
    const plan = buildImportPlan(files);
    expect(plan.warnings).toEqual([]);
    expect(plan.chapters.map((c) => c.title)).toEqual(['The Lamp', 'Below']);
    expect(plan.chapters[0].scenes.map((s) => s.title)).toEqual(['Counting the steps', 'The quay']);
    const names = plan.refs.map((r) => `${r.type}:${r.name}`);
    expect(names).toEqual(
      expect.arrayContaining(['character:Mara Quill', 'character:Tobias Wren', 'character:Elsie Marr', 'location:Gull Point Light', 'faction:The Harbour Guild', 'glossary:Wickie']),
    );
    const mara = plan.refs.find((r) => r.name === 'Mara Quill')!;
    expect(mara).toMatchObject({ aliases: ['Mara', "the keeper's girl"], favorite: true, tags: ['main', 'family'] });
    expect(mara.fields).toMatchObject({ role: 'Protagonist', appearance: 'Salt-stiff braid, ink on her fingers.', 'Shoe size': '6' });
    expect(mara.notes).toBe('Born in winter. "Quill" is her mother\'s name.');
    expect(plan.cards).toHaveLength(4);
    expect(plan.events).toHaveLength(3);
    expect(plan.threads).toHaveLength(1);
    expect(plan.notes[0]).toMatchObject({ title: 'How lighthouse lamps worked', url: 'https://en.wikipedia.org/wiki/Lighthouse', tags: ['research'] });
  });

  it('imports into a book and links everything by name', async () => {
    resetDbForTests();
    const { project, book } = await createProject('Imported');
    await createReference(project.id, 'character', 'Tobias Wren'); // already exists → skipped
    const report = await applyImportPlan(project.id, book.id, buildImportPlan(templateFiles()));
    expect(report.refsSkipped).toEqual(['Tobias Wren']);
    expect(report.unmatched).toEqual([]);
    expect(report.chapters).toBe(2);
    expect(report.lanesCreated).toEqual([]); // Act I–III exist already
    const chapters = (await db.chapters.where('bookId').equals(book.id).toArray()).sort((a, b) => a.order - b.order);
    expect(chapters.filter((c) => !c.archivedAt).map((c) => c.title)).toEqual(['The Lamp', 'Below']);
    const refs = await db.references.where('projectId').equals(project.id).toArray();
    const id = (n: string) => refs.find((r) => r.name === n)!.id;
    const card = (await db.boardCards.where('projectId').equals(project.id).toArray()).find((c) => c.title === 'Message in the lens')!;
    expect(card.povCharacterId).toBe(id('Mara Quill'));
    expect(card.locationId).toBe(id('Gull Point Light'));
    const lamp = chapters.find((c) => c.title === 'The Lamp')!;
    expect(card.chapterId).toBe(lamp.id);
    expect(card.plotThreadIds).toHaveLength(1);
    const thread = (await db.plotThreads.where('projectId').equals(project.id).toArray())[0];
    expect(thread.name).toBe('Where is Father?');
    expect(thread.keyCharacterIds).toEqual([id('Mara Quill'), id('Elsie Marr')]);
    const ev = (await db.timelineEvents.where('projectId').equals(project.id).toArray()).find((e) => e.title === 'Mara finds the message')!;
    expect(ev).toMatchObject({ sortKey: 10, characterIds: [id('Mara Quill')], chapterId: lamp.id });
    expect(ev.sceneId).not.toBeNull();
    const scene = (await db.scenes.where('chapterId').equals(lamp.id).toArray()).find((s) => s.title === 'Counting the steps')!;
    expect(scene.plainText).toContain('two hundred and twelve steps');
  });

  it('reports names that could not be matched and creates missing columns', async () => {
    resetDbForTests();
    const { project, book } = await createProject('P');
    const plan = buildImportPlan([{ path: 'board.csv', text: 'Column,Title,POV,Chapter\nIdeas,A card,Nobody,No such chapter\n,Loose card,,' }]);
    const r = await applyImportPlan(project.id, book.id, plan);
    expect(r.lanesCreated).toEqual(['Ideas', 'Imported cards']);
    expect(r.unmatched).toEqual(['Chapter “No such chapter”', 'POV “Nobody”']);
  });

  it('warns about unknown files and values but still imports the rest', () => {
    const plan = buildImportPlan([
      { path: 'random.csv', text: 'a,b\n1,2' },
      { path: 'board.csv', text: 'Title,Status,Type\nX,someday,wish' },
      { path: 'characters.csv', text: 'Role\nLead' },
    ]);
    expect(plan.cards[0]).toMatchObject({ status: 'idea', type: 'scene' });
    expect(plan.warnings.join('\n')).toMatch(/Ignored “random.csv”/);
    expect(plan.warnings.join('\n')).toMatch(/status “someday”/);
    expect(plan.warnings.join('\n')).toMatch(/no Name, skipped/);
  });
});

describe('alternative names promised in IMPORTING.md', () => {
  it('accepts the documented alternative file and folder names', () => {
    const plan = buildImportPlan([
      { path: 'Story-Board.csv', text: ['Lane,Card', 'Ideas,X'].join('\n') },
      { path: 'plot threads.csv', text: ['Name', 'Revenge'].join('\n') },
      { path: 'Places.CSV', text: ['Name,Sights sounds smells', 'The Keep,Smoke'].join('\n') },
      { path: 'people/Bob.md', text: 'Looks: Tall' },
      { path: 'research/Ships.txt', text: 'Sails.' },
      { path: 'events.csv', text: ['Event,Sort', 'Storm,5'].join('\n') },
      { path: 'My whole book.txt', text: ['Chapter One', '', 'Hello.', '', 'Chapter Two', '', 'Bye.'].join('\n') },
      { path: 'world.csv', text: ['Kind,Name', 'organisation,The Guild'].join('\n') },
    ]);
    expect(plan.warnings).toEqual([]);
    expect(plan.cards[0]).toMatchObject({ lane: 'Ideas', title: 'X' });
    expect(plan.threads[0].name).toBe('Revenge');
    expect(plan.refs.map((r) => [r.type, r.name])).toEqual(expect.arrayContaining([['location', 'The Keep'], ['character', 'Bob'], ['faction', 'The Guild']]));
    expect(plan.refs.find((r) => r.name === 'The Keep')!.fields.sensory).toBe('Smoke');
    expect(plan.refs.find((r) => r.name === 'Bob')!.fields.appearance).toBe('Tall');
    expect(plan.notes[0].title).toBe('Ships');
    expect(plan.events[0]).toMatchObject({ title: 'Storm', order: 5 });
    expect(plan.chapters.map((c) => c.title)).toEqual(['Chapter One', 'Chapter Two']);
  });
});

describe('zip and folder handling', () => {
  it('reads a zipped folder, ignoring junk and stripping the top folder', () => {
    const zip = zipSync({
      'My Book/characters.csv': strToU8('Name\nMara'),
      'My Book/chapters/01.md': strToU8('# One\n\nHi.'),
      '__MACOSX/My Book/._characters.csv': strToU8('junk'),
      'My Book/cover.png': new Uint8Array([1, 2, 3]),
    });
    const files = filesFromZip(zip);
    expect(files.map((f) => f.path).sort()).toEqual(['chapters/01.md', 'characters.csv']);
  });
  it('keeps paths when the top folder is part of the layout', () => {
    expect(stripCommonRoot([{ path: 'chapters/01.md', text: '' }]).map((f) => f.path)).toEqual(['chapters/01.md']);
  });
  it('builds a downloadable starter template from the documented example', async () => {
    const names = Object.keys(unzipSync(await starterTemplateZip()));
    expect(names).toContain('AuthorDesk import template/characters.csv');
    expect(names).toContain('AuthorDesk import template/chapters/01 - The Lamp.md');
    expect(names).toContain('AuthorDesk import template/README.txt');
  });
});
