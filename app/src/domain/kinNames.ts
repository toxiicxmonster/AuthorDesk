import type { ReferenceEntry } from './schema';
import { kinOf } from './familyTree';

/**
 * What a character is called by family: in scenes told by Winnie, her grandmother Betty is "Grandma" or "Grammy",
 * never "Betty". Those names, found in the text, can become the entry's nicknames so look-ups, mentions and the
 * continuity checks find her. Read from the relationships on the entries. Pure.
 */

const FEMALE = /\b(?:mother|mom|mum|mama|grandmother|grandma|nana|granny|gran|grams)\b/i;
const MALE = /\b(?:father|dad|papa|grandfather|grandpa|gramps|granddad|grandad)\b/i;

const NAMES = {
  grandparent: {
    female: ['Grandma', 'Grammy', 'Granny', 'Nana', 'Gran', 'Gram', 'Grams', 'Grandmother', 'Mamaw', 'Meemaw', 'Nan'],
    male: ['Grandpa', 'Grampa', 'Gramps', 'Granddad', 'Grandad', 'Grandfather', 'Papaw', 'Pop-pop', 'Pops'],
  },
  parent: {
    female: ['Mom', 'Mum', 'Mama', 'Mommy', 'Mummy', 'Mother', 'Ma'],
    male: ['Dad', 'Daddy', 'Papa', 'Father', 'Pa'],
  },
} as const;

type Elder = keyof typeof NAMES;

type Ref = Pick<ReferenceEntry, 'id' | 'name' | 'aliases' | 'links' | 'archivedAt' | 'type'>;

// A link's label says what the linked person is to the entry ("Winnie → Betty Hartley — grandmother").

/** Whether the relative's label for this entry says mother/grandmother or father/grandfather. */
function sexOf(entry: Ref, relativeId: string, refs: readonly Ref[]): 'female' | 'male' | null {
  const label = refs.find((r) => r.id === relativeId)?.links.find((l) => l.targetId === entry.id)?.label ?? '';
  return FEMALE.test(label) ? 'female' : MALE.test(label) ? 'male' : null;
}

/** The relatives this character is a parent or grandparent of. */
function youngerRelatives(entry: Ref, refs: readonly Ref[]): { id: string; kin: Elder }[] {
  const out: { id: string; kin: Elder }[] = [];
  // On the entry: "Winnie — granddaughter" makes this entry her grandparent.
  for (const l of entry.links) {
    const k = kinOf(l.label);
    if (k === 'grandchild') out.push({ id: l.targetId, kin: 'grandparent' });
    if (k === 'child') out.push({ id: l.targetId, kin: 'parent' });
  }
  // On the relative's entry: "Betty — grandmother".
  for (const r of refs) {
    if (r.id === entry.id || r.archivedAt) continue;
    for (const l of r.links) {
      if (l.targetId !== entry.id) continue;
      const k = kinOf(l.label);
      if (k === 'grandparent' || k === 'parent') out.push({ id: r.id, kin: k });
    }
  }
  return out.filter((x, i) => out.findIndex((y) => y.id === x.id && y.kin === x.kin) === i);
}

export interface KinName {
  name: string;
  count: number;
  /** Whose scenes use it. */
  relativeId: string;
}

/**
 * Family names for `entry` found in the scenes told by the relative it's a parent or grandparent of. `scenes` are the
 * book's scenes with their point-of-view character. A name already on the entry, or one that could mean someone else
 * (the relative has two grandmothers), is left out.
 */
export function kinNames(entry: Ref, refs: readonly Ref[], scenes: readonly { povId: string | null; text: string }[]): KinName[] {
  const have = new Set([entry.name, ...entry.aliases].map((n) => n.trim().toLowerCase()));
  const found = new Map<string, KinName>();
  for (const rel of youngerRelatives(entry, refs)) {
    const sex = sexOf(entry, rel.id, refs);
    // Another entry in the same role for this relative ("Grandma" could be either grandmother) leaves it unclear,
    // unless the two are told apart by sex.
    const rivals = refs.filter((r) => r.id !== entry.id && !r.archivedAt && youngerRelatives(r, refs).some((x) => x.id === rel.id && x.kin === rel.kin));
    if (rivals.some((r) => !sex || sexOf(r, rel.id, refs) !== (sex === 'female' ? 'male' : 'female'))) continue;
    const text = scenes
      .filter((s) => s.povId === rel.id)
      .map((s) => s.text)
      .join('\n');
    if (!text) continue;
    for (const n of sex ? NAMES[rel.kin][sex] : [...NAMES[rel.kin].female, ...NAMES[rel.kin].male]) {
      if (have.has(n.toLowerCase())) continue;
      // Capitalised, so used as a name ("Hey, Grandma"), not "my grandma".
      const count = (text.match(new RegExp(`(?<![\\p{L}'’-])${n}(?![\\p{L}'’-])`, 'gu')) ?? []).length;
      if (count) found.set(n, { name: n, count: (found.get(n)?.count ?? 0) + count, relativeId: rel.id });
    }
  }
  return [...found.values()].sort((a, b) => b.count - a.count);
}
