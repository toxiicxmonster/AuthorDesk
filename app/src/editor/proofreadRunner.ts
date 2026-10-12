import type { Editor } from '@tiptap/core';
import { db } from '../storage/db';
import { getSettings } from '../storage/settings';
import { checkBlocks } from '../proofreading/providers';
import type { ProofreadContext } from '../proofreading/types';
import { hashText } from '../domain/text';
import { collectTextBlocks } from './blocks';
import { setSuggestionsMeta, proofreadKey, type PlacedSuggestion } from './proofreadExtension';

export async function buildProofreadContext(projectId: string): Promise<ProofreadContext> {
  const [settings, dict, refs] = await Promise.all([
    getSettings(),
    db.dictionary.where('projectId').equals(projectId).toArray(),
    db.references.where('projectId').equals(projectId).toArray(),
  ]);
  const knownNames: string[] = [];
  for (const r of refs) {
    if (r.archivedAt) continue;
    knownNames.push(r.name, ...r.aliases);
  }
  return {
    dialect: settings.dialect,
    disabledRules: new Set(settings.disabledRules),
    disabledCategories: new Set(settings.disabledCategories),
    dictionary: new Set(dict.map((d) => d.word.toLowerCase())),
    knownNames,
  };
}

/** Key identifying one flagged occurrence, stable across edits elsewhere in the scene. */
export function ignoreKey(ruleId: string, original: string, context: string): string {
  return `${ruleId}|${original}|${hashText(context)}`;
}

export interface ProofreadOutcome {
  count: number;
  spellingError: string | null;
  stale: boolean;
}

/** Check the whole scene and place suggestions in the editor. Never modifies the text. */
export async function runProofread(editor: Editor, projectId: string): Promise<ProofreadOutcome> {
  const docAtStart = editor.state.doc;
  const blocks = collectTextBlocks(docAtStart);
  const ctx = await buildProofreadContext(projectId);
  const ignored = new Set((await db.ignored.where('projectId').equals(projectId).toArray()).map((i) => i.key));
  const { results, spellingError } = await checkBlocks(
    blocks.map((b) => b.text),
    ctx,
  );
  if (editor.isDestroyed) return { count: 0, spellingError, stale: true };
  // The author kept typing while we checked: these offsets belong to an old version. Discard them.
  if (editor.state.doc !== docAtStart) return { count: 0, spellingError, stale: true };
  const placed: PlacedSuggestion[] = [];
  results.forEach((list, bi) => {
    const b = blocks[bi];
    for (const s of list) {
      const context = b.text.slice(Math.max(0, s.start - 20), s.end + 20);
      const key = ignoreKey(s.ruleId, s.original, context);
      if (ignored.has(key)) continue;
      placed.push({ ...s, key: `${key}@${b.pos + s.start}`, from: b.pos + s.start, to: b.pos + s.end });
    }
  });
  editor.view.dispatch(editor.state.tr.setMeta(proofreadKey, setSuggestionsMeta(placed)).setMeta('addToHistory', false));
  return { count: placed.length, spellingError, stale: false };
}

export function clearProofread(editor: Editor) {
  if (editor.isDestroyed) return;
  editor.view.dispatch(editor.state.tr.setMeta(proofreadKey, setSuggestionsMeta([])).setMeta('addToHistory', false));
}

/** The ignore key without the position suffix. */
export function baseKey(placedKey: string): string {
  return placedKey.replace(/@\d+$/, '');
}
