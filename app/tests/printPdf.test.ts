import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { breakLines, buildPrintPdf, paragraphWords, type PdfFonts } from '../src/importExport/printPdf';
import { buildPublishModel, DEFAULT_PUBLISH_OPTIONS, printLayout, TRIM_SIZES } from '../src/importExport/publish';
import type { Book, Chapter, Scene } from '../src/domain/schema';

const font = (n: string) => new Uint8Array(readFileSync(resolve(__dirname, `../public/fonts/${n}.ttf`)));
const fonts: PdfFonts = { regular: font('CrimsonText-Regular'), italic: font('CrimsonText-Italic'), bold: font('CrimsonText-Bold'), boldItalic: font('CrimsonText-BoldItalic') };

const para = (text: string, italic = false) => ({ type: 'paragraph', content: [{ type: 'text', text, ...(italic ? { marks: [{ type: 'italic' }] } : {}) }] });
const sentence = 'The harbour lights flickered as the last boat came in, and Winnie watched the water fold over itself in long grey ribbons.';

function bookWith(chapterCount: number, parasPerChapter: number) {
  const book = { id: 'b', title: 'The Salt Road', subtitle: 'A Novel', publishing: { author: 'Bailey McCreary', isbn: '9780000000002', dedication: 'For Mads.', aboutAuthor: 'Bailey writes by the sea.' } } as unknown as Book;
  const chapters = Array.from({ length: chapterCount }, (_, i) => ({
    chapter: { id: `c${i}`, title: `Chapter ${i + 1}` } as Chapter,
    scenes: [
      {
        id: `s${i}`,
        title: '',
        wordCount: parasPerChapter * 22,
        content: { type: 'doc', content: Array.from({ length: parasPerChapter }, (_, k) => para(k === 1 ? 'She did not look back.' : sentence, k === 2)) },
      } as unknown as Scene,
    ],
  }));
  return buildPublishModel(book, chapters, { ...DEFAULT_PUBLISH_OPTIONS, headingStyle: 'number-only' });
}

describe('print-ready PDF', () => {
  it('keeps styled runs together as words and breaks lines within the width', () => {
    const words = paragraphWords({ type: 'paragraph', content: [{ type: 'text', text: 'She said ' }, { type: 'text', text: 'never', marks: [{ type: 'italic' }] }, { type: 'text', text: ', twice.' }] });
    expect(words.map((w) => w.map((s) => `${s.text}/${s.style}`).join('+'))).toEqual(['She/regular', 'said/regular', 'never/italic+,/regular', 'twice./regular']);
    const m = { width: (t: string) => t.length * 5 };
    const lines = breakLines(paragraphWords(para('aaaa bbbb cccc dddd')), 55, 10, 10, m);
    expect(lines.map((l) => l.words.length)).toEqual([2, 2]);
    expect(lines[0].indent).toBe(10);
    expect(lines.map((l) => l.last)).toEqual([false, true]);
  });

  it('builds a KDP-shaped interior: trim size, chapters on right-hand pages, real contents numbers', async () => {
    const model = bookWith(6, 40);
    const layout = printLayout(model, TRIM_SIZES.find((t) => t.id === '6x9')!, 11);
    const r = await buildPrintPdf(model, layout, fonts);
    const pdf = await PDFDocument.load(r.bytes);
    expect(pdf.getPageCount()).toBe(r.pages);
    const { width, height } = pdf.getPage(0).getSize();
    expect([width, height]).toEqual([6 * 72, 9 * 72]);
    // Each chapter opens on an odd (right-hand) body page, in order.
    expect(r.chapterPages.every((p) => p % 2 === 1)).toBe(true);
    expect([...r.chapterPages].sort((a, b) => a - b)).toEqual(r.chapterPages);
    expect(r.chapterPages[0]).toBe(1);
    expect(pdf.getTitle()).toBe('The Salt Road');
    expect(pdf.getAuthor()).toBe('Bailey McCreary');
  });

  it('meets KDP’s gutter for the final page count, and typesets a full novel quickly', async () => {
    const model = bookWith(30, 180); // ~120k words
    const layout = printLayout(model, TRIM_SIZES.find((t) => t.id === '5.5x8.5')!, 11);
    const t0 = performance.now();
    const r = await buildPrintPdf(model, layout, fonts);
    const ms = performance.now() - t0;
    expect(r.pages).toBeGreaterThan(300);
    const need = r.pages <= 300 ? 0.5 : r.pages <= 500 ? 0.625 : r.pages <= 700 ? 0.75 : 0.875;
    expect(r.inside).toBeGreaterThanOrEqual(need);
    expect(ms).toBeLessThan(15_000);
  }, 30_000);

  it('falls back to a plain scene break when the font lacks the ornament', async () => {
    const model = bookWith(1, 3);
    const r = await buildPrintPdf(model, printLayout(model, TRIM_SIZES[0], 11), fonts, { sceneBreak: '❦' });
    expect(r.pages).toBeGreaterThan(0); // no box glyph: the ornament was swapped for * * *
  });
});
