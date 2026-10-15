import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { buildPublishModel, DEFAULT_PUBLISH_OPTIONS, epigraphLines, printLayout, TRIM_SIZES } from '../src/importExport/publish';
import { buildEpub, ebookCss, blocksToXhtml } from '../src/importExport/epub';
import { buildKdpDocx } from '../src/importExport/kdpDocx';
import { buildPrintPdf, type PdfFonts } from '../src/importExport/printPdf';
import { NO_EXTRA_PAGES } from '../src/domain/bookPages';
import { plainTextToDoc } from '../src/domain/text';
import type { Book, Chapter, Scene } from '../src/domain/schema';

const base = { projectId: 'p', createdAt: 'x', updatedAt: 'x', archivedAt: null, rev: 1 };
const book = { ...base, id: 'b1', title: 'Wearing His', subtitle: '', order: 0, publishing: { author: 'Mads Hart', publisher: '', isbn: '', copyrightYear: '2026', dedication: '', aboutAuthor: '', language: 'en', description: '' } } as Book;
const scene = (text: string): Scene =>
  ({ ...base, id: `s${text.length}`, chapterId: 'c', title: '', order: 0, content: plainTextToDoc(text), plainText: text, wordCount: text.split(/\s+/).length, summary: '', status: 'drafting', povCharacterId: null, locationId: null, timeMarker: '', notes: '', plotThreadIds: [], referenceIds: [] }) as Scene;
const chapters = [
  { chapter: { ...base, id: 'c1', bookId: 'b1', title: 'The things we leave behind', order: 0 } as Chapter, scenes: [scene('I squeeze my eyes shut.\n\nGrandma hums in the kitchen.')] },
  { chapter: { ...base, id: 'c2', bookId: 'b1', title: 'Between the cracks', order: 1 } as Chapter, scenes: [scene('The shop bell rings.')] },
];
const pages = {
  ...NO_EXTRA_PAGES,
  dedication: 'For Grandma.',
  epigraph: 'What we keep is what we carry.\n— An old saying',
  acknowledgements: 'Thank you to my first readers.',
  aboutAuthor: 'Mads writes by the lake.',
  alsoBy: 'The Glass House\nSmall Hours',
};
const model = () => buildPublishModel(book, chapters, DEFAULT_PUBLISH_OPTIONS, pages);

describe('book pages in exports', () => {
  it('splits an epigraph into the quotation and its attribution', () => {
    expect(epigraphLines(pages.epigraph)).toEqual([
      { text: 'What we keep is what we carry.', attribution: false },
      { text: '— An old saying', attribution: true },
    ]);
  });

  it('puts the epigraph before the contents and the back pages after the last chapter in the EPUB', () => {
    const files = unzipSync(buildEpub(model(), 'b1'));
    const opf = strFromU8(files['OEBPS/content.opf']);
    const spine = [...opf.matchAll(/<itemref idref="([^"]+)"/g)].map((m) => m[1]);
    expect(spine).toEqual(['titlepage', 'copyright', 'dedication', 'epigraph', 'nav', 'chapter-1', 'chapter-2', 'acknowledgements', 'about', 'alsoBy']);
    expect(strFromU8(files['OEBPS/epigraph.xhtml'])).toContain('<p class="attribution">— An old saying</p>');
    const also = strFromU8(files['OEBPS/alsoBy.xhtml']);
    expect(also).toContain('Also by Mads Hart');
    expect(also).toContain('<p>The Glass House</p>');
    expect(also).toContain('<p>Small Hours</p>');
    const nav = strFromU8(files['OEBPS/nav.xhtml']);
    expect(nav).toContain('>Acknowledgements</a>');
    expect(nav).not.toContain('>Epigraph</a>');
    for (const n of Object.keys(files).filter((x) => x.endsWith('.xhtml'))) {
      const doc = new DOMParser().parseFromString(strFromU8(files[n]), 'application/xml');
      expect(doc.getElementsByTagName('parsererror').length, n).toBe(0);
    }
  });

  it('gives each back page its own chapter-style opening and contents line in the PDF', async () => {
    const font = (n: string) => new Uint8Array(readFileSync(resolve(__dirname, `../public/fonts/${n}.ttf`)));
    const fonts: PdfFonts = { regular: font('CrimsonText-Regular'), italic: font('CrimsonText-Italic'), bold: font('CrimsonText-Bold'), boldItalic: font('CrimsonText-BoldItalic') };
    const m = model();
    const r = await buildPrintPdf(m, printLayout(m, TRIM_SIZES[3], 11), fonts);
    // Two chapters, then Acknowledgements, About the Author and Also by, each on a right-hand page.
    expect(r.chapterPages).toHaveLength(5);
    expect(r.chapterPages.every((p) => p % 2 === 1)).toBe(true);
  });

  it('includes every page in the KDP Word file', async () => {
    const bytes = await buildKdpDocx(model(), { target: 'ebook', font: 'Georgia', chaptersOnRight: true });
    const xml = strFromU8(unzipSync(bytes)['word/document.xml']);
    for (const t of ['For Grandma.', 'What we keep is what we carry.', 'Thank you to my first readers.', 'Mads writes by the lake.', 'Small Hours', 'Also by Mads Hart']) expect(xml).toContain(t);
    expect(xml.indexOf('What we keep')).toBeLessThan(xml.indexOf('I squeeze'));
    expect(xml.indexOf('Thank you')).toBeGreaterThan(xml.indexOf('The shop bell'));
  });

  it('leaves pages out when they are empty', () => {
    const files = unzipSync(buildEpub(buildPublishModel(book, chapters, DEFAULT_PUBLISH_OPTIONS, NO_EXTRA_PAGES), 'b1'));
    expect(Object.keys(files).some((n) => /epigraph|acknowledgements|alsoBy|about/.test(n))).toBe(false);
  });
});

describe('eBook styles', () => {
  it('has a distinct stylesheet for each style, on top of the shared base', () => {
    const classic = ebookCss('classic');
    const modern = ebookCss('modern');
    const minimal = ebookCss('minimal');
    expect(new Set([classic, modern, minimal]).size).toBe(3);
    for (const css of [classic, modern, minimal]) expect(css).toContain('p.scene-break');
    expect(classic).toContain('small-caps');
    expect(modern).toContain('::first-letter');
  });

  it('uses the chosen style and scene break in the EPUB', () => {
    const files = unzipSync(buildEpub(model(), 'b1', undefined, { style: 'modern', sceneBreak: '•   •   •' }));
    expect(strFromU8(files['OEBPS/style.css'])).toBe(ebookCss('modern'));
    expect(blocksToXhtml([{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }, { type: 'horizontalRule' }, { type: 'paragraph', content: [{ type: 'text', text: 'b' }] }], '•   •   •')).toContain(
      '<p class="scene-break">• • •</p>',
    );
  });
});
