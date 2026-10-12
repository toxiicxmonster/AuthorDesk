import type { DocJson } from '../domain/schema';
import { createChapter, createScene } from '../storage/repo';

export interface ImportedChapter {
  title: string;
  doc: DocJson;
}

const HEADING = /^(?:#{1,2}\s+(.+)|((?:chapter|part|prologue|epilogue)\b.*))$/i;

export function inline(text: string): DocJson['content'] {
  // Minimal Markdown emphasis: **bold** and *italic* / _italic_.
  const out: unknown[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) });
    const t = m[0];
    if (t.startsWith('**')) out.push({ type: 'text', text: t.slice(2, -2), marks: [{ type: 'bold' }] });
    else out.push({ type: 'text', text: t.slice(1, -1), marks: [{ type: 'italic' }] });
    last = m.index + t.length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out.filter((n) => (n as { text: string }).text);
}

/**
 * Split plain text or Markdown into chapters. Chapter breaks are Markdown headings ("# Title")
 * or lines starting with "Chapter", "Part", "Prologue" or "Epilogue". Paragraphs are separated by blank
 * lines (or single newlines when the file has no blank lines at all).
 */
export function parseManuscriptText(raw: string, fallbackTitle = 'Imported text'): ImportedChapter[] {
  const text = raw.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
  const singleSpaced = !/\n\s*\n/.test(text);
  const lines = text.split('\n');
  const chapters: { title: string; paras: string[] }[] = [];
  let cur: { title: string; paras: string[] } | null = null;
  let buf: string[] = [];
  const flush = () => {
    const p = buf.join(' ').trim();
    if (p) {
      if (!cur) {
        cur = { title: fallbackTitle, paras: [] };
        chapters.push(cur);
      }
      cur.paras.push(p);
    }
    buf = [];
  };
  for (const line of lines) {
    const t = line.trim();
    const h = t.length < 120 ? t.match(HEADING) : null;
    if (h) {
      flush();
      cur = { title: (h[1] ?? h[2]).trim(), paras: [] };
      chapters.push(cur);
    } else if (!t) {
      flush();
    } else if (singleSpaced) {
      buf.push(t);
      flush();
    } else {
      buf.push(t);
    }
  }
  flush();
  return chapters.map((c) => ({
    title: c.title,
    doc: {
      type: 'doc',
      content: c.paras.length
        ? c.paras.map((p) => (/^(\*\s*\*\s*\*|#{1}|\*{3}|-{3})$/.test(p) ? { type: 'horizontalRule' } : { type: 'paragraph', content: inline(p) }))
        : [{ type: 'paragraph' }],
    },
  }));
}

export async function importChapters(projectId: string, bookId: string, chapters: ImportedChapter[]) {
  for (const c of chapters) {
    const ch = await createChapter(projectId, bookId, c.title, { withScene: false });
    await createScene(projectId, ch.id, 'Scene 1', c.doc);
  }
}
