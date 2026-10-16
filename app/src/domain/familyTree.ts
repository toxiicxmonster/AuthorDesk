import type { ReferenceEntry } from './schema';

/**
 * Family trees from the relationships written on character entries. A link's label says what the linked person is
 * to the entry, as the entry page shows it ("Winnie → Betty Hartley — grandmother": Betty is Winnie's grandmother).
 * Labels are read for family words; anything else (rival, mentor) is not family. Pure.
 */

export type Kin = 'parent' | 'child' | 'grandparent' | 'grandchild' | 'sibling' | 'spouse' | 'auntuncle' | 'niblings' | 'cousin';

// Generation of the other person minus this one's: "A is B's mother" → B is a generation below A.
const OFFSET: Record<Kin, number> = { parent: 1, child: -1, grandparent: 2, grandchild: -2, sibling: 0, spouse: 0, auntuncle: 1, niblings: -1, cousin: 0 };

const WORDS: [RegExp, Kin][] = [
  [/\b(?:grand(?:mother|father|parent|ma|pa|mom|dad)|nana|granny|gran|grams|gramps|grandpa|grandma)\b/i, 'grandparent'],
  [/\bgrand(?:son|daughter|child|kid)\b/i, 'grandchild'],
  [/\b(?:mother|father|parent|mom|mum|dad|mama|papa|stepmother|stepfather|stepmom|stepdad)\b/i, 'parent'],
  [/\b(?:son|daughter|child|kid|stepson|stepdaughter)\b/i, 'child'],
  [/\b(?:sister|brother|sibling|twin|half-sister|half-brother|stepsister|stepbrother)\b/i, 'sibling'],
  [/\b(?:wife|husband|spouse|married|ex-wife|ex-husband)\b/i, 'spouse'],
  [/\b(?:aunt|auntie|uncle)\b/i, 'auntuncle'],
  [/\b(?:niece|nephew)\b/i, 'niblings'],
  [/\bcousin\b/i, 'cousin'],
];

/** The family relationship a label names, if any ("her grandmother" → grandparent; "rival" → null). */
export function kinOf(label: string): Kin | null {
  // "mother of" / "Winnie's mother" read the same way: what this entry is to the other.
  for (const [re, kin] of WORDS) if (re.test(label)) return kin;
  return null;
}

export interface FamilyEdge {
  from: string;
  to: string;
  kin: Kin;
}

export interface FamilyLayout {
  /** Generation rows, oldest first; each row's people in display order. */
  rows: string[][];
  generation: Map<string, number>;
  edges: FamilyEdge[];
}

/** Lays out everyone connected by family words: a generation per row, spouses and siblings side by side. */
export function familyTree(refs: readonly Pick<ReferenceEntry, 'id' | 'name' | 'links' | 'archivedAt'>[]): FamilyLayout {
  const live = refs.filter((r) => !r.archivedAt);
  const ids = new Set(live.map((r) => r.id));
  const edges: FamilyEdge[] = [];
  const seen = new Set<string>();
  for (const r of live) {
    for (const l of r.links) {
      if (!ids.has(l.targetId) || l.targetId === r.id) continue;
      const kin = kinOf(l.label);
      if (!kin) continue;
      const key = [r.id, l.targetId].sort().join('|');
      if (seen.has(key)) continue; // one relationship per pair (the first written wins)
      seen.add(key);
      // The label describes the linked person: they are this entry's `kin`.
      edges.push({ from: l.targetId, to: r.id, kin });
    }
  }
  // Generations: walk the family graph, each edge fixing the other person's generation relative to this one.
  const adj = new Map<string, { other: string; d: number }[]>();
  for (const e of edges) {
    adj.set(e.from, [...(adj.get(e.from) ?? []), { other: e.to, d: OFFSET[e.kin] }]);
    adj.set(e.to, [...(adj.get(e.to) ?? []), { other: e.from, d: -OFFSET[e.kin] }]);
  }
  const generation = new Map<string, number>();
  const order: string[] = [];
  const byName = (a: string, b: string) => (live.find((r) => r.id === a)!.name || '').localeCompare(live.find((r) => r.id === b)!.name || '');
  for (const start of [...adj.keys()].sort(byName)) {
    if (generation.has(start)) continue;
    const component: string[] = [];
    generation.set(start, 0);
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift()!;
      component.push(cur);
      for (const { other, d } of adj.get(cur) ?? []) {
        if (generation.has(other)) continue;
        generation.set(other, generation.get(cur)! + d);
        queue.push(other);
      }
    }
    const min = Math.min(...component.map((c) => generation.get(c)!));
    for (const c of component) generation.set(c, generation.get(c)! - min);
    order.push(...component);
  }
  const rows: string[][] = [];
  for (const id of order) {
    const g = generation.get(id)!;
    (rows[g] ??= []).push(id);
  }
  // Keep each person next to their spouse and siblings where possible.
  const partner = new Map<string, string>();
  for (const e of edges) if (e.kin === 'spouse' || e.kin === 'sibling') if (!partner.has(e.from)) partner.set(e.from, e.to);
  for (const row of rows) {
    if (!row) continue;
    for (const [a, b] of partner) {
      const i = row.indexOf(a);
      const j = row.indexOf(b);
      if (i < 0 || j < 0 || Math.abs(i - j) === 1) continue;
      row.splice(j, 1);
      row.splice(row.indexOf(a) + 1, 0, b);
    }
  }
  // Array.from visits holes (a generation with nobody in it, between grandparent and grandchild); map would skip them.
  return { rows: Array.from(rows, (r) => r ?? []), generation, edges };
}
