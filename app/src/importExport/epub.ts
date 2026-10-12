/**
 * EPUB 3 eBook (reflowable), the format Amazon KDP recommends for Kindle eBooks. Also includes an EPUB 2
 * toc.ncx for older readers. Built entirely on-device.
 */
import { strToU8, zipSync, type Zippable } from 'fflate';
import type { PmNode } from '../domain/text';
import { tocEntry, type PublishModel } from './publish';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inlineXhtml(nodes: PmNode[] | undefined): string {
  return (nodes ?? [])
    .map((n) => {
      if (n.type === 'hardBreak') return '<br/>';
      if (n.type !== 'text') return inlineXhtml(n.content);
      let t = esc(n.text ?? '');
      for (const m of n.marks ?? []) {
        if (m.type === 'italic') t = `<em>${t}</em>`;
        else if (m.type === 'bold') t = `<strong>${t}</strong>`;
        else if (m.type === 'underline') t = `<span class="u">${t}</span>`;
        else if (m.type === 'strike') t = `<s>${t}</s>`;
      }
      return t;
    })
    .join('');
}

/** Convert manuscript blocks to XHTML. The first paragraph after a heading or scene break isn't indented. */
export function blocksToXhtml(blocks: PmNode[]): string {
  let first = true;
  const out: string[] = [];
  const block = (b: PmNode): string => {
    switch (b.type) {
      case 'paragraph': {
        const html = inlineXhtml(b.content);
        if (!html.trim()) return '';
        const cls = first ? ' class="first"' : '';
        first = false;
        return `<p${cls}>${html}</p>`;
      }
      case 'heading':
        first = true;
        return `<h3>${inlineXhtml(b.content)}</h3>`;
      case 'horizontalRule':
        first = true;
        return '<p class="scene-break">* * *</p>';
      case 'blockquote': {
        const inner = (b.content ?? []).map(block).join('\n');
        first = true;
        return `<blockquote>${inner}</blockquote>`;
      }
      case 'bulletList':
      case 'orderedList': {
        const tag = b.type === 'bulletList' ? 'ul' : 'ol';
        return `<${tag}>${(b.content ?? []).map((li) => `<li>${(li.content ?? []).map((p) => inlineXhtml(p.content)).join('<br/>')}</li>`).join('')}</${tag}>`;
      }
      default:
        return (b.content ?? []).map(block).join('\n');
    }
  };
  for (const b of blocks) {
    const h = block(b);
    if (h) out.push(h);
  }
  return out.join('\n');
}

const CSS = `body { font-family: serif; line-height: 1.4; margin: 0; }
p { margin: 0; text-indent: 1.5em; text-align: justify; }
p.first, p.scene-break + p, h1 + p, h3 + p { text-indent: 0; }
p.scene-break { text-indent: 0; text-align: center; margin: 1em 0; }
h1 { font-size: 1.5em; text-align: center; margin: 3em 0 1.5em; font-weight: normal; page-break-before: always; }
.chapter-label { display: block; font-size: 0.7em; letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 0.6em; }
h3 { font-size: 1em; font-style: italic; text-align: center; font-weight: normal; margin: 1.5em 0 1em; }
blockquote { margin: 1em 1.5em; }
blockquote p { text-indent: 0; }
.u { text-decoration: underline; }
.titlepage { text-align: center; margin-top: 30%; }
.titlepage h1 { font-size: 2em; margin: 0 0 0.3em; page-break-before: avoid; }
.titlepage .subtitle { font-size: 1.2em; font-style: italic; margin-bottom: 2em; }
.titlepage .author { font-size: 1.2em; }
.copyright { font-size: 0.8em; margin-top: 40%; }
.copyright p, .dedication p, .about p { text-indent: 0; margin-bottom: 0.8em; }
.dedication { text-align: center; font-style: italic; margin-top: 30%; }
nav ol { list-style: none; padding: 0; margin: 0 1.5em; }
nav li { margin: 0.4em 0; }
`;

const page = (title: string, body: string, lang: string, extraNs = '') =>
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"${extraNs} xml:lang="${esc(lang)}" lang="${esc(lang)}">
<head>
<meta charset="UTF-8"/>
<title>${esc(title)}</title>
<link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
${body}
</body>
</html>
`;

const paras = (text: string) =>
  text
    .split(/\n{2,}|\r\n\r\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br/>')}</p>`)
    .join('\n');

export interface EpubCover {
  bytes: Uint8Array;
  mediaType: 'image/jpeg' | 'image/png';
}

