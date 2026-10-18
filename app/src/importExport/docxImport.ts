import { strFromU8, unzipSync } from 'fflate';
import type { DocJson } from '../domain/schema';
import { countWords } from '../domain/text';
import type { HighlightColor } from '../editor/annotations';

/**
 * Reads a Word document (.docx, which is also what Google Docs gives you with File → Download → Microsoft Word)
 * into chapters for the editor. Chapters start at the document's top headings (or at lines like "Chapter 3" when
 * it has no headings). Bold, italic, underline, strikethrough, scene breaks, Word's highlights and Word's
 * comments come across; fonts, sizes and colours don't (the book's look comes from the export settings). Pure.
 */

export interface DocxChapter {
  title: string;
  doc: DocJson;
  words: number;
  /** Text before the first chapter heading (a title page, copyright…), offered but not ticked by default. */
  frontMatter: boolean;
}

export interface DocxBook {
  /** The document's Title paragraph, if it has one. */
  title: string | null;
  chapters: DocxChapter[];
  comments: number;
  highlights: number;
}

export class DocxError extends Error {}

type Node = DocJson['content'] extends (infer T)[] | undefined ? T : never;
interface TextNode {
  type: 'text';
  text: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}
interface Para {
  /** 0 = body text, 1–6 = heading level, -1 = the document title. */
  level: number;
  content: (TextNode | { type: 'hardBreak' })[];
  text: string;
  pageBreakBefore: boolean;
}

const CHAPTER_LINE = /^(?:chapter|part|prologue|epilogue|interlude)\b.{0,100}$/i;
const SCENE_BREAK = /^(?:\*\s*){1,3}$|^#$|^~+$|^⁂$|^-{3,}$|^(?:\*\s*){3}$|^•\s*•\s*•$/;

/** Word's named highlight colours, mapped to the editor's. */
const WORD_HIGHLIGHT: Record<string, HighlightColor> = {
  yellow: 'yellow',
  darkYellow: 'orange',
  green: 'green',
  darkGreen: 'green',
  cyan: 'blue',
  blue: 'blue',
  darkBlue: 'blue',
  darkCyan: 'blue',
  magenta: 'pink',
  red: 'pink',
  darkRed: 'pink',
  darkMagenta: 'purple',
  lightGray: 'yellow',
  darkGray: 'purple',
};

/** The closest editor highlight for a shading colour ("FFFF00"); null for white or none. */
function shadeToHighlight(fill: string): HighlightColor | null {
  if (!/^[0-9a-f]{6}$/i.test(fill)) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(fill.slice(i, i + 2), 16));
  if (r > 235 && g > 235 && b > 235) return null;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 24) return 'yellow';
  const d = max - min;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h < 20 || h >= 330) return 'pink';
  if (h < 45) return 'orange';
  if (h < 70) return 'yellow';
  if (h < 170) return 'green';
  if (h < 255) return 'blue';
  if (h < 290) return 'purple';
  return 'pink';
}

const kids = (el: Element) => Array.from(el.children);
const child = (el: Element | null | undefined, name: string) => (el ? kids(el).find((c) => c.localName === name) ?? null : null);
const attr = (el: Element | null | undefined, name: string) => el?.getAttribute(`w:${name}`) ?? el?.getAttribute(name) ?? null;
const isOn = (el: Element | null) => !!el && !['0', 'false', 'none'].includes(attr(el, 'val') ?? '');

function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new DocxError('This Word file looks damaged (its text could not be read).');
  return doc;
}

/** Paragraph style ids → heading level, from styles.xml (so renamed or translated heading styles still count). */
function headingStyles(stylesXml: string | null): Map<string, number> {
  const out = new Map<string, number>();
  if (!stylesXml) return out;
  for (const s of Array.from(parseXml(stylesXml).getElementsByTagNameNS('*', 'style'))) {
    const id = attr(s, 'styleId');
    if (!id) continue;
    const name = attr(child(s, 'name'), 'val') ?? '';
    const outline = attr(child(child(s, 'pPr'), 'outlineLvl'), 'val');
    const m = /^heading\s*(\d)$/i.exec(name) ?? /^heading\s*(\d)$/i.exec(id);
    if (/^title$/i.test(name) || /^title$/i.test(id)) out.set(id, -1);
    else if (m) out.set(id, Number(m[1]));
    else if (outline !== null && Number(outline) < 6) out.set(id, Number(outline) + 1);
  }
  return out;
}

