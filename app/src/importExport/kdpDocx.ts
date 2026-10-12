/**
 * Word (.docx) manuscripts formatted for Amazon KDP.
 *  - eBook: reflowable; chapter titles use the Heading 1 style so Kindle builds the table of contents,
 *    page breaks before chapters, no headers/footers or page numbers.
 *  - Print (paperback/hardcover interior): exact trim size, mirrored margins with KDP's gutter rules,
 *    centred page numbers (none on chapter openings), title/copyright pages, chapters on new (or right-hand) pages.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { PmNode } from '../domain/text';
import { tocEntry, type PrintLayout, type PublishModel } from './publish';

export interface KdpDocxOptions {
  target: 'ebook' | 'print';
  layout?: PrintLayout;
  font: string;
  /** Start each chapter on a right-hand (odd) page — traditional for print. */
  chaptersOnRight: boolean;
}

const TWIP = 1440; // per inch

export async function buildKdpDocx(model: PublishModel, opts: KdpDocxOptions): Promise<Uint8Array> {
  const d = await import('docx');
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Footer, PageNumber, SectionType, Bookmark, InternalHyperlink, PageReference, Tab, TabStopType, LeaderType } = d;
  const print = opts.target === 'print' && !!opts.layout;
  const size = (opts.layout?.fontSize ?? 12) * 2; // half-points
  const { info, options } = model;

  const runs = (nodes: PmNode[] | undefined): InstanceType<typeof TextRun>[] =>
    (nodes ?? []).flatMap((n) => {
      if (n.type === 'hardBreak') return [new TextRun({ text: '', break: 1 })];
      if (n.type !== 'text') return runs(n.content);
      const m = n.marks?.map((x) => x.type) ?? [];
      return [new TextRun({ text: n.text ?? '', italics: m.includes('italic'), bold: m.includes('bold'), underline: m.includes('underline') ? {} : undefined, strike: m.includes('strike') })];
    });

  const body = (blocks: PmNode[]) => {
    const out: InstanceType<typeof Paragraph>[] = [];
    let first = true;
    const walk = (b: PmNode, quote = false) => {
      switch (b.type) {
        case 'paragraph': {
          if (!b.content?.length) return;
          out.push(new Paragraph({ style: first || quote ? 'BodyFirst' : 'Body', children: runs(b.content), indent: quote ? { left: 720, right: 720 } : undefined }));
          first = false;
          return;
        }
        case 'heading':
          out.push(new Paragraph({ style: 'SceneTitle', children: runs(b.content) }));
          first = true;
          return;
        case 'horizontalRule':
          out.push(new Paragraph({ style: 'SceneBreak', children: [new TextRun('* * *')] }));
          first = true;
          return;
        case 'blockquote':
          (b.content ?? []).forEach((c) => walk(c, true));
          first = true;
          return;
        default:
          (b.content ?? []).forEach((c) => walk(c, quote));
      }
    };
    blocks.forEach((b) => walk(b));
    return out;
  };

  const chapterOpening = (label: string, title: string, breakBefore: boolean, bookmark: string) => [
    ...(label ? [new Paragraph({ style: 'ChapterLabel', pageBreakBefore: breakBefore, children: [new TextRun(label.toUpperCase())] })] : []),
    new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: breakBefore && !label, children: [new Bookmark({ id: bookmark, children: [new TextRun(title)] })] }),
  ];
  const bookmarkFor = (i: number) => `chapter_${i + 1}`;
  const hasAbout = options.includeAboutAuthor && !!info.aboutAuthor.trim();

  /** A "Contents" page: linked entries (eBook) or entries with dot leaders and page numbers (print). */
  const contents = (breakBefore: boolean, textWidthTwips?: number) => {
    const entries = model.chapters.map((c, i) => ({ text: tocEntry(c), anchor: bookmarkFor(i) }));
    if (hasAbout) entries.push({ text: 'About the Author', anchor: 'about_author' });
    const withNumbers = print && options.tocPageNumbers && textWidthTwips;
    return [
      new Paragraph({ style: 'ContentsTitle', pageBreakBefore: breakBefore, children: [new TextRun('Contents')] }),
      ...entries.map((e) =>
        withNumbers
          ? new Paragraph({
              style: 'ContentsEntry',
              tabStops: [{ type: TabStopType.RIGHT, position: textWidthTwips, leader: LeaderType.DOT }],
              children: [new InternalHyperlink({ anchor: e.anchor, children: [new TextRun(e.text)] }), new TextRun({ children: [new Tab()] }), new PageReference(e.anchor)],
            })
          : new Paragraph({ style: 'ContentsEntry', children: [new InternalHyperlink({ anchor: e.anchor, children: [new TextRun({ text: e.text, style: print ? undefined : 'Hyperlink' })] })] }),
      ),
    ];
  };

  const front: InstanceType<typeof Paragraph>[] = [];
  if (options.includeTitlePage) {
    front.push(new Paragraph({ style: 'BookTitle', children: [new TextRun(model.title)] }));
    if (model.subtitle) front.push(new Paragraph({ style: 'BookSubtitle', children: [new TextRun(model.subtitle)] }));
    if (info.author) front.push(new Paragraph({ style: 'BookAuthor', children: [new TextRun(info.author)] }));
    if (info.publisher && print) front.push(new Paragraph({ style: 'Imprint', children: [new TextRun(info.publisher)] }));
  }
  if (options.includeCopyright) {
    const lines = [
      `Copyright © ${info.copyrightYear} ${info.author}`.trim(),
      'All rights reserved. No part of this book may be reproduced in any form without written permission from the author, except for brief quotations in a review.',
      'This is a work of fiction. Names, characters, places and incidents are products of the author’s imagination or are used fictitiously.',
      info.isbn ? `ISBN: ${info.isbn}` : '',
      info.publisher ? `Published by ${info.publisher}` : '',
    ].filter(Boolean);
    lines.forEach((l, i) => front.push(new Paragraph({ style: 'Copyright', pageBreakBefore: i === 0 && front.length > 0, children: [new TextRun(l)] })));
  }
  if (options.includeDedication && info.dedication.trim()) {
    info.dedication
      .split(/\n{2,}/)
      .filter((p) => p.trim())
      .forEach((p, i) => front.push(new Paragraph({ style: 'Dedication', pageBreakBefore: i === 0 && front.length > 0, children: [new TextRun(p.trim())] })));
  }
  const about = hasAbout
      ? [
          new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new Bookmark({ id: 'about_author', children: [new TextRun('About the Author')] })] }),
          ...info.aboutAuthor
            .split(/\n{2,}/)
            .filter((p) => p.trim())
            .map((p, i) => new Paragraph({ style: i === 0 ? 'BodyFirst' : 'Body', children: [new TextRun(p.trim())] })),
        ]
      : [];

  const bodyFont = { ascii: opts.font, hAnsi: opts.font, cs: opts.font, eastAsia: opts.font };
  const styles = {
    default: { document: { run: { font: bodyFont, size } } },
    paragraphStyles: [
      { id: 'Body', name: 'Body Text Indent', basedOn: 'Normal', quickFormat: true, run: { font: bodyFont, size }, paragraph: { indent: { firstLine: Math.round(0.3 * TWIP) }, spacing: { line: print ? 276 : 300, after: 0, before: 0 }, alignment: print ? AlignmentType.JUSTIFIED : AlignmentType.LEFT } },
      { id: 'BodyFirst', name: 'Body Text First', basedOn: 'Body', quickFormat: true, paragraph: { indent: { firstLine: 0 } } },
      { id: 'SceneBreak', name: 'Scene Break', basedOn: 'Normal', quickFormat: true, run: { font: bodyFont, size }, paragraph: { alignment: AlignmentType.CENTER, spacing: { before: 240, after: 240 }, keepNext: true } },
      { id: 'SceneTitle', name: 'Scene Title', basedOn: 'Normal', quickFormat: true, run: { font: bodyFont, size, italics: true }, paragraph: { alignment: AlignmentType.CENTER, spacing: { before: 360, after: 240 }, keepNext: true } },
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'BodyFirst', quickFormat: true, run: { font: bodyFont, size: size + 12, bold: false }, paragraph: { alignment: AlignmentType.CENTER, spacing: { before: print ? 0 : 480, after: 720 }, keepNext: true, outlineLevel: 0 } },
      { id: 'ChapterLabel', name: 'Chapter Label', basedOn: 'Normal', next: 'Heading1', quickFormat: true, run: { font: bodyFont, size: size - 2, characterSpacing: 40 }, paragraph: { alignment: AlignmentType.CENTER, spacing: { before: print ? 0 : 480, after: 240 }, keepNext: true } },
      { id: 'BookTitle', name: 'Book Title', basedOn: 'Normal', quickFormat: true, run: { font: bodyFont, size: size * 2 + 8 }, paragraph: { alignment: AlignmentType.CENTER, spacing: { before: print ? 2880 : 1440, after: 360 } } },
      { id: 'BookSubtitle', name: 'Book Subtitle', basedOn: 'Normal', quickFormat: true, run: { font: bodyFont, size: size + 6, italics: true }, paragraph: { alignment: AlignmentType.CENTER, spacing: { after: 720 } } },
      { id: 'BookAuthor', name: 'Book Author', basedOn: 'Normal', quickFormat: true, run: { font: bodyFont, size: size + 6 }, paragraph: { alignment: AlignmentType.CENTER, spacing: { before: 720 } } },
      { id: 'Imprint', name: 'Imprint', basedOn: 'Normal', quickFormat: true, run: { font: bodyFont, size: size - 2 }, paragraph: { alignment: AlignmentType.CENTER, spacing: { before: 2880 } } },
      { id: 'Copyright', name: 'Copyright Text', basedOn: 'Normal', quickFormat: true, run: { font: bodyFont, size: size - 4 }, paragraph: { spacing: { after: 160, line: 260 } } },
      { id: 'ContentsTitle', name: 'Contents Title', basedOn: 'Normal', next: 'ContentsEntry', quickFormat: true, run: { font: bodyFont, size: size + 8 }, paragraph: { alignment: AlignmentType.CENTER, spacing: { before: print ? 1440 : 480, after: 600 } } },
      { id: 'ContentsEntry', name: 'Contents Entry', basedOn: 'Normal', quickFormat: true, run: { font: bodyFont, size }, paragraph: { spacing: { after: 160 } } },
      { id: 'Dedication', name: 'Dedication', basedOn: 'Normal', quickFormat: true, run: { font: bodyFont, size, italics: true }, paragraph: { alignment: AlignmentType.CENTER, spacing: { before: print ? 2880 : 1440 } } },
    ],
  };

  let doc: InstanceType<typeof Document>;
  if (!print) {
    // eBook: one flowing section; KDP builds the Kindle table of contents from Heading 1.
    const children = [...front];
    if (options.includeToc) children.push(...contents(children.length > 0));
    model.chapters.forEach((c, i) => {
      children.push(...chapterOpening(c.label, c.title, children.length > 0, bookmarkFor(i)));
      children.push(...body(c.blocks));
    });
    children.push(...about);
    doc = new Document({ creator: info.author || 'AuthorDesk', title: model.title, styles, sections: [{ children }] });
  } else {
    const L = opts.layout!;
    const page = {
      size: { width: Math.round(L.trim.width * TWIP), height: Math.round(L.trim.height * TWIP) },
      // With mirrored margins (switched on below), "left" is the inside/gutter edge and "right" the outside.
      margin: { top: Math.round(L.margins.top * TWIP), bottom: Math.round(L.margins.bottom * TWIP), left: Math.round(L.margins.inside * TWIP), right: Math.round(L.margins.outside * TWIP), header: 360, footer: Math.round(0.4 * TWIP), gutter: 0 },
    };
    const folio = () =>
      new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], size: size - 2, font: bodyFont })] })] });
    const blankFooter = () => new Footer({ children: [new Paragraph({ children: [] })] });
    const sections = [];
    if (front.length) sections.push({ properties: { page }, footers: { default: blankFooter() }, children: front });
    if (options.includeToc) {
      const textWidth = Math.round((L.trim.width - L.margins.inside - L.margins.outside) * TWIP);
      sections.push({ properties: { page, type: SectionType.ODD_PAGE }, footers: { default: blankFooter() }, children: contents(false, textWidth) });
    }
    model.chapters.forEach((c, i) => {
      sections.push({
        properties: {
          page: { ...page, pageNumbers: i === 0 ? { start: 1 } : undefined },
          type: opts.chaptersOnRight || (i === 0 && (front.length || options.includeToc)) ? SectionType.ODD_PAGE : SectionType.NEXT_PAGE,
          titlePage: true, // no page number on the chapter's opening page
        },
        footers: { default: folio(), first: blankFooter() },
        children: [
          // Chapter openings sit about a third of the way down the page.
          new Paragraph({ spacing: { before: Math.round(L.trim.height * TWIP * 0.18) }, children: [] }),
          ...chapterOpening(c.label, c.title, false, bookmarkFor(i)),
          ...body(c.blocks),
        ],
      });
    });
    if (about.length) {
      sections.push({ properties: { page, type: SectionType.ODD_PAGE }, footers: { default: blankFooter() }, children: about.map((p, i) => (i === 0 ? new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new Bookmark({ id: 'about_author', children: [new TextRun('About the Author')] })] }) : p)) });
    }
    doc = new Document({ creator: info.author || 'AuthorDesk', title: model.title, styles, sections, features: { updateFields: options.includeToc && options.tocPageNumbers } });
  }

  const bytes = new Uint8Array(await (await Packer.toBlob(doc)).arrayBuffer());
  return print ? withMirrorMargins(bytes) : bytes;
}

