import { unzipSync, strFromU8 } from 'fflate';
import {
  smartenText,
  smartenDoc,
  chapterHeading,
  numberToWords,
  kdpMinimumInside,
  printLayout,
  buildPublishModel,
  preflight,
  TRIM_SIZES,
  DEFAULT_PUBLISH_OPTIONS,
} from '../src/importExport/publish';
import { buildEpub, blocksToXhtml } from '../src/importExport/epub';
import { buildKdpDocx } from '../src/importExport/kdpDocx';
import { plainTextToDoc } from '../src/domain/text';
import type { Book, Chapter, Scene } from '../src/domain/schema';
import type { PmNode } from '../src/domain/text';

const base = { projectId: 'p', createdAt: 'x', updatedAt: 'x', archivedAt: null, rev: 1 };
const book = (publishing?: Partial<Book['publishing']>): Book =>
  ({ ...base, id: '0b1c2d3e-0000-4000-8000-000000000001', title: 'The Salt Lamp', subtitle: 'A Novel', order: 0, publishing: { author: 'Jane Quill', publisher: '', isbn: '', copyrightYear: '2026', dedication: 'For Mum.', aboutAuthor: 'Jane lives by the sea.', language: 'en', description: '', ...publishing } }) as Book;
const chapter = (title: string, order: number): Chapter => ({ ...base, id: `c${order}`, bookId: 'b', partId: null, title, order, summary: '', status: 'drafting', pinned: false }) as Chapter;
const scene = (text: string, i = 0): Scene => {
  const content = plainTextToDoc(text);
  return { ...base, id: `s${Math.random()}`, chapterId: 'c', title: `Scene ${i + 1}`, order: i, content, plainText: text, wordCount: text.split(/\s+/).length, summary: '', status: 'drafting', povCharacterId: null, locationId: null, timeMarker: '', notes: '', plotThreadIds: [], referenceIds: [] } as Scene;
};

describe('smart punctuation', () => {
  it('curls quotes and apostrophes and fixes dashes and ellipses', () => {
    expect(smartenText(`"Don't," she said -- 'it's the '90s'...`)).toBe('\u201CDon\u2019t,\u201D she said \u2014 \u2018it\u2019s the \u201990s\u2019\u2026');
  });
  it('carries quote context across formatting runs', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'She said "' }, { type: 'text', text: 'never', marks: [{ type: 'italic' }] }, { type: 'text', text: '."' }] }] } as PmNode;
    const out = smartenDoc(doc).content![0].content!.map((n) => n.text).join('');
    expect(out).toBe('She said \u201Cnever.\u201D');
  });
});

describe('chapter headings', () => {
  it('supports several heading styles and leaves prologues unnumbered', () => {
    expect(chapterHeading('The Lamp', 3, 'as-written')).toEqual({ label: '', title: 'The Lamp' });
    expect(chapterHeading('The Lamp', 3, 'number-title')).toEqual({ label: 'Chapter 3', title: 'The Lamp' });
    expect(chapterHeading('The Lamp', 21, 'words-title')).toEqual({ label: 'Chapter Twenty-One', title: 'The Lamp' });
    expect(chapterHeading('Chapter 3', 3, 'number-title')).toEqual({ label: '', title: 'Chapter 3' });
    expect(chapterHeading('The Lamp', 3, 'number-only')).toEqual({ label: '', title: 'Chapter 3' });
    expect(chapterHeading('Prologue', 1, 'number-title')).toEqual({ label: '', title: 'Prologue' });
    expect(numberToWords(105)).toBe('One Hundred and Five');
  });
  it('drops a chapter number typed into the title, so it doesn’t print twice', () => {
    // Titles as written in a real manuscript.
    expect(chapterHeading('Chapter 2. Between the cracks', 2, 'number-title')).toEqual({ label: 'Chapter 2', title: 'Between the cracks' });
    expect(chapterHeading('Chapter 8.)An unwanted guest', 8, 'words-title')).toEqual({ label: 'Chapter Eight', title: 'An unwanted guest' });
    expect(chapterHeading('Chapter 1: The things we leave behind', 1, 'number-title')).toEqual({ label: 'Chapter 1', title: 'The things we leave behind' });
    expect(chapterHeading('Chapter 4: "His" girl', 4, 'number-title')).toEqual({ label: 'Chapter 4', title: '"His" girl' });
    expect(chapterHeading('Chapter Twenty-One – Home', 21, 'number-title')).toEqual({ label: 'Chapter 21', title: 'Home' });
    expect(chapterHeading('12. The Fall', 12, 'number-title')).toEqual({ label: 'Chapter 12', title: 'The Fall' });
    expect(chapterHeading('1984 Revisited', 3, 'number-title')).toEqual({ label: 'Chapter 3', title: '1984 Revisited' });
    expect(chapterHeading('Chapter Three', 3, 'number-title')).toEqual({ label: '', title: 'Chapter 3' });
    expect(chapterHeading('Chapter 2. Between the cracks', 2, 'as-written')).toEqual({ label: '', title: 'Chapter 2. Between the cracks' });
  });
  it('does not count prologues when numbering', () => {
    const m = buildPublishModel(book(), [
      { chapter: chapter('Prologue', 0), scenes: [scene('Before.')] },
      { chapter: chapter('The Lamp', 1), scenes: [scene('One.')] },
    ], { ...DEFAULT_PUBLISH_OPTIONS, headingStyle: 'number-title' });
    expect(m.chapters.map((c) => [c.label, c.title])).toEqual([['', 'Prologue'], ['Chapter 1', 'The Lamp']]);
  });
});

