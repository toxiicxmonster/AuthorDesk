/**
 * Shared "publish-ready" model for Amazon KDP and other stores: front matter, chapter headings,
 * typographic punctuation, pre-flight checks and KDP print geometry. Used by epub.ts and kdpDocx.ts.
 */
import type { Book, Chapter, DocJson, Scene } from '../domain/schema';
import type { PmNode } from '../domain/text';
import { countWords } from '../domain/text';
import type { ExtraPagesText } from '../domain/bookPages';

export interface PublishingInfo {
  author: string;
  publisher: string;
  isbn: string;
  copyrightYear: string;
  dedication: string;
  aboutAuthor: string;
  language: string;
  description: string;
  /** Book pages chosen for the export (not stored on the book). */
  epigraph: string;
  acknowledgements: string;
  alsoBy: string;
}

export function publishingInfo(book: Book): PublishingInfo {
  const p = book.publishing ?? ({} as Partial<PublishingInfo>);
  return {
    author: p.author ?? '',
    publisher: p.publisher ?? '',
    isbn: p.isbn ?? '',
    copyrightYear: p.copyrightYear || String(new Date().getFullYear()),
    dedication: p.dedication ?? '',
    aboutAuthor: p.aboutAuthor ?? '',
    language: p.language || 'en',
    description: p.description ?? '',
    epigraph: '',
    acknowledgements: '',
    alsoBy: '',
  };
}

export type HeadingStyle = 'as-written' | 'number-title' | 'words-title' | 'number-only';

export interface PublishOptions {
  headingStyle: HeadingStyle;
  smartPunctuation: boolean;
  includeTitlePage: boolean;
  includeCopyright: boolean;
  includeDedication: boolean;
  includeAboutAuthor: boolean;
  /** Show scene titles as small headings (most novels don't). */
  sceneTitles: boolean;
  /** A visible "Contents" page (eBooks always keep the built-in Kindle navigation). */
  includeToc: boolean;
  /** Print only: page numbers in the contents (Word fills them in when the file is opened). */
  tocPageNumbers: boolean;
}

export const DEFAULT_PUBLISH_OPTIONS: PublishOptions = {
  headingStyle: 'as-written',
  smartPunctuation: true,
  includeTitlePage: true,
  includeCopyright: true,
  includeDedication: true,
  includeAboutAuthor: true,
  sceneTitles: false,
  includeToc: true,
  tocPageNumbers: false,
};

export interface PublishChapter {
  /** Small line above the title, e.g. "Chapter 3" (empty if none). */
  label: string;
  /** Main heading text (what the table of contents shows). */
  title: string;
  /** Content blocks; scenes are separated by { type: 'horizontalRule' }. */
  blocks: PmNode[];
  words: number;
}

export interface PublishModel {
  title: string;
  subtitle: string;
  info: PublishingInfo;
  chapters: PublishChapter[];
  words: number;
  options: PublishOptions;
}

const ONES = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