/** Build the .epub file. `bookId` gives a stable identifier when there's no ISBN. */
export function buildEpub(model: PublishModel, bookId: string, cover?: EpubCover, now = new Date()): Uint8Array {
  const { info, options } = model;
  const lang = info.language || 'en';
  const files: Record<string, string | Uint8Array> = {};
  type Item = { id: string; href: string; type: string; props?: string; linear?: boolean; label?: string };
  const items: Item[] = [];
  const add = (id: string, href: string, html: string, label?: string, linear = true) => {
    files[`OEBPS/${href}`] = html;
    items.push({ id, href, type: 'application/xhtml+xml', label, linear });
  };

  if (cover) {
    const ext = cover.mediaType === 'image/png' ? 'png' : 'jpg';
    files[`OEBPS/cover.${ext}`] = cover.bytes;
    add('cover', 'cover.xhtml', page('Cover', `<div style="text-align:center"><img src="cover.${ext}" alt="${esc(model.title)}" style="max-width:100%;max-height:100%"/></div>`, lang));
  }
  if (options.includeTitlePage) {
    add(
      'titlepage',
      'title.xhtml',
      page(model.title, `<div class="titlepage"><h1>${esc(model.title)}</h1>${model.subtitle ? `<p class="subtitle">${esc(model.subtitle)}</p>` : ''}${info.author ? `<p class="author">${esc(info.author)}</p>` : ''}</div>`, lang),
      'Title Page',
    );
  }
  if (options.includeCopyright) {
    const lines = [
      `Copyright © ${esc(info.copyrightYear)} ${esc(info.author || '')}`.trim(),
      'All rights reserved. No part of this book may be reproduced in any form without written permission from the author, except for brief quotations in a review.',
      'This is a work of fiction. Names, characters, places and incidents are products of the author’s imagination or are used fictitiously.',
      info.isbn ? `ISBN: ${esc(info.isbn)}` : '',
      info.publisher ? `Published by ${esc(info.publisher)}` : '',
    ].filter(Boolean);
    add('copyright', 'copyright.xhtml', page('Copyright', `<div class="copyright">${lines.map((l) => `<p>${l}</p>`).join('\n')}</div>`, lang), 'Copyright');
  }
  if (options.includeDedication && info.dedication.trim()) {
    add('dedication', 'dedication.xhtml', page('Dedication', `<div class="dedication">${paras(info.dedication)}</div>`, lang), 'Dedication');
  }
  const tocIndex = items.length;
  const chapterIds: string[] = [];
  model.chapters.forEach((c, i) => {
    const id = `chapter-${i + 1}`;
    chapterIds.push(id);
    const heading = `<h1 id="${id}">${c.label ? `<span class="chapter-label">${esc(c.label)}</span>` : ''}${esc(c.title)}</h1>`;
    add(id, `${id}.xhtml`, page(tocEntry(c), `<section epub:type="chapter">\n${heading}\n${blocksToXhtml(c.blocks)}\n</section>`, lang), tocEntry(c));
  });
  if (options.includeAboutAuthor && info.aboutAuthor.trim()) {
    add('about', 'about.xhtml', page('About the Author', `<section class="about" epub:type="appendix"><h1>About the Author</h1>${paras(info.aboutAuthor)}</section>`, lang), 'About the Author');
  }

  // Navigation (EPUB 3) — also a visible "Contents" page placed before the first chapter.
  const tocEntries = items.filter((it) => it.label && it.id !== 'titlepage' && it.id !== 'copyright' && it.id !== 'dedication');
  const navHtml = page(
    'Contents',
    `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${tocEntries.map((it) => `<li><a href="${it.href}">${esc(it.label!)}</a></li>`).join('')}</ol></nav>
<nav epub:type="landmarks" hidden=""><ol>
${options.includeToc ? '<li><a epub:type="toc" href="nav.xhtml">Contents</a></li>' : ''}
${chapterIds.length ? `<li><a epub:type="bodymatter" href="${chapterIds[0]}.xhtml">Start of book</a></li>` : ''}
</ol></nav>`,
    lang,
  );
  files['OEBPS/nav.xhtml'] = navHtml;
  // The navigation document is always in the package (Kindle's "Go To" menu needs it); it only appears as a
  // readable Contents page when the author asks for one.
  items.splice(tocIndex, 0, { id: 'nav', href: 'nav.xhtml', type: 'application/xhtml+xml', props: 'nav', linear: options.includeToc ? true : false });

  const identifier = info.isbn.replace(/[^0-9X]/gi, '') ? `urn:isbn:${info.isbn.replace(/[^0-9X]/gi, '')}` : `urn:uuid:${bookId}`;
  const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="${esc(identifier)}"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head>
<docTitle><text>${esc(model.title)}</text></docTitle>
<navMap>
${tocEntries.map((it, i) => `<navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${esc(it.label!)}</text></navLabel><content src="${it.href}"/></navPoint>`).join('\n')}
</navMap>
</ncx>
`;
  files['OEBPS/toc.ncx'] = ncx;
  files['OEBPS/style.css'] = CSS;

  const modified = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const coverItem = cover ? `<item id="cover-image" href="cover.${cover.mediaType === 'image/png' ? 'png' : 'jpg'}" media-type="${cover.mediaType}" properties="cover-image"/>` : '';
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${esc(lang)}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${esc(identifier)}</dc:identifier>
<dc:title>${esc(model.title)}</dc:title>
${info.author ? `<dc:creator id="author">${esc(info.author)}</dc:creator>\n<meta refines="#author" property="role" scheme="marc:relators">aut</meta>` : ''}
<dc:language>${esc(lang)}</dc:language>
${info.publisher ? `<dc:publisher>${esc(info.publisher)}</dc:publisher>` : ''}
${info.description ? `<dc:description>${esc(info.description)}</dc:description>` : ''}
<dc:rights>Copyright © ${esc(info.copyrightYear)} ${esc(info.author)}</dc:rights>
<meta property="dcterms:modified">${modified}</meta>
${cover ? '<meta name="cover" content="cover-image"/>' : ''}
</metadata>
<manifest>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="css" href="style.css" media-type="text/css"/>
${coverItem}
${items.map((it) => `<item id="${it.id}" href="${it.href}" media-type="${it.type}"${it.props ? ` properties="${it.props}"` : ''}/>`).join('\n')}
</manifest>
<spine toc="ncx">
${items.filter((it) => it.linear !== false).map((it) => `<itemref idref="${it.id}"/>`).join('\n')}
</spine>
</package>
`;
  files['OEBPS/content.opf'] = opf;
  files['META-INF/container.xml'] = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`;

  // The mimetype entry must be first and stored uncompressed.
  const zip: Zippable = { mimetype: [strToU8('application/epub+zip'), { level: 0 }] };
  for (const [path, data] of Object.entries(files)) zip[path] = typeof data === 'string' ? strToU8(data) : data;
  return zipSync(zip, { level: 9 });
}
