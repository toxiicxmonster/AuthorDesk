import { PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { PmNode } from '../domain/text';
import { kdpMinimumInside, tocEntry, type PrintLayout, type PublishModel } from './publish';

/**
 * Print-ready PDF interior for KDP paperbacks, typeset here rather than by a word processor: justified text with
 * first-line indents, mirrored margins with KDP's gutter, chapters opening on right-hand pages, running heads and
 * page numbers, widow and orphan control, and a contents page with real page numbers.
 */

export type FontStyle = 'regular' | 'italic' | 'bold' | 'boldItalic';
export type PdfFonts = Record<FontStyle, Uint8Array>;

export interface PdfOptions {
  /** Line height as a multiple of the font size. */
  leading: number;
  sceneBreak: string;
  runningHeads: boolean;
  pageNumbers: boolean;
}

export const DEFAULT_PDF_OPTIONS: PdfOptions = { leading: 1.38, sceneBreak: '*   *   *', runningHeads: true, pageNumbers: true };

export interface PdfResult {
  bytes: Uint8Array;
  pages: number;
  /** Body page number where each chapter starts. */
  chapterPages: number[];
  inside: number;
}

const PT = 72;

// ---------------------------------------------------------------- measuring

interface Segment {
  text: string;
  style: FontStyle;
}
type Word = Segment[];

interface Measurer {
  width(text: string, style: FontStyle, size: number): number;
}

/** The words of a paragraph, each a run of styled segments ("Hello" italic + "," roman stays one word). */
export function paragraphWords(node: PmNode): Word[] {
  const words: Word[] = [];
  let current: Word = [];
  const push = () => {
    if (current.length) words.push(current);
    current = [];
  };
  const walk = (n: PmNode, marks: string[]) => {
    if (n.type === 'text') {
      const m = [...marks, ...((n.marks ?? []) as { type: string }[]).map((x) => x.type)];
      const style: FontStyle = m.includes('bold') ? (m.includes('italic') ? 'boldItalic' : 'bold') : m.includes('italic') ? 'italic' : 'regular';
      const parts = (n.text ?? '').split(/(\s+)/);
      for (const part of parts) {
        if (!part) continue;
        if (/^\s+$/.test(part)) push();
        else current.push({ text: part, style });
      }
    } else if (n.type === 'hardBreak') push();
    else for (const c of n.content ?? []) walk(c, marks);
  };
  walk(node, []);
  push();
  return words;
}

const wordWidth = (w: Word, size: number, m: Measurer) => w.reduce((n, s) => n + m.width(s.text, s.style, size), 0);

interface Line {
  words: Word[];
  widths: number[];
  /** Indent at the start of the line (first line of an indented paragraph). */
  indent: number;
  last: boolean;
}

/** Greedy line breaking within `width`. */
export function breakLines(words: Word[], width: number, firstIndent: number, size: number, m: Measurer): Line[] {
  const space = m.width(' ', 'regular', size);
  const lines: Line[] = [];
  let cur: Word[] = [];
  let curW: number[] = [];
  let used = 0;
  let indent = firstIndent;
  for (const w of words) {
    const ww = wordWidth(w, size, m);
    const need = cur.length ? used + space + ww : ww;
    if (cur.length && indent + need > width) {
      lines.push({ words: cur, widths: curW, indent, last: false });
      cur = [];
      curW = [];
      used = 0;
      indent = 0;
    }
    used = cur.length ? used + space + ww : ww;
    cur.push(w);
    curW.push(ww);
  }
  if (cur.length) lines.push({ words: cur, widths: curW, indent, last: true });
  return lines;
}

// ---------------------------------------------------------------- page model

interface DrawText {
  text: string;
  style: FontStyle;
  size: number;
  /** Points from the left edge of the text block, and from the top of the page. */
  x: number;
  y: number;
}

interface Page {
  items: DrawText[];
  /** Body page number (front matter has none). */
  number: number | null;
  /** Running head and page number belong on it. */
  furniture: boolean;
}

interface Geometry {
  pageW: number;
  pageH: number;
  textW: number;
  textH: number;
  top: number;
  bottom: number;
  inside: number;
  outside: number;
}

const geometry = (layout: PrintLayout, inside: number): Geometry => {
  const { trim, margins } = layout;
  return {
    pageW: trim.width * PT,
    pageH: trim.height * PT,
    textW: (trim.width - inside - margins.outside) * PT,
    textH: (trim.height - margins.top - margins.bottom) * PT,
    top: margins.top * PT,
    bottom: margins.bottom * PT,
    inside: inside * PT,
    outside: margins.outside * PT,
  };
};

/** Lays out the body (chapters and back matter) into pages numbered from 1 (a right-hand page). */
function layoutBody(model: PublishModel, g: Geometry, size: number, opts: PdfOptions, m: Measurer): { pages: Page[]; chapterPages: number[] } {
  const lineH = size * opts.leading;
  const indent = size * 1.5;
  const pages: Page[] = [];
  const chapterPages: number[] = [];
  let page: Page | null = null;
  let y = 0;

  const newPage = (furniture = true) => {
    page = { items: [], number: pages.length + 1, furniture };
    pages.push(page);
    y = 0;
  };
  /** Chapters open on a right-hand (odd) page, a third of the way down. */
  const openChapter = () => {
    if (pages.length % 2 === 1) {
      newPage(false); // blank left-hand page
    }
    newPage();
    page!.furniture = false; // no running head on an opening page (the page number still shows)
    y = Math.round(g.textH * 0.28);
  };
  const centered = (text: string, style: FontStyle, sz: number) => {
    page!.items.push({ text, style, size: sz, x: (g.textW - m.width(text, style, sz)) / 2, y: y + sz });
  };
  const spaceFor = (lines: number) => Math.floor((g.textH - y) / lineH) >= lines;

  const drawLine = (line: Line, justify: boolean) => {
    const space = m.width(' ', 'regular', size);
    const natural = line.widths.reduce((a, b) => a + b, 0) + space * (line.words.length - 1);
    const room = g.textW - line.indent;
    const gap = justify && !line.last && line.words.length > 1 ? space + (room - natural) / (line.words.length - 1) : space;
    let x = line.indent;
    line.words.forEach((w, i) => {
      let sx = x;
      for (const s of w) {
        page!.items.push({ text: s.text, style: s.style, size, x: sx, y: y + size });
        sx += m.width(s.text, s.style, size);
      }
      x += line.widths[i] + gap;
    });
    y += lineH;
  };

  /** A paragraph's lines, moved to the next page to avoid a lone first line (orphan) or lone last line (widow). */
  const paragraph = (lines: Line[], justify = true) => {
    let i = 0;
    while (i < lines.length) {
      let avail = Math.floor((g.textH - y) / lineH);
      if (avail <= 0) {
        newPage();
        avail = Math.floor(g.textH / lineH);
      }
      const remaining = lines.length - i;
      let take = Math.min(avail, remaining);
      if (take < remaining) {
        if (i === 0 && take === 1 && remaining > 1) take = 0; // orphan: start on the next page
        else if (remaining - take === 1) {
          // Widow (the last line alone on the next page): carry one more line over if two still stay behind,
          // otherwise move the short paragraph whole and leave this page a line short, as typesetters do.
          take = take - 1 >= 2 || i > 0 ? take - 1 : 0;
        }
      }
      for (let k = 0; k < take; k++) drawLine(lines[i + k], justify);
      i += take;
      if (i < lines.length) newPage();
    }
  };

  const section = (label: string, title: string, blocks: PmNode[]) => {
    openChapter();
    chapterPages.push(page!.number!);
    if (label) {
      centered(label.toUpperCase(), 'regular', size * 0.85);
      y += size * 1.8;
    }
    for (const l of breakLines(paragraphWords({ type: 'paragraph', content: [{ type: 'text', text: title }] }), g.textW * 0.8, 0, size * 1.6, m)) {
      const t = l.words.map((w) => w.map((s) => s.text).join('')).join(' ');
      centered(t, 'regular', size * 1.6);
      y += size * 1.6 * 1.25;
    }
    y += lineH * 1.5;
    let first = true;
    for (const b of blocks) {
      if (b.type === 'horizontalRule') {
        if (!spaceFor(4)) newPage();
        else if (y > 0) y += lineH;
        centered(opts.sceneBreak, 'regular', size);
        y += lineH * 2;
        first = true;
        continue;
      }
      if (b.type === 'heading') {
        if (!spaceFor(3)) newPage();
        const t = paragraphWords(b).map((w) => w.map((s) => s.text).join('')).join(' ');
        centered(t, 'italic', size);
        y += lineH * 1.5;
        first = true;
        continue;
      }
      const words = paragraphWords(b);
      if (!words.length) continue;
      paragraph(breakLines(words, g.textW, first ? 0 : indent, size, m));
      first = false;
    }
  };

  model.chapters.forEach((c) => section(c.label, c.title, c.blocks));
  if (model.options.includeAboutAuthor && model.info.aboutAuthor.trim()) {
    section('', 'About the Author', model.info.aboutAuthor.split(/\n+/).filter((p) => p.trim()).map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p.trim() }] })));
  }
  return { pages, chapterPages };
}