describe('KDP print geometry', () => {
  it('follows KDP gutter minimums by page count', () => {
    expect([24, 150, 151, 300, 301, 500, 501, 700, 701].map(kdpMinimumInside)).toEqual([0.375, 0.375, 0.5, 0.5, 0.625, 0.625, 0.75, 0.75, 0.875]);
  });
  it('estimates pages and chooses compliant margins', () => {
    const long = Array.from({ length: 30 }, (_, i) => ({ chapter: chapter(`C${i}`, i), scenes: [scene('word '.repeat(3000))] }));
    const m = buildPublishModel(book(), long);
    const L = printLayout(m, TRIM_SIZES.find((t) => t.id === '6x9')!, 11);
    expect(L.estimatedPages).toBeGreaterThan(250);
    expect(L.estimatedPages).toBeLessThan(450);
    expect(L.margins.inside).toBeGreaterThanOrEqual(kdpMinimumInside(L.estimatedPages));
    expect(Math.min(L.margins.outside, L.margins.top, L.margins.bottom)).toBeGreaterThanOrEqual(0.25);
  });
  it('flags books under 24 pages, missing authors and leftover notes', () => {
    const m = buildPublishModel(book({ author: '' }), [{ chapter: chapter('Only', 0), scenes: [scene('Short [TK check date].')] }]);
    const items = preflight(m, 'print', printLayout(m, TRIM_SIZES[0], 11)).map((i) => i.message).join('\n');
    expect(items).toMatch(/author name/);
    expect(items).toMatch(/at least 24 pages/);
    expect(items).toMatch(/leftover notes/);
  });
});

function sampleModel() {
  return buildPublishModel(book({ isbn: '978-1-23456-789-7' }), [
    { chapter: chapter('The Lamp', 0), scenes: [scene('Mara climbed. "Here," she said & smiled <wide>.\n\nSecond para.'), scene('After the break.', 1)] },
    { chapter: chapter('Below', 1), scenes: [scene('The tunnel.')] },
  ]);
}

describe('EPUB', () => {
  it('produces a valid EPUB 3 package with navigation and well-formed pages', () => {
    const files = unzipSync(buildEpub(sampleModel(), 'book-1'));
    const names = Object.keys(files);
    expect(names[0]).toBe('mimetype');
    expect(strFromU8(files.mimetype)).toBe('application/epub+zip');
    expect(names).toEqual(expect.arrayContaining(['META-INF/container.xml', 'OEBPS/content.opf', 'OEBPS/nav.xhtml', 'OEBPS/toc.ncx', 'OEBPS/chapter-1.xhtml', 'OEBPS/chapter-2.xhtml', 'OEBPS/about.xhtml']));
    const opf = strFromU8(files['OEBPS/content.opf']);
    expect(opf).toContain('<dc:identifier id="bookid">urn:isbn:9781234567897</dc:identifier>');
    expect(opf).toContain('<dc:creator id="author">Jane Quill</dc:creator>');
    expect(opf).toMatch(/<meta property="dcterms:modified">\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ<\/meta>/);
    expect(opf).toContain('properties="nav"');
    for (const n of names.filter((x) => /\.(xhtml|opf|ncx|xml)$/.test(x))) {
      const doc = new DOMParser().parseFromString(strFromU8(files[n]), 'application/xml');
      expect(doc.getElementsByTagName('parsererror').length, `${n} is not well-formed`).toBe(0);
    }
    const ch1 = strFromU8(files['OEBPS/chapter-1.xhtml']);
    expect(ch1).toContain('&amp; smiled &lt;wide&gt;');
    expect(ch1).toContain('\u201CHere,\u201D');
    expect(ch1).toContain('<p class="scene-break">* * *</p>');
    expect(ch1).toMatch(/<p class="first">Mara/);
    const nav = strFromU8(files['OEBPS/nav.xhtml']);
    expect(nav).toContain('epub:type="toc"');
    expect(nav).toContain('epub:type="bodymatter"');
    expect(nav).toContain('>The Lamp</a>');
  });
  it('includes a cover image when given', () => {
    const files = unzipSync(buildEpub(sampleModel(), 'b', { bytes: new Uint8Array([0xff, 0xd8, 0xff]), mediaType: 'image/jpeg' }));
    expect(Object.keys(files)).toContain('OEBPS/cover.jpg');
    expect(strFromU8(files['OEBPS/content.opf'])).toContain('properties="cover-image"');
  });
  it('converts emphasis and quotes', () => {
    expect(blocksToXhtml([{ type: 'paragraph', content: [{ type: 'text', text: 'a', marks: [{ type: 'italic' }] }] }, { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'q' }] }] }])).toBe('<p class="first"><em>a</em></p>\n<blockquote><p>q</p></blockquote>');
  });
});

