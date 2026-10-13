import { REFERENCE_TEMPLATES } from '../domain/referenceTemplates';
import type { ReferenceEntry } from '../domain/schema';
import type { CharacterContext } from './prompts';

export const CHARACTER_FIELD_LABELS: Record<string, string> = Object.fromEntries(REFERENCE_TEMPLATES.character.map((f) => [f.key, f.label]));

/** Listed characters named in the text (full name, any part of it, or an alias). */
export function charactersIn(text: string, refs: readonly ReferenceEntry[]): ReferenceEntry[] {
  return refs.filter((r) =>
    [r.name, ...r.aliases]
      .flatMap((n) => [n, ...n.split(/\s+/).filter((p) => p.length >= 3)])
      .some((n) => new RegExp(`(?<![\\p{L}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'u').test(text)),
  );
}

/** A character's reference entry as read-only notes for the model. */
export function toCharacterContext(r: ReferenceEntry): CharacterContext {
  const notes: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.fields)) if (v?.trim()) notes[CHARACTER_FIELD_LABELS[k] ?? k] = v;
  if (r.summary?.trim()) notes.Summary = r.summary;
  return { name: r.name, aliases: r.aliases, notes };
}