/** Title, copyright, dedication and contents pages, padded to an even count so the body opens on a right-hand page. */
function layoutFront(model: PublishModel, g: Geometry, size: number, chapterPages: number[], m: Measurer): Page[] {
  const pages: Page[] = [];
  const blank = () => pages.push({ items: [], number: null, furniture: false });
  const page = () => {
    const p: Page = { items: [], number: null, furniture: false };
    pages.push(p);
    return p;
  };
  const center = (p: Page, text: string, style: FontStyle, sz: number, y: number) =>
    p.items.push({ text, style, size: sz, x: (g.textW - m.width(text, style, sz)) / 2, y });
  const wrapCentered = (p: Page, text: string, style: FontStyle, sz: number, y: number, lh = 1.3) => {
    for (const l of breakLines(paragraphWords({ type: 'paragraph', content: [{ type: 'text', text }] }), g.textW * 0.85, 0, sz, m)) {
      center(p, l.words.map((w) => w.map((s) => s.text).join('')).join(' '), style, sz, y + sz);
      y += sz * lh;
    }
    return y;
  };
  const { info, options } = model;

  if (options.includeTitlePage) {
    const p = page();
    let y = wrapCentered(p, model.title, 'regular', size * 2.2, g.textH * 0.25);
    if (model.subtitle) y = wrapCentered(p, model.subtitle, 'italic', size * 1.2, y + size);
    if (info.author) wrapCentered(p, info.author, 'regular', size * 1.3, Math.max(y + size * 4, g.textH * 0.6));
    if (options.includeCopyright) {
      const c = page();
      const lines = [
        `Copyright © ${info.copyrightYear} ${info.author}`.trim(),
        'All rights reserved.',
        info.isbn ? `ISBN ${info.isbn}` : '',
        info.publisher ? `Published by ${info.publisher}` : '',
      ].filter(Boolean);
      let y = g.textH - lines.length * size * 1.4;
      for (const l of lines) {
        c.items.push({ text: l, style: 'regular', size: size * 0.85, x: 0, y: y + size });
        y += size * 1.4;
      }
    } else blank();
  }
  if (options.includeDedication && info.dedication.trim()) {
    if (pages.length % 2 === 1) blank();
    const p = page();
    let y = g.textH * 0.3;
    for (const para of info.dedication.split(/\n+/).filter((x) => x.trim())) y = wrapCentered(p, para.trim(), 'italic', size, y, 1.5);
  }
  if (options.includeToc && model.chapters.length) {
    if (pages.length % 2 === 1) blank();
    let p = page();
    center(p, 'CONTENTS', 'regular', size * 1.1, size * 1.1);
    let y = size * 4;
    const lh = size * 1.6;
    const entries = model.chapters.map((c, i) => ({ text: tocEntry(c), page: chapterPages[i] }));
    if (model.options.includeAboutAuthor && model.info.aboutAuthor.trim()) entries.push({ text: 'About the Author', page: chapterPages[model.chapters.length] });
    for (const e of entries) {
      if (y + lh > g.textH) {
        p = page();
        y = 0;
      }
      const num = String(e.page ?? '');
      const numW = m.width(num, 'regular', size);
      let label = e.text;
      while (label.length > 4 && m.width(label, 'regular', size) > g.textW - numW - size * 2) label = label.slice(0, -2).trimEnd() + '…';
      p.items.push({ text: label, style: 'regular', size, x: 0, y: y + size });
      p.items.push({ text: num, style: 'regular', size, x: g.textW - numW, y: y + size });
      y += lh;
    }
  }
  if (pages.length % 2 === 1) blank();
  return pages;
}