describe('KDP Word files', () => {
  it('builds a print interior at the trim size with mirrored margins and page numbers', async () => {
    const m = sampleModel();
    const L = printLayout(m, TRIM_SIZES.find((t) => t.id === '6x9')!, 11);
    const files = unzipSync(await buildKdpDocx(m, { target: 'print', layout: L, font: 'Garamond', chaptersOnRight: true }));
    const settings = strFromU8(files['word/settings.xml']);
    expect(settings).toContain('<w:mirrorMargins/>');
    // OOXML element order: mirrorMargins must come after displayBackgroundShape (when present).
    if (settings.includes('<w:displayBackgroundShape')) expect(settings.indexOf('<w:mirrorMargins/>')).toBeGreaterThan(settings.indexOf('<w:displayBackgroundShape'));
    const doc = strFromU8(files['word/document.xml']);
    expect(doc).toContain('w:w="8640"');
    expect(doc).toContain('w:h="12960"');
    expect(doc).toContain(`w:left="${Math.round(L.margins.inside * 1440)}"`);
    expect(doc).toContain('w:titlePg');
    expect(doc).toContain('w:type w:val="oddPage"');
    expect(doc).toContain('The Lamp');
    expect(Object.keys(files).some((f) => /word\/footer\d+\.xml/.test(f))).toBe(true);
    expect(strFromU8(files['word/styles.xml'])).toContain('Garamond');
  });
  it('builds an eBook docx with Heading 1 chapters and no page setup', async () => {
    const files = unzipSync(await buildKdpDocx(sampleModel(), { target: 'ebook', font: 'Georgia', chaptersOnRight: false }));
    const doc = strFromU8(files['word/document.xml']);
    expect(doc).toContain('w:pStyle w:val="Heading1"');
    expect(doc).toContain('w:pageBreakBefore');
    expect(doc).not.toContain('w:w="8640"');
    expect(strFromU8(files['word/settings.xml'])).not.toContain('mirrorMargins');
  });
});

