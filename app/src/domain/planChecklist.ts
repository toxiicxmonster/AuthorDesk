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

/** The notes with one plan line ticked or unticked. */
export function setPlanItem(notes: string, line: number, done: boolean): string {
  const lines = notes.split('\n');
  const m = ITEM.exec(lines[line] ?? '');
  if (!m) return notes;
  lines[line] = done ? `${m[1]}[x] ${m[3]}` : `${m[1]}${m[3]}`;
  return lines.join('\n');
}

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
 * Whether the scene's text seems to cover a plan point: most of the point's distinctive words appear in it. Names
 * only count when the scene uses them (a first-person scene never names its narrator). Only a hint shown beside the
 * box; the author decides what's done.
 */
export function looksWritten(point: string, sceneText: string): boolean {
  const have = new Set((sceneText.match(WORDS) ?? []).map(stem));
  const want = new Set<string>();
  (point.match(WORDS) ?? []).forEach((w, i) => {
    if (STOP.has(w.toLowerCase())) return;
    const name = i > 0 && w[0] !== w[0].toLowerCase();
    if (name && !have.has(stem(w))) return;
    want.add(stem(w));
  });
  if (want.size < 2) return false;
  const found = [...want].filter((w) => have.has(w)).length;
  return found >= 2 && found / want.size >= 0.66;
}
