import { Mark, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    refLink: {
      setRefLink: (refId: string) => ReturnType;
      unsetRefLink: () => ReturnType;
    };
  }
}

/** Links a span of prose to a reference entry (character, location…) by stable id. */
export const RefLink = Mark.create({
  name: 'refLink',
  inclusive: false,
  addAttributes() {
    return {
      refId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-ref-id'),
        renderHTML: (attrs) => ({ 'data-ref-id': attrs.refId }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-ref-id]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'ref-link' }), 0];
  },
  addCommands() {
    return {
      setRefLink:
        (refId) =>
        ({ commands }) =>
          commands.setMark(this.name, { refId }),
      unsetRefLink:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});
