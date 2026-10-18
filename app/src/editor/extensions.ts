import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { RefLink } from './refLink';
import { Proofread } from './proofreadExtension';
import { Find } from './findExtension';
import { Comment, Highlight } from './annotations';

export function editorExtensions(placeholder = 'Begin writing…') {
  return [
    StarterKit.configure({
      heading: { levels: [2, 3] },
      code: false,
      codeBlock: false,
      link: { openOnClick: false, autolink: false },
    }),
    Placeholder.configure({ placeholder }),
    RefLink,
    Proofread,
    Find,
    Highlight,
    Comment,
  ];
}

/**
 * Clean HTML pasted from word processors and web pages: drop styles, classes, fonts,
 * Office-specific markup and comments while keeping paragraphs, emphasis, headings and quotes.
 */
export function cleanPastedHtml(html: string): string {
  // Google Docs wraps everything in <b id="docs-internal-guid…" style="font-weight:normal">.
  let out = html.replace(/<b[^>]*docs-internal-guid[^>]*>([\s\S]*?)<\/b>/gi, '$1');
  out = out
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?(o|w|m|v):[^>]*>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\s(style|class|lang|face|color|size|align|id|dir)="[^"]*"/gi, '')
    .replace(/\s(style|class|lang|face|color|size|align|id|dir)='[^']*'/gi, '')
    .replace(/<\/?font[^>]*>/gi, '')
    .replace(/&nbsp;/g, ' ');
  return out;
}
