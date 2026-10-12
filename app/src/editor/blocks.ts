import type { Node as PmNode } from '@tiptap/pm/model';

export interface TextBlock {
  /** Position of the first character of the block's inline content. */
  pos: number;
  text: string;
}

/**
 * Collect textblocks with a 1:1 mapping between string offsets and document positions.
 * Leaf inline nodes (hard breaks) are rendered as a single "\n" so offsets stay aligned.
 */
export function collectTextBlocks(doc: PmNode): TextBlock[] {
  const blocks: TextBlock[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      blocks.push({ pos: pos + 1, text: node.textBetween(0, node.content.size, undefined, '\n') });
      return false;
    }
    return true;
  });
  return blocks;
}
