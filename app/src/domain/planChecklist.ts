/**
 * A scene's plan as a checklist: the bullet lines in its notes ("- Finn helps her clean up") can be ticked off while
 * drafting. A ticked line is stored as "- [x] …" so the notes stay readable plain text; unticking takes the mark away
 * again. Pure.
 */

export interface PlanItem {
  /** Line number in the notes. */
  line: number;
  text: string;
  done: boolean;
}

const ITEM = /^(\s*[-*•–]\s+)(\[[ xX]\]\s*)?(\S.*)$/;

export function planItems(notes: string): PlanItem[] {
  const out: PlanItem[] = [];
  notes.split('\n').forEach((l, line) => {
    const m = ITEM.exec(l);
    if (m) out.push({ line, text: m[3].trim(), done: /x/i.test(m[2] ?? '') });
  });
  return out;
}

export type PlanLine = { kind: 'text'; text: string } | { kind: 'point'; text: string; done: boolean };

/** Every non-empty line of a summary or notes: plan points (ticked or not) and ordinary text. */
export function planLines(text: string): PlanLine[] {
  return text
    .split('\n')
    .filter((l) => l.trim())
    .map((l): PlanLine => {
      const m = ITEM.exec(l);
      return m ? { kind: 'point', text: m[3].trim(), done: /x/i.test(m[2] ?? '') } : { kind: 'text', text: l.trim() };
    });
}

/** The notes with one plan line ticked or unticked. */
export function setPlanItem(notes: string, line: number, done: boolean): string {
  const lines = notes.split('\n');
  const m = ITEM.exec(lines[line] ?? '');
  if (!m) return notes;
  lines[line] = done ? `${m[1]}[x] ${m[3]}` : `${m[1]}${m[3]}`;
  return lines.join('\n');
}

// " - Finn catches a glimpse": a dash between spaces before a capital starts another point typed on the same line.
const INLINE = /\s+[-–•]\s+(?=\p{Lu})/u;

/** The points of a plan line typed as one ("Winnie wears his number - Finn sees her - He's surprised"). */
export function inlinePoints(text: string): string[] {
  const parts = text.split(INLINE).map((p) => p.trim()).filter(Boolean);
  return parts.length >= 2 ? parts : [text];
}

/** The notes with one plan line split into a line per point, each unticked. */
export function splitPlanItem(notes: string, line: number): string {
  const lines = notes.split('\n');
  const m = ITEM.exec(lines[line] ?? '');
  if (!m) return notes;
  const parts = inlinePoints(m[3]);
  if (parts.length < 2) return notes;
  lines.splice(line, 1, ...parts.map((p) => `${m[1]}${p}`));
  return lines.join('\n');
}

/** The text without its tick marks ("- [x] Funeral happens" → "- Funeral happens"), for the AI and exports. */
export const withoutTicks = (text: string) => text.replace(/^(\s*[-*•–]\s+)\[[ xX]\]\s*/gm, '$1');

const STOP = new Set(
  'about after again also back been before being both came come could does doing down even every from going gets have having here into just know like made make more most much only other over really said says some still such than that them then there these they thing things this those through very want were what when where which while will with would your kinda sorta gonna since because finally starts start begins tries'.split(
    ' ',
  ),
);
// "hauls", "hauled", "hauling" → "haul"; "drops", "dropped" → "drop"; "takes", "take" → "tak". Long words compare
// by their first six letters.
function stem(word: string): string {
  let w = word.toLowerCase().replace(/[’']s$/, '');
  const bare = w.replace(/(?:ing|ed|es|e|s)$/, '');
  if (bare.length >= 3) w = bare;
  if (w.length > 3 && w.at(-1) === w.at(-2) && /[b-df-hj-np-tv-z]/.test(w.at(-1)!)) w = w.slice(0, -1);
  return w.slice(0, 6);
}
const WORDS = /[\p{L}][\p{L}’']{3,}/gu;

/**
 * Whether the scene's text seems to cover a plan point: most of the point's distinctive words appear in it.
 * `narrator` is the point-of-view character's name: it doesn't count when the text never uses it (a first-person
 * scene doesn't name its narrator). Only a hint shown beside the box; the author decides what's done.
 */
export function looksWritten(point: string, sceneText: string, narrator: readonly string[] = []): boolean {
  // Plan lines still in the text are the plan itself, not the story written from it.
  const story = sceneText
    .split('\n')
    .filter((l) => !ITEM.test(l))
    .join('\n');
  const have = new Set((story.match(WORDS) ?? []).map(stem));
  const own = new Set(narrator.flatMap((n) => n.match(WORDS) ?? []).map(stem));
  const want = new Set<string>();
  for (const w of point.match(WORDS) ?? []) {
    if (STOP.has(w.toLowerCase())) continue;
    const st = stem(w);
    if (own.has(st) && !have.has(st)) continue;
    want.add(st);
  }
  if (want.size < 2) return false;
  const found = [...want].filter((w) => have.has(w)).length;
  return found >= 2 && found / want.size >= 0.66;
}