describe('table of contents', () => {
  const model = (o: Partial<typeof DEFAULT_PUBLISH_OPTIONS>) =>
    buildPublishModel(book(), [
      { chapter: chapter('The Lamp', 0), scenes: [scene('One.')] },
      { chapter: chapter('Below', 1), scenes: [scene('Two.')] },
    ], { ...DEFAULT_PUBLISH_OPTIONS, headingStyle: 'number-title', ...o });

  it('EPUB: visible Contents page in reading order only when asked; Kindle navigation always present', () => {
    const on = unzipSync(buildEpub(model({ includeToc: true }), 'b'));
    const opfOn = strFromU8(on['OEBPS/content.opf']);
    expect(opfOn).toContain('<itemref idref="nav"/>');
    expect(strFromU8(on['OEBPS/nav.xhtml'])).toContain('>Chapter 1: The Lamp</a>');
    // Contents comes after the front matter and before chapter 1
    expect(opfOn.indexOf('idref="nav"')).toBeGreaterThan(opfOn.indexOf('idref="copyright"'));
    expect(opfOn.indexOf('idref="nav"')).toBeLessThan(opfOn.indexOf('idref="chapter-1"'));

    const off = unzipSync(buildEpub(model({ includeToc: false }), 'b'));
    const opfOff = strFromU8(off['OEBPS/content.opf']);
    expect(opfOff).toContain('properties="nav"'); // still in the package for Kindle's Go To menu
    expect(opfOff).not.toContain('idref="nav"');
    expect(strFromU8(off['OEBPS/nav.xhtml'])).not.toContain('epub:type="toc" href="nav.xhtml"');
  });

  it('Kindle Word file: linked Contents entries pointing at chapter bookmarks', async () => {
    const doc = strFromU8(unzipSync(await buildKdpDocx(model({ includeToc: true }), { target: 'ebook', font: 'Georgia', chaptersOnRight: false }))['word/document.xml']);
    expect(doc).toContain('>Contents<');
    expect(doc).toContain('w:anchor="chapter_1"');
    expect(doc).toContain('w:anchor="back_about"');
    expect(doc).toMatch(/<w:bookmarkStart[^>]*w:name="chapter_2"/);
    expect(doc.indexOf('>Contents<')).toBeLessThan(doc.indexOf('>The Lamp<'));
    const without = strFromU8(unzipSync(await buildKdpDocx(model({ includeToc: false }), { target: 'ebook', font: 'Georgia', chaptersOnRight: false }))['word/document.xml']);
    expect(without).not.toContain('>Contents<');
  });

  it('print: Contents section, with dot leaders and PAGEREF fields only when page numbers are on', async () => {
    const m = model({ includeToc: true, tocPageNumbers: true });
    const L = printLayout(m, TRIM_SIZES.find((t) => t.id === '6x9')!, 11);
    const files = unzipSync(await buildKdpDocx(m, { target: 'print', layout: L, font: 'Garamond', chaptersOnRight: true }));
    const doc = strFromU8(files['word/document.xml']);
    expect(doc).toContain('PAGEREF chapter_1');
    expect(doc).toContain('w:leader="dot"');
    expect(strFromU8(files['word/settings.xml'])).toContain('w:updateFields');
    expect(preflight(m, 'print', L).some((p) => /update fields/.test(p.message))).toBe(true);

    const plain = buildPublishModel(book(), [{ chapter: chapter('The Lamp', 0), scenes: [scene('One.')] }], { ...DEFAULT_PUBLISH_OPTIONS, includeToc: true, tocPageNumbers: false });
    const doc2 = strFromU8(unzipSync(await buildKdpDocx(plain, { target: 'print', layout: printLayout(plain, TRIM_SIZES[3], 11), font: 'Garamond', chaptersOnRight: true }))['word/document.xml']);
    expect(doc2).toContain('>Contents<');
    expect(doc2).not.toContain('PAGEREF');
  });
});

describe('pre-publish: planning notes left in a chapter', () => {
  it('flags chapters whose text still holds outline bullets', () => {
    const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
    const book = { id: 'b', title: 'T', publishing: { author: 'A' } } as never;
    const chapter = (title: string, lines: string[]) => ({ chapter: { id: title, title } as never, scenes: [{ id: title + 's', title: '', wordCount: 50, content: { type: 'doc', content: lines.map(para) } } as never] });
    const model = buildPublishModel(book, [
      chapter('Between the cracks', ['- Winnie received the keys', '- Finn stops, grumpy', 'She dropped a box.']),
      chapter('Game Day', ['Finn hated losing.', '- one stray dash line is fine']),
    ]);
    const msgs = preflight(model, 'ebook').map((p) => p.message);
    expect(msgs.find((m) => m.startsWith('Planning notes'))).toContain('Between the cracks');
    expect(msgs.find((m) => m.startsWith('Planning notes'))).not.toContain('Game Day');
  });
});

describe('empty chapters', () => {
  it('are left out of the publish model, and the rest are numbered without a gap', () => {
    const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
    const ch = (title: string, words: number) => ({ chapter: { id: title, title } as never, scenes: [{ id: title + 's', title: '', wordCount: words, content: { type: 'doc', content: words ? [para('Some words here.')] : [] } } as never] });
    const model = buildPublishModel({ id: 'b', title: 'T', publishing: { author: 'A' } } as never, [ch('Arrival', 10), ch('Trouble', 0), ch('Departure', 12)], { ...DEFAULT_PUBLISH_OPTIONS, headingStyle: 'number-title' });
    expect(model.chapters.map((c) => `${c.label}: ${c.title}`)).toEqual(['Chapter 1: Arrival', 'Chapter 2: Departure']);
    expect(model.skipped).toEqual(['Trouble']);
    expect(preflight(model, 'ebook').map((p) => p.message).join(' ')).toContain('1 chapter has no text yet and is left out: Trouble');
  });
});
