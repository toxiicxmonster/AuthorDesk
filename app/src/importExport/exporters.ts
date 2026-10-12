import { strToU8, zipSync } from 'fflate';
import { collectProject, type ProjectData } from './archive';
import type { Book, Chapter, DocJson, ReferenceEntry, Scene } from '../domain/schema';
import { REFERENCE_TEMPLATES, REFERENCE_TYPE_LABELS } from '../domain/referenceTemplates';
import { chronological } from '../domain/continuity';
import type { PmNode } from '../domain/text';

/** Ordered manuscript for one book: chapters (live, ordered) with their live scenes. */
export function bookManuscript(data: ProjectData, bookId: string): { book: Book; chapters: { chapter: Chapter; scenes: Scene[] }[] } {
  const book = data.books.find((b) => b.id === bookId);
  if (!book) throw new Error('Book not found');
  const chapters = data.chapters.filter((c) => c.bookId === bookId && !c.archivedAt).sort((a, b) => a.order - b.order);
  return {
    book,
    chapters: chapters.map((chapter) => ({
      chapter,
      scenes: data.scenes.filter((s) => s.chapterId === chapter.id && !s.archivedAt).sort((a, b) => a.order - b.order),
    })),
  };
}

// ---------- Markdown ----------

function inlineMd(node: PmNode): string {
  if (node.type === 'hardBreak') return '  \n';
  if (node.type !== 'text') return (node.content ?? []).map(inlineMd).join('');
  let t = (node.text ?? '').replace(/([*_`\\])/g, '\\$1');
  const marks = node.marks?.map((m) => m.type) ?? [];
  if (marks.includes('bold')) t = `**${t}**`;
  if (marks.includes('italic')) t = `*${t}*`;
  if (marks.includes('strike')) t = `~~${t}~~`;
  return t;
}

export function docToMarkdown(doc: DocJson | null | undefined): string {
  if (!doc) return '';
  const out: string[] = [];
  const block = (n: PmNode, prefix = ''): void => {
    switch (n.type) {
      case 'paragraph':
        out.push(prefix + inlineMd(n));
        break;
      case 'heading':
        out.push(prefix + '#'.repeat(Math.min(6, Number(n.attrs?.level ?? 2) + 1)) + ' ' + inlineMd(n));
        break;
      case 'horizontalRule':
        out.push(prefix + '* * *');
        break;
      case 'blockquote':
        (n.content ?? []).forEach((c) => block(c, prefix + '> '));
        break;
      case 'bulletList':
        (n.content ?? []).forEach((li) => (li.content ?? []).forEach((c) => block(c, prefix + '- ')));
        break;
      case 'orderedList':
        (n.content ?? []).forEach((li, i) => (li.content ?? []).forEach((c) => block(c, `${prefix}${i + 1}. `)));
        break;
      default:
        (n.content ?? []).forEach((c) => block(c, prefix));
    }
  };
  ((doc as PmNode).content ?? []).forEach((n) => block(n));
  return out.join('\n\n').trim();
}

function safeName(s: string): string {
  // eslint-disable-next-line no-control-regex
  return (s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim() || 'Untitled').slice(0, 80);
}

function referenceMarkdown(r: ReferenceEntry, all: ReferenceEntry[]): string {
  const lines = [`# ${r.name}`, '', `*${REFERENCE_TYPE_LABELS[r.type]}*${r.status ? ` · ${r.status}` : ''}`];
  if (r.aliases.length) lines.push('', `**Also known as:** ${r.aliases.join(', ')}`);
  if (r.summary) lines.push('', r.summary);
  for (const f of REFERENCE_TEMPLATES[r.type]) if (r.fields[f.key]?.trim()) lines.push('', `## ${f.label}`, '', r.fields[f.key]);
  for (const [k, v] of Object.entries(r.fields)) if (v.trim() && !REFERENCE_TEMPLATES[r.type].some((f) => f.key === k)) lines.push('', `## ${k}`, '', v);
  if (r.links.length) {
    lines.push('', '## Connections', '');
    for (const l of r.links) lines.push(`- ${all.find((x) => x.id === l.targetId)?.name ?? '(missing)'}${l.label ? ` — ${l.label}` : ''}`);
  }
  if (r.notes) lines.push('', '## Notes', '', r.notes);
  if (r.tags.length) lines.push('', `Tags: ${r.tags.join(', ')}`);
  return lines.join('\n') + '\n';
}

/** Markdown export: a zip with one folder per book, one file per chapter, plus reference notes. */
export async function exportMarkdownZip(projectId: string): Promise<Uint8Array> {
  const data = await collectProject(projectId);
  const files: Record<string, Uint8Array> = {};
  const root = safeName(data.projects[0].name);
  for (const book of data.books.filter((b) => !b.archivedAt).sort((a, b) => a.order - b.order)) {
    const { chapters } = bookManuscript(data, book.id);
    chapters.forEach(({ chapter, scenes }, i) => {
      const parts = [`# ${chapter.title}`];
      if (chapter.summary) parts.push(`<!-- Summary: ${chapter.summary.replace(/-->/g, '—>')} -->`);
      scenes.forEach((s, si) => {
        if (scenes.length > 1) parts.push(`## ${s.title}`);
        else if (si > 0) parts.push('* * *');
        parts.push(docToMarkdown(s.content));
      });
      files[`${root}/${safeName(book.title)}/${String(i + 1).padStart(2, '0')} - ${safeName(chapter.title)}.md`] = strToU8(parts.join('\n\n') + '\n');
    });
  }
  const refs = data.references.filter((r) => !r.archivedAt);
  for (const r of refs) files[`${root}/References/${safeName(REFERENCE_TYPE_LABELS[r.type])}/${safeName(r.name)}.md`] = strToU8(referenceMarkdown(r, refs));
  for (const n of data.notes.filter((n) => !n.archivedAt)) {
    files[`${root}/Notes/${safeName(n.title)}.md`] = strToU8(`# ${n.title}\n\n${n.url ? `Source: ${n.url}\n\n` : ''}${n.body}\n`);
  }
  const threads = data.plotThreads.filter((t) => !t.archivedAt);
  if (threads.length) {
    files[`${root}/Plot Threads.md`] = strToU8(
      '# Plot threads\n\n' + threads.map((t) => `## ${t.name} (${t.status})\n\n${t.description}\n\n**Stakes:** ${t.stakes}\n\n**Resolution:** ${t.resolution}`).join('\n\n') + '\n',
    );
  }
  const events = chronological(data.timelineEvents.filter((e) => !e.archivedAt));
  if (events.length) {
    files[`${root}/Timeline.md`] = strToU8('# Timeline\n\n' + events.map((e) => `- **${e.when || 'Undated'}** — ${e.title}${e.description ? `: ${e.description}` : ''}`).join('\n') + '\n');
  }
  return zipSync(files);
}

/** Plain-text manuscript for a book. */
export async function exportText(projectId: string, bookId: string): Promise<string> {
  const data = await collectProject(projectId);
  const { book, chapters } = bookManuscript(data, bookId);
  const out = [book.title.toUpperCase(), book.subtitle, ''].filter((x, i) => x || i === 2);
  for (const { chapter, scenes } of chapters) {
    out.push('', '', chapter.title, '');
    scenes.forEach((s, i) => {
      if (i > 0) out.push('', '* * *', '');
      out.push(s.plainText);
    });
  }
  return out.join('\n').replace(/\n{4,}/g, '\n\n\n') + '\n';
}

/** DOCX manuscript for a book (standard manuscript-style: chapters start on a new page). */
export async function exportDocx(projectId: string, bookId: string): Promise<Blob> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, PageBreak } = await import('docx');
  const data = await collectProject(projectId);
  const { book, chapters } = bookManuscript(data, bookId);

  const runs = (n: PmNode): InstanceType<typeof TextRun>[] => {
    if (n.type === 'text') {
      const m = n.marks?.map((x) => x.type) ?? [];
      return [new TextRun({ text: n.text ?? '', bold: m.includes('bold'), italics: m.includes('italic'), underline: m.includes('underline') ? {} : undefined, strike: m.includes('strike') })];
    }
    if (n.type === 'hardBreak') return [new TextRun({ text: '', break: 1 })];
    return (n.content ?? []).flatMap(runs);
  };

  const paras: InstanceType<typeof Paragraph>[] = [];
  const blocks = (n: PmNode, quote = false) => {
    switch (n.type) {
      case 'paragraph':
        paras.push(new Paragraph({ children: runs(n), indent: quote ? { left: 720, right: 720 } : { firstLine: 360 }, spacing: { line: 480 } }));
        break;
      case 'heading':
        paras.push(new Paragraph({ children: runs(n), heading: HeadingLevel.HEADING_2 }));
        break;
      case 'horizontalRule':
        paras.push(new Paragraph({ children: [new TextRun('* * *')], alignment: AlignmentType.CENTER, spacing: { before: 240, after: 240 } }));
        break;
      case 'blockquote':
        (n.content ?? []).forEach((c) => blocks(c, true));
        break;
      default:
        (n.content ?? []).forEach((c) => blocks(c, quote));
    }
  };

  paras.push(new Paragraph({ children: [new TextRun({ text: book.title, size: 48, bold: true })], alignment: AlignmentType.CENTER, spacing: { before: 3000 } }));
  if (book.subtitle) paras.push(new Paragraph({ children: [new TextRun({ text: book.subtitle, size: 32 })], alignment: AlignmentType.CENTER }));
  for (const { chapter, scenes } of chapters) {
    paras.push(new Paragraph({ children: [new PageBreak()] }));
    paras.push(new Paragraph({ text: chapter.title, heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, spacing: { before: 1200, after: 600 } }));
    scenes.forEach((s, i) => {
      if (i > 0) paras.push(new Paragraph({ children: [new TextRun('* * *')], alignment: AlignmentType.CENTER, spacing: { before: 240, after: 240 } }));
      ((s.content as PmNode).content ?? []).forEach((n) => blocks(n));
    });
  }
  const doc = new Document({
    creator: 'AuthorDesk',
    title: book.title,
    styles: { default: { document: { run: { font: 'Times New Roman', size: 24 } } } },
    sections: [{ children: paras }],
  });
  return Packer.toBlob(doc);
}

function csvCell(v: string): string {
  const s = v.replace(/\r?\n/g, ' ');
  // Prevent spreadsheet formula injection.
  const safe = /^[=+\-@\t]/.test(s) ? `'${s}` : s;
  return /[",]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** CSV of reference entries (one row per entry, union of all template and custom fields). */
export async function exportReferencesCsv(projectId: string): Promise<string> {
  const data = await collectProject(projectId);
  const refs = data.references.filter((r) => !r.archivedAt).sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  const fieldKeys = [...new Set(refs.flatMap((r) => Object.keys(r.fields)))];
  const header = ['id', 'type', 'name', 'aliases', 'summary', 'status', 'tags', 'favorite', ...fieldKeys, 'notes'];
  const rows = refs.map((r) => [r.id, r.type, r.name, r.aliases.join('; '), r.summary, r.status, r.tags.join('; '), r.favorite ? 'yes' : '', ...fieldKeys.map((k) => r.fields[k] ?? ''), r.notes]);
  return '﻿' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