function commentTexts(commentsXml: string | null): Map<string, { text: string; author: string; at: string }> {
  const out = new Map<string, { text: string; author: string; at: string }>();
  if (!commentsXml) return out;
  for (const c of Array.from(parseXml(commentsXml).getElementsByTagNameNS('*', 'comment'))) {
    const id = attr(c, 'id');
    if (id === null) continue;
    const paras = Array.from(c.getElementsByTagNameNS('*', 'p')).map((p) =>
      Array.from(p.getElementsByTagNameNS('*', 't'))
        .map((t) => t.textContent ?? '')
        .join(''),
    );
    out.set(id, { text: paras.join('\n').trim(), author: attr(c, 'author') ?? '', at: attr(c, 'date') ?? '' });
  }
  return out;
}

export function readDocx(bytes: Uint8Array, newId: () => string = () => crypto.randomUUID()): DocxBook {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new DocxError('That isn’t a Word (.docx) file. In Word or Google Docs, save or download it as “Word document (.docx)”.');
  }
  const read = (name: string) => (files[name] ? strFromU8(files[name]) : null);
  const main = read('word/document.xml');
  if (!main) throw new DocxError('That file has no Word document inside. Save it from Word or Google Docs as a .docx and try again.');

  const styles = headingStyles(read('word/styles.xml'));
  const noteTexts = commentTexts(read('word/comments.xml'));
  const commentIds = new Map<string, string>(); // Word's id → ours
  const open = new Set<string>(); // Word comment ids currently spanning the text
  let highlights = 0;

  const paras: Para[] = [];
  let pageBreakPending = false;

  const readParagraph = (p: Element) => {
    const pPr = child(p, 'pPr');
    const styleId = attr(child(pPr, 'pStyle'), 'val') ?? '';
    const outline = attr(child(pPr, 'outlineLvl'), 'val');
    let level = styles.get(styleId) ?? (/^heading(\d)$/i.test(styleId) ? Number(styleId.slice(7)) : /^title$/i.test(styleId) ? -1 : 0);
    if (!level && outline !== null && Number(outline) < 6) level = Number(outline) + 1;
    const para: Para = { level, content: [], text: '', pageBreakBefore: pageBreakPending || isOn(child(pPr, 'pageBreakBefore')) };
    pageBreakPending = false;

    const runText = (r: Element, inherited: Element | null) => {
      const rPr = child(r, 'rPr') ?? inherited;
      const marks: TextNode['marks'] = [];
      if (isOn(child(rPr, 'b'))) marks.push({ type: 'bold' });
      if (isOn(child(rPr, 'i'))) marks.push({ type: 'italic' });
      if (isOn(child(rPr, 'u'))) marks.push({ type: 'underline' });
      if (isOn(child(rPr, 'strike'))) marks.push({ type: 'strike' });
      const hl = attr(child(rPr, 'highlight'), 'val');
      const shade = attr(child(rPr, 'shd'), 'fill');
      const color = (hl && WORD_HIGHLIGHT[hl]) || (shade ? shadeToHighlight(shade) : null);
      if (color) marks.push({ type: 'highlight', attrs: { color } });
      for (const id of open) {
        const note = noteTexts.get(id);
        if (!note) continue;
        if (!commentIds.has(id)) commentIds.set(id, newId());
        marks.push({ type: 'comment', attrs: { id: commentIds.get(id), text: note.text, author: note.author, at: note.at } });
      }
      for (const c of kids(r)) {
        const name = c.localName;
        let text = '';
        if (name === 't') text = c.textContent ?? '';
        else if (name === 'tab' || name === 'ptab') text = ' ';
        else if (name === 'noBreakHyphen') text = '-';
        else if (name === 'softHyphen') text = '';
        else if (name === 'br' || name === 'cr') {
          if (attr(c, 'type') === 'page') {
            if (para.content.length) pageBreakPending = true;
            else para.pageBreakBefore = true;
          } else para.content.push({ type: 'hardBreak' });
          continue;
        }
        if (!text) continue;
        const last = para.content[para.content.length - 1] as TextNode | undefined;
        const same = last?.type === 'text' && JSON.stringify(last.marks ?? []) === JSON.stringify(marks);
        if (same) last!.text += text;
        else para.content.push(marks.length ? { type: 'text', text, marks: marks.map((m) => ({ ...m })) } : { type: 'text', text });
        para.text += text;
      }
    };

    const walk = (el: Element) => {
      for (const c of kids(el)) {
        const name = c.localName;
        if (name === 'r') runText(c, null);
        else if (name === 'commentRangeStart') open.add(attr(c, 'id') ?? '');
        else if (name === 'commentRangeEnd') open.delete(attr(c, 'id') ?? '');
        else if (['hyperlink', 'ins', 'smartTag', 'fldSimple', 'customXml', 'sdt', 'sdtContent', 'moveTo'].includes(name)) walk(c);
        // w:del and w:moveFrom are deleted text (tracked changes): left out.
      }
    };
    walk(p);
    paras.push(para);
  };

  const walkBody = (el: Element) => {
    for (const c of kids(el)) {
      if (c.localName === 'p') readParagraph(c);
      else if (c.localName === 'tbl') for (const p of Array.from(c.getElementsByTagNameNS('*', 'p'))) readParagraph(p);
      else if (['sdt', 'sdtContent', 'customXml'].includes(c.localName)) walkBody(c);
    }
  };
  const body = parseXml(main).getElementsByTagNameNS('*', 'body')[0];
  if (!body) throw new DocxError('That Word file has no text.');
  walkBody(body);

  // Trim spaces Word leaves at the ends of paragraphs.
  for (const p of paras) {
    p.text = p.text.trim();
    const first = p.content[0];
    if (first?.type === 'text') first.text = first.text.replace(/^\s+/, '');
    const last = p.content[p.content.length - 1];
    if (last?.type === 'text') last.text = last.text.replace(/\s+$/, '');
    p.content = p.content.filter((n) => n.type !== 'text' || n.text);
  }

  // Highlighted stretches (a run of highlighted words counts once).
  for (const p of paras) {
    let on = false;
    for (const n of p.content) {
      const lit = n.type === 'text' && !!n.marks?.some((m) => m.type === 'highlight');
      if (lit && !on) highlights++;
      on = lit;
    }
  }

  const titlePara = paras.find((p) => p.level === -1 && p.text);
  const title = titlePara?.text ?? null;
  const body_ = paras.filter((p) => p.level !== -1);

  // Which paragraphs start a chapter: the top heading level used, else "Chapter …" lines, else page breaks.
  const levels = [...new Set(body_.filter((p) => p.level > 0 && p.text).map((p) => p.level))].sort();
  const top = levels[0] ?? 0;
  let starts: (p: Para) => boolean;
  if (top) starts = (p) => p.level === top && !!p.text;
  else if (body_.some((p) => CHAPTER_LINE.test(p.text))) starts = (p) => CHAPTER_LINE.test(p.text) && p.text.length < 110;
  else if (body_.filter((p) => p.pageBreakBefore && p.text).length >= 2) starts = (p) => p.pageBreakBefore && !!p.text && p.text.length < 110;
  else starts = () => false;

  const chapters: { title: string; paras: Para[]; front: boolean }[] = [];
  for (const p of body_) {
    if (starts(p)) chapters.push({ title: p.text.replace(/\s+/g, ' ').trim(), paras: [], front: false });
    else {
      if (!chapters.length) chapters.push({ title: title ?? 'Chapter 1', paras: [], front: false });
      chapters[chapters.length - 1].paras.push(p);
    }
  }
  // Text before the first heading, when there are headings, is usually a title page or front matter.
  if (chapters.length > 1 && !starts(body_.find((p) => p.text) ?? body_[0])) {
    chapters[0].front = true;
    chapters[0].title = 'Before the first chapter';
  }

  const out: DocxChapter[] = chapters
    .map((c) => {
      const content: Node[] = [];
      for (const p of c.paras) {
        if (!p.text && !p.content.some((n) => n.type === 'hardBreak')) continue;
        if (SCENE_BREAK.test(p.text)) content.push({ type: 'horizontalRule' } as Node);
        else if (p.level > 0) content.push({ type: 'heading', attrs: { level: Math.min(3, Math.max(2, p.level - top + 2)) }, content: p.content } as Node);
        else content.push({ type: 'paragraph', content: p.content } as Node);
      }
      const words = c.paras.reduce((n, p) => n + countWords(p.text), 0);
      return { title: c.title, doc: { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] } as DocJson, words, frontMatter: c.front };
    })
    .filter((c) => c.words > 0 || !c.frontMatter);

  if (!out.length || out.every((c) => c.words === 0)) throw new DocxError('That Word file has no text to bring in.');
  return { title, chapters: out, comments: commentIds.size, highlights };
}

/** True for a Google Drive shortcut (.gdoc), which holds a link, not the document. */
export const isGoogleShortcut = (name: string) => /\.gdoc$/i.test(name);

