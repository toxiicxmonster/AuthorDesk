import { createContext, useContext } from 'react';
import type { Editor } from '@tiptap/core';

export interface EditorCtx {
  editor: Editor | null;
  /** Bumped whenever proofreading results change so panels re-render. */
  proofVersion: number;
  rerunProofread: () => void;
  proofStatus: string;
}

export const EditorContext = createContext<EditorCtx>({
  editor: null,
  proofVersion: 0,
  rerunProofread: () => {},
  proofStatus: '',
});

export const useEditorCtx = () => useContext(EditorContext);

/** Pending-save flushers registered by mounted editors; called before navigation, export and unload. */
const flushers = new Set<() => Promise<void>>();

export function registerFlusher(fn: () => Promise<void>) {
  flushers.add(fn);
  return () => {
    flushers.delete(fn);
  };
}

export async function flushAllEdits() {
  await Promise.all([...flushers].map((f) => f()));
}
