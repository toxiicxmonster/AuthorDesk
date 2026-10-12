import type { ReferenceEntry, ReferenceType } from './schema';
import { escapeRegExp, levenshtein, normalizeName } from './text';
import { createRecord } from '../storage/repo';

export function matchesReference(r: ReferenceEntry, q: string): boolean {
  const query = q.trim().toLowerCase();
  if (!query) return true;
  if (r.name.toLowerCase().includes(query)) return true;
  if (r.aliases.some((a) => a.toLowerCase().includes(query))) return true;
  if (r.tags.some((t) => t.toLowerCase().includes(query))) return true;
  return false;
}

/** Full-text match across all reference fields (for global search). */
export function referenceText(r: ReferenceEntry): string {
  return [r.name, ...r.aliases, r.summary, ...Object.values(r.fields), r.notes, ...r.tags].join('\n');
}

export function createReference(projectId: string, type: ReferenceType, name: string, extra: Partial<ReferenceEntry> = {}) {
  return createRecord('references', projectId, {
    type,
    name,
    aliases: [],
    summary: '',
    fields: {},
    tags: [],
    favorite: false,
    status: '',
    links: [],
    notes: '',
    image: '',
    ...extra,
  });
}

/** Names that look like duplicates (same normalized name/alias, or 1 edit apart). Advisory only. */
export function likelyDuplicates(entry: Pick<ReferenceEntry, 'id' | 'name' | 'aliases'>, all: ReferenceEntry[]): ReferenceEntry[] {
  const mine = [entry.name, ...entry.aliases].map(normalizeName).filter(Boolean);
  return all.filter((o) => {
    if (o.id === entry.id || o.archivedAt) return false;
    const theirs = [o.name, ...o.aliases].map(normalizeName).filter(Boolean);
    return mine.some((a) => theirs.some((b) => a === b || (a.length >= 5 && levenshtein(a, b) === 1)));
  });
}

/** All names an entry may appear under in prose. */
export function referenceNames(r: ReferenceEntry): string[] {
  const names = [r.name, ...r.aliases].map((s) => s.trim()).filter((s) => s.length >= 2);
  // Characters are usually called by first name in prose ("Elara" for "Elara Voss").
  if (r.type === 'character') {
    const first = r.name.trim().split(/\s+/);
    if (first.length > 1 && first[0].length >= 3 && /^\p{Lu}/u.test(first[0])) names.push(first[0]);
  }
  return [...new Set(names)];
}

/** Build a regex matching any of the entry's names as whole words (case-sensitive for proper nouns). */
export function mentionRegex(r: ReferenceEntry): RegExp | null {
  const names = referenceNames(r);
  if (!names.length) return null;
  const alt = names
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|');
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alt})(?![\\p{L}\\p{N}])`, 'gu');
}

export function countMentions(text: string, r: ReferenceEntry): number {
  const re = mentionRegex(r);
  if (!re) return 0;
  return text.match(re)?.length ?? 0;
}

/** References whose names appear in the text but are not yet linked. Suggestions only; never rewrites text. */
export function detectMentions(text: string, refs: ReferenceEntry[], linkedIds: string[]): { ref: ReferenceEntry; count: number }[] {
  const linked = new Set(linkedIds);
  const out: { ref: ReferenceEntry; count: number }[] = [];
  for (const r of refs) {
    if (r.archivedAt || linked.has(r.id)) continue;
    const count = countMentions(text, r);
    if (count) out.push({ ref: r, count });
  }
  return out.sort((a, b) => b.count - a.count);
}
