import { describe, expect, it } from 'vitest';
import { CommentRangeEnd, CommentRangeStart, CommentReference, Document, HeadingLevel, Packer, PageBreak, Paragraph, TextRun } from 'docx';
import { DocxError, readDocx } from '../src/importExport/docxImport';

const bytes = async (doc: Document) => new Uint8Array(await Packer.toBuffer(doc));
let n = 0;
const ids = () => `c${++n}`;

const text = (doc: unknown): string => JSON.stringify(doc);

describe('reading a Word or Google Docs file', () => {
  it('makes a chapter of each top heading, keeping emphasis, scene breaks, highlights and comments', async () => {
    const doc = new Document({
      comments: { children: [{ id: 0, author: 'Editor Jo', date: new Date('2026-01-02'), children: [new Paragraph('Too early for this?')] }] },
      sections: [
        {
          children: [
            new Paragraph({ text: 'The Salt Lamp', heading: HeadingLevel.TITLE }),
            new Paragraph({ text: 'Chapter One', heading: HeadingLevel.HEADING_1 }),
            new Paragraph({ children: [new TextRun('Mara climbed the '), new TextRun({ text: 'two hundred', italics: true }), new TextRun(' steps.')] }),
            new Paragraph('* * *'),
            new Paragraph({
              children: [
                new TextRun('Then '),
                new CommentRangeStart(0),
                new TextRun({ text: 'the lamp', highlight: 'yellow' }),
                new CommentRangeEnd(0),
                new TextRun({ children: [new CommentReference(0)] }),
                new TextRun(' went out.'),
              ],
            }),
            new Paragraph({ text: 'Chapter Two', heading: HeadingLevel.HEADING_1 }),
            new Paragraph({ children: [new TextRun({ text: 'Tobias', bold: true }), new TextRun(' waited below.')] }),
          ],
        },
      ],
    });
    const book = readDocx(await bytes(doc), ids);
    expect(book.title).toBe('The Salt Lamp');
    expect(book.chapters.map((c) => [c.title, c.words, c.frontMatter])).toEqual([
      ['Chapter One', 11, false],
      ['Chapter Two', 3, false],
    ]);
    const one = book.chapters[0].doc.content!;
    expect(one[0]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'Mara climbed the ' }, { type: 'text', text: 'two hundred', marks: [{ type: 'italic' }] }, { type: 'text', text: ' steps.' }],
    });
    expect(one[1]).toEqual({ type: 'horizontalRule' });
    const lit = (one[2] as { content: { text: string; marks?: { type: string; attrs?: Record<string, unknown> }[] }[] }).content.find((t) => t.text === 'the lamp')!;
    expect(lit.marks).toEqual([
      { type: 'highlight', attrs: { color: 'yellow' } },
      { type: 'comment', attrs: { id: 'c1', text: 'Too early for this?', author: 'Editor Jo', at: expect.stringMatching(/^2026-01-02/) } },
    ]);
    expect(text(book.chapters[1].doc)).toContain('"marks":[{"type":"bold"}]');
    expect(book.comments).toBe(1);
    expect(book.highlights).toBe(1);
  });

  it('finds “Chapter …” lines when there are no headings, and sets a title page aside', async () => {
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph('My Book'),
            new Paragraph('by Me'),
            new Paragraph({ children: [new PageBreak()] }),
            new Paragraph('Chapter 1: The Start'),
            new Paragraph('It began here.'),
            new Paragraph('Chapter 2'),
            new Paragraph('And went on.'),
          ],
        },
      ],
    });
    const book = readDocx(await bytes(doc), ids);
    expect(book.title).toBeNull();
    expect(book.chapters.map((c) => [c.title, c.words, c.frontMatter])).toEqual([
      ['Before the first chapter', 4, true],
      ['Chapter 1: The Start', 3, false],
      ['Chapter 2', 3, false],
    ]);
  });

  it('keeps a document without chapter breaks as one chapter', async () => {
    const book = readDocx(await bytes(new Document({ sections: [{ children: [new Paragraph('One paragraph.'), new Paragraph('Another one.')] }] })), ids);
    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0]).toMatchObject({ title: 'Chapter 1', words: 4, frontMatter: false });
  });

  it('says plainly when the file isn’t a Word document', () => {
    expect(() => readDocx(new TextEncoder().encode('just some text'))).toThrow(DocxError);
    expect(() => readDocx(new TextEncoder().encode('just some text'))).toThrow(/download it as “Word document/);
  });
});