/**
 * Word's "mirror margins" setting (inside/outside instead of left/right) isn't exposed by the docx
 * library, so it is added to word/settings.xml after generation. Without it, the gutter would be on the
 * wrong side of every left-hand page.
 */
export function withMirrorMargins(docx: Uint8Array): Uint8Array {
  const files = unzipSync(docx);
  const path = 'word/settings.xml';
  const xml = files[path] ? strFromU8(files[path]) : null;
  if (!xml || xml.includes('<w:mirrorMargins')) return docx;
  // Element order matters in OOXML (CT_Settings is a sequence): mirrorMargins must follow these elements.
  const before = [
    'writeProtection', 'view', 'zoom', 'removePersonalInformation', 'removeDateAndTime', 'doNotDisplayPageBoundaries',
    'displayBackgroundShape', 'printPostScriptOverText', 'printFractionalCharacterWidth', 'printFormsData',
    'embedTrueTypeFonts', 'embedSystemFonts', 'saveSubsetFonts', 'saveFormsData',
  ];
  let insertAt = -1;
  for (const name of before) {
    const re = new RegExp(`<w:${name}\\b[^>]*?(/>|>[\\s\\S]*?</w:${name}>)`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml))) insertAt = Math.max(insertAt, m.index + m[0].length);
  }
  if (insertAt < 0) insertAt = (xml.match(/<w:settings[^>]*>/)?.index ?? 0) + (xml.match(/<w:settings[^>]*>/)?.[0].length ?? 0);
  const updated = xml.slice(0, insertAt) + '<w:mirrorMargins/>' + xml.slice(insertAt);
  files[path] = strToU8(updated);
  return zipSync(files);
}