export function numberToWords(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ' and ' + numberToWords(n % 100) : ''}`;
  return String(n);
}

/** Titles like "Chapter 3" or "Chapter Three" carry no extra information beyond the number. */
const GENERIC_TITLE = /^\s*(chapter|ch\.?)\s+([0-9]+|[a-z-]+)\s*$/i;
const UNNUMBERED = /^\s*(prologue|epilogue|interlude|afterword|foreword|preface|introduction|coda)\b/i;

export function chapterHeading(title: string, n: number, style: HeadingStyle): { label: string; title: string } {
  const clean = title.trim() || `Chapter ${n}`;
  if (style === 'as-written' || UNNUMBERED.test(clean)) return { label: '', title: clean };
  const generic = GENERIC_TITLE.test(clean);
  if (style === 'number-only') return { label: '', title: `Chapter ${n}` };
  const label = style === 'words-title' ? `Chapter ${numberToWords(n)}` : `Chapter ${n}`;
  return generic ? { label: '', title: label } : { label, title: clean };
}

// ---------------------------------------------------------------- smart punctuation

/**
 * Typographic punctuation: “curly” quotes, apostrophes, em dashes and ellipses.
 * `prev` is the character before this text (from the previous text run) so quotes open/close correctly.
 */
export function smartenText(s: string, prev = ' '): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const before = i ? s[i - 1] : prev;
    const after = s[i + 1] ?? ' ';
    if (ch === '"') {
      out += /[\s([{—–-]/.test(before) ? '“' : '”';
    } else if (ch === "'") {
      // Apostrophe inside or at the end of a word, or before decade numbers ('90s); otherwise an opening quote.
      if (/[\p{L}\p{N}.,!?]/u.test(before)) out += '’';
      else if (/\d/.test(after)) out += '’';
      else out += '‘';
    } else if (ch === '-' && s[i + 1] === '-') {
      out += '—';
      i++;
      if (s[i + 1] === '-') i++;
    } else if (ch === '.' && s[i + 1] === '.' && s[i + 2] === '.') {
      out += '…';
      i += 2;
    } else out += ch;
  }
  return out;
}

/** Apply smartenText through a doc, carrying context across text runs within a paragraph. */
export function smartenDoc(node: PmNode): PmNode {
  const walkBlock = (n: PmNode): PmNode => {
    if (!n.content) return n;
    if (n.content.some((c) => c.type === 'text' || c.type === 'hardBreak')) {
      let prev = ' ';
      return {
        ...n,
        content: n.content.map((c) => {
          if (c.type === 'hardBreak') {
            prev = ' ';
            return c;
          }
          if (c.type !== 'text' || !c.text) return c;
          const text = smartenText(c.text, prev);
          prev = c.text[c.text.length - 1];
          return { ...c, text };
        }),
      };
    }
    return { ...n, content: n.content.map(walkBlock) };
  };
  return walkBlock(node);
}

// ---------------------------------------------------------------- model

export function buildPublishModel(
  book: Book,
  chapters: { chapter: Chapter; scenes: Scene[] }[],
  options: PublishOptions = DEFAULT_PUBLISH_OPTIONS,
  /** Dedication / About the Author chosen for this export (from the pages managed on Home). */
  pages?: Partial<ExtraPagesText>,
): PublishModel {
  const info = { ...publishingInfo(book), ...(pages ?? {}) };
  let n = 0;
  const out: PublishChapter[] = [];
  let total = 0;
  for (const { chapter, scenes } of chapters) {
    const unnumbered = UNNUMBERED.test(chapter.title);
    if (!unnumbered) n++;
    const head = chapterHeading(chapter.title, n, options.headingStyle);
    const blocks: PmNode[] = [];
    let words = 0;
    scenes.forEach((s, i) => {
      const doc = (options.smartPunctuation ? smartenDoc(s.content as PmNode) : (s.content as PmNode)) as PmNode;
      const content = (doc.content ?? []).filter((b, j, arr) => !(b.type === 'paragraph' && !b.content?.length && (j === 0 || j === arr.length - 1)));
      if (i > 0 && content.length) blocks.push({ type: 'horizontalRule' });
      if (options.sceneTitles && scenes.length > 1 && s.title.trim()) blocks.push({ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: s.title }] });
      blocks.push(...content);
      words += s.wordCount;
    });
    total += words;
    out.push({ label: head.label, title: head.title, blocks, words });
  }
  return { title: book.title, subtitle: book.subtitle ?? '', info, chapters: out, words: total, options };
}

// ---------------------------------------------------------------- KDP print geometry

export interface TrimSize {
  id: string;
  label: string;
  width: number; // inches
  height: number;
}

/** Common KDP trim sizes for novels (paperback; 5.5×8.5, 6×9 and 6.14×9.21 are also available in hardcover). */
export const TRIM_SIZES: TrimSize[] = [
  { id: '5x8', label: '5 × 8 in', width: 5, height: 8 },
  { id: '5.25x8', label: '5.25 × 8 in', width: 5.25, height: 8 },
  { id: '5.5x8.5', label: '5.5 × 8.5 in', width: 5.5, height: 8.5 },
  { id: '6x9', label: '6 × 9 in (most common)', width: 6, height: 9 },
  { id: '6.14x9.21', label: '6.14 × 9.21 in', width: 6.14, height: 9.21 },
];

/** KDP's minimum inside (gutter) margin for a no-bleed interior, by page count. */
export function kdpMinimumInside(pages: number): number {
  if (pages <= 150) return 0.375;
  if (pages <= 300) return 0.5;
  if (pages <= 500) return 0.625;
  if (pages <= 700) return 0.75;
  return 0.875;
}

export interface PrintLayout {
  trim: TrimSize;
  fontSize: number;
  estimatedPages: number;
  /** Inches. Inside includes KDP's required gutter plus a comfort allowance. */
  margins: { inside: number; outside: number; top: number; bottom: number };
}

/** Margins the print exports use, apart from the inside (gutter) margin, which depends on the page count. */
export const PRINT_MARGINS = { outside: 0.6, top: 0.75, bottom: 0.75 };

/**
 * Words on a full page of body text: ~9 words per square inch of text block at 11pt (≈300 words on a 6×9 page,
 * typical for trade fiction), scaling with the square of the font size.
 */
export function printWordsPerPage(trim: Pick<TrimSize, 'width' | 'height'>, fontSize: number, inside: number): number {
  const textW = trim.width - inside - PRINT_MARGINS.outside;
  const textH = trim.height - PRINT_MARGINS.top - PRINT_MARGINS.bottom;
  return textW * textH * 9 * (11 / fontSize) ** 2;
}

/**
 * Estimate the page count and pick margins that meet KDP's rules (outside/top/bottom ≥ 0.25 in,
 * inside ≥ the gutter minimum for that page count) with some breathing room.
 */
export function printLayout(model: PublishModel, trim: TrimSize, fontSize: number): PrintLayout {
  const { outside, top, bottom } = PRINT_MARGINS;
  const estimate = (inside: number) => {
    const wordsPerPage = printWordsPerPage(trim, fontSize, inside);
    const perChapter = model.chapters.map((c) => Math.ceil(c.words / wordsPerPage + 0.35));
    // Chapters open on right-hand pages: a blank page follows each odd-length chapter but the last.
    const blanks = perChapter.slice(0, -1).filter((n) => n % 2 === 1).length;
    const chapterPages = perChapter.reduce((a, b) => a + b, 0) + blanks;
    const front =
      (model.options.includeTitlePage ? 2 : 0) +
      (model.options.includeCopyright ? 1 : 0) +
      (model.options.includeDedication && model.info.dedication ? 2 : 0) +
      (model.options.includeToc ? 2 * Math.ceil(model.chapters.length / 28) : 0);
    const back = backPages(model).reduce((n, p) => n + 2 * Math.ceil(countWords(p.text) / 250), 0);
    const extraFront = frontPages(model).length * 2 - (model.options.includeDedication && model.info.dedication ? 2 : 0);
    return front + extraFront + chapterPages + back;
  };
  let pages = estimate(0.75);
  const inside = kdpMinimumInside(pages) + 0.25;
  pages = estimate(inside);
  return { trim, fontSize, estimatedPages: pages, margins: { inside, outside, top, bottom } };
}

// ---------------------------------------------------------------- pre-flight checks

export interface PreflightItem {
  level: 'problem' | 'check';
  message: string;
}

export function preflight(model: PublishModel, target: 'ebook' | 'print', layout?: PrintLayout): PreflightItem[] {
  const out: PreflightItem[] = [];
  if (!model.info.author.trim()) out.push({ level: 'problem', message: 'Add the author name (it appears on the title page and in the eBook details).' });
  if (!model.chapters.length) out.push({ level: 'problem', message: 'This book has no chapters yet.' });
  const empty = model.chapters.filter((c) => c.words === 0);
  if (empty.length) out.push({ level: 'problem', message: `Empty chapter${empty.length === 1 ? '' : 's'}: ${empty.map((c) => c.title).join(', ')}. Remove or fill ${empty.length === 1 ? 'it' : 'them'} — stores reject blank pages.` });
  const notes: string[] = [];
  const placeholder = /\b(TK|TODO|FIXME|XXX)\b|\[\s*(tk|todo|note|research|check)[^\]]*\]/i;
  for (const c of model.chapters) {
    const text = blocksText(c.blocks);
    if (placeholder.test(text)) notes.push(c.title);
  }
  if (notes.length) out.push({ level: 'check', message: `Possible leftover notes (TK, TODO or [brackets]) in: ${notes.join(', ')}.` });
  if (target === 'print' && layout) {
    if (layout.estimatedPages < 24) out.push({ level: 'problem', message: `About ${layout.estimatedPages} pages — KDP paperbacks need at least 24 pages.` });
    if (layout.estimatedPages > 828) out.push({ level: 'problem', message: `About ${layout.estimatedPages} pages — over KDP’s 828-page paperback limit at this trim size. Try a larger trim or smaller text.` });
    if (model.info.isbn && !/^(97[89])?\d{9}[\dX]$/.test(model.info.isbn.replace(/[-\s]/g, ''))) out.push({ level: 'check', message: 'The ISBN doesn’t look like a 10- or 13-digit ISBN.' });
  }
  if (target === 'print' && model.options.includeToc && model.options.tocPageNumbers) {
    out.push({ level: 'check', message: 'Contents page numbers are filled in by Microsoft Word: open the file in Word, choose Yes when it asks to update fields, then save before uploading to KDP.' });
  }
  if (target === 'ebook' && model.words < 2500) out.push({ level: 'check', message: 'Very short for an eBook (under 2,500 words).' });
  return out;
}

export function blocksText(blocks: PmNode[]): string {
  const walk = (n: PmNode): string => (n.type === 'text' ? (n.text ?? '') : (n.content ?? []).map(walk).join(n.content?.some((c) => c.type === 'paragraph') ? '\n' : ''));
  return blocks.map(walk).join('\n');
}

export function wordsIn(doc: DocJson): number {
  return countWords(blocksText((doc.content ?? []) as PmNode[]));
}

export function slug(s: string): string {
  return s.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'book';
}

export interface MatterPage {
  id: 'dedication' | 'epigraph' | 'acknowledgements' | 'about' | 'alsoBy';
  title: string;
  text: string;
}

/** Pages before the contents: the dedication, then the epigraph. */
export function frontPages(model: PublishModel): MatterPage[] {
  const out: MatterPage[] = [];
  if (model.options.includeDedication && model.info.dedication.trim()) out.push({ id: 'dedication', title: 'Dedication', text: model.info.dedication.trim() });
  if (model.info.epigraph.trim()) out.push({ id: 'epigraph', title: 'Epigraph', text: model.info.epigraph.trim() });
  return out;
}

/** Pages after the last chapter, each with its own heading and a line in the contents. */
export function backPages(model: PublishModel): MatterPage[] {
  const out: MatterPage[] = [];
  if (model.info.acknowledgements.trim()) out.push({ id: 'acknowledgements', title: 'Acknowledgements', text: model.info.acknowledgements.trim() });
  if (model.options.includeAboutAuthor && model.info.aboutAuthor.trim()) out.push({ id: 'about', title: 'About the Author', text: model.info.aboutAuthor.trim() });
  if (model.info.alsoBy.trim()) out.push({ id: 'alsoBy', title: model.info.author ? `Also by ${model.info.author}` : 'Also by the Author', text: model.info.alsoBy.trim() });
  return out;
}

/** An epigraph's lines: the quotation, and an attribution line starting with a dash. */
export function epigraphLines(text: string): { text: string; attribution: boolean }[] {
  return text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => ({ text: l, attribution: /^[—–-]/.test(l) }));
}

/** The text a contents page shows for a chapter: "Chapter 1: The Lamp", or just the title. */
export function tocEntry(c: PublishChapter): string {
  return c.label ? `${c.label}: ${c.title}` : c.title;
}