// ---------------------------------------------------------------- rendering

export async function loadFonts(fetchImpl: typeof fetch = fetch, family: 'crimson' | 'gentium' = 'crimson'): Promise<PdfFonts> {
  const names: Record<FontStyle, string> =
    family === 'gentium'
      ? { regular: 'GentiumBookPlus-Regular', italic: 'GentiumBookPlus-Italic', bold: 'GentiumBookPlus-Bold', boldItalic: 'GentiumBookPlus-BoldItalic' }
      : { regular: 'CrimsonText-Regular', italic: 'CrimsonText-Italic', bold: 'CrimsonText-Bold', boldItalic: 'CrimsonText-BoldItalic' };
  const entries = await Promise.all(
    (Object.keys(names) as FontStyle[]).map(async (k) => {
      const res = await fetchImpl(`./fonts/${names[k]}.ttf`);
      if (!res.ok) throw new Error(`Couldn’t load the ${names[k]} font.`);
      return [k, new Uint8Array(await res.arrayBuffer())] as const;
    }),
  );
  return Object.fromEntries(entries) as PdfFonts;
}

export async function buildPrintPdf(model: PublishModel, layout: PrintLayout, fonts: PdfFonts, options: Partial<PdfOptions> = {}): Promise<PdfResult> {
  const opts = { ...DEFAULT_PDF_OPTIONS, ...options };
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const embedded = {} as Record<FontStyle, PDFFont>;
  for (const k of Object.keys(fonts) as FontStyle[]) embedded[k] = await doc.embedFont(fonts[k], { subset: true });
  // A scene-break ornament the font lacks would print as an empty box.
  const charset = new Set(embedded.regular.getCharacterSet());
  if (![...opts.sceneBreak].every((ch) => /\s/.test(ch) || charset.has(ch.codePointAt(0)!))) opts.sceneBreak = DEFAULT_PDF_OPTIONS.sceneBreak;
  const cache = new Map<string, number>();
  const m: Measurer = {
    width(text, style, size) {
      const key = `${style}\u0001${text}`;
      let w = cache.get(key);
      if (w === undefined) cache.set(key, (w = embedded[style].widthOfTextAtSize(text, 1000)));
      return (w * size) / 1000;
    },
  };
  const size = layout.fontSize;

  // The gutter KDP requires depends on the page count, which depends on the gutter: settle it in two passes.
  let inside = layout.margins.inside;
  let g = geometry(layout, inside);
  let body = layoutBody(model, g, size, opts, m);
  let front = layoutFront(model, g, size, body.chapterPages, m);
  const needed = kdpMinimumInside(front.length + body.pages.length) + 0.125;
  if (needed > inside) {
    inside = needed;
    g = geometry(layout, inside);
    body = layoutBody(model, g, size, opts, m);
    front = layoutFront(model, g, size, body.chapterPages, m);
  }

  const all = [...front, ...body.pages];
  const headSize = size * 0.75;
  all.forEach((p, i) => {
    const page: PDFPage = doc.addPage([g.pageW, g.pageH]);
    const recto = i % 2 === 0; // page 1 is a right-hand page
    const left = recto ? g.inside : g.outside;
    const draw = (t: DrawText) => page.drawText(t.text, { x: left + t.x, y: g.pageH - g.top - t.y, size: t.size, font: embedded[t.style] });
    p.items.forEach(draw);
    if (p.number !== null && p.items.length) {
      if (opts.runningHeads && p.furniture) {
        const head = (recto ? model.title : model.info.author || model.title).toUpperCase();
        const w = m.width(head, 'regular', headSize);
        page.drawText(head, { x: left + (g.textW - w) / 2, y: g.pageH - g.top / 2 - headSize / 2, size: headSize, font: embedded.regular });
      }
      if (opts.pageNumbers) {
        const n = String(p.number);
        const w = m.width(n, 'regular', headSize * 1.1);
        page.drawText(n, { x: left + (g.textW - w) / 2, y: g.bottom / 2 - headSize / 2, size: headSize * 1.1, font: embedded.regular });
      }
    }
  });
  doc.setTitle(model.title);
  if (model.info.author) doc.setAuthor(model.info.author);
  doc.setCreator('AuthorDesk');
  const bytes = await doc.save();
  return { bytes, pages: all.length, chapterPages: body.chapterPages, inside };
}
