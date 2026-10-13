/**
 * Dialogue assistant: finds the quoted lines in a scene, works out who says each one (speech tag, "Tom said, “…”",
 * or an action beat like "Tom shrugged. “Fine.”"), and points out what tends to trip readers up. Pure.
 */

export interface DialogueLine {
  block: number;
  /** Offsets of the quotation, quote marks included. */
  start: number;
  end: number;
  text: string;
  /** Listed full name, a capitalized name, a pronoun ("she"), or null when nothing says who speaks. */
  speaker: string | null;
  /** The speech verb, lower-cased ("said", "whispered"), or null for an action beat / no tag. */
  tag: string | null;
}

export type DialogueIssueKind = 'unattributed-run' | 'two-speakers' | 'unclosed';

export interface DialogueIssue {
  kind: DialogueIssueKind;
  block: number;
  start: number;
  end: number;
  message: string;
}

export interface DialogueReport {
  lines: DialogueLine[];
  /** [speaker, lines], most first. */
  speakers: [string, number][];
  /** [speech verb, uses], most first. */
  tags: [string, number][];
  issues: DialogueIssue[];
  /** Share of the scene's words spoken in dialogue, 0–1. */
  share: number;
  /** A short craft note about the tags, or null. */
  tagNote: string | null;
}

const SPEECH =
  'said|says|say|asked|asks|replied|replies|answered|answers|whispered|whispers|murmured|murmurs|muttered|mutters|shouted|shouts|yelled|yells|called|calls|' +
  'cried|cries|snapped|snaps|added|adds|continued|continues|explained|explains|admitted|admits|insisted|insists|agreed|agrees|lied|lies|sighed|sighs|' +
  'laughed|laughs|growled|growls|snarled|snarls|hissed|hisses|breathed|breathes|demanded|demands|begged|begs|pleaded|pleads|offered|offers|warned|warns|' +
  'teased|teases|joked|jokes|announced|announces|declared|declares|stammered|stammers|stuttered|stutters|blurted|blurts|mumbled|mumbles|retorted|retorts|' +
  'countered|counters|suggested|suggests|repeated|repeats|corrected|corrects|interrupted|interrupts|screamed|screams|bellowed|bellows|sobbed|sobs|told|tells';
const NAME = String.raw`\p{Lu}[\p{Ll}'’-]+(?:\s\p{Lu}[\p{Ll}'’-]+)?`;
const PRONOUN = '[Hh]e|[Ss]he|[Tt]hey|I|[Ww]e|[Yy]ou|[Ii]t';
const TAG_AFTER = new RegExp(String.raw`^[\s,]*(?:(${NAME}|${PRONOUN})\s+(${SPEECH})\b|(${SPEECH})\s+(${NAME}|${PRONOUN})\b)`, 'u');
const TAG_BEFORE = new RegExp(String.raw`(?:^|[.!?]\s+|\s)(${NAME}|${PRONOUN})\s+(${SPEECH})(?:\s+\p{Ll}+)?[,:]?\s*$`, 'u');
const BEAT = new RegExp(String.raw`(?:^|[.!?]\s+)(${NAME})\s+\p{Ll}+`, 'gu');
const NOT_SPEAKERS = new Set(['The', 'A', 'An', 'Then', 'But', 'And', 'So', 'When', 'After', 'Before', 'Now', 'Still', 'There', 'This', 'That', 'What', 'Why', 'How']);

/** "Winnie" → "Winnie Hartley" when the full name is listed; otherwise the name as written. */
function canonical(name: string, knownNames: readonly string[]): string {
  const lower = name.toLowerCase();
  for (const full of knownNames) {
    if (full.toLowerCase() === lower) return full;
    if (full.split(/\s+/).some((p) => p.toLowerCase() === lower)) return full;
  }
  return name;
}

function speakerFrom(raw: string | undefined, knownNames: readonly string[]): string | null {
  if (!raw) return null;
  if (new RegExp(`^(?:${PRONOUN})$`, 'i').test(raw)) return raw.toLowerCase() === 'i' ? 'I' : raw.toLowerCase();
  const first = raw.split(/\s/)[0];
  if (NOT_SPEAKERS.has(first)) return null;
  return canonical(raw, knownNames);
}

/** Quotations in one paragraph: [start, end) with end = -1 when it runs past the paragraph. */
function quotes(text: string): [number, number][] {
  const out: [number, number][] = [];
  let open = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (open < 0 && (c === '“' || (c === '"' && !/[\p{L}\p{N}]/u.test(text[i - 1] ?? '')))) open = i;
    else if (open >= 0 && (c === '”' || c === '"')) {
      out.push([open, i + 1]);
      open = -1;
    }
  }
  if (open >= 0) out.push([open, -1]);
  return out;
}

const words = (s: string) => (s.match(/[\p{L}\p{N}'’]+/gu) ?? []).length;

export function analyzeDialogue(texts: readonly string[], knownNames: readonly string[] = []): DialogueReport {
  const lines: DialogueLine[] = [];
  const issues: DialogueIssue[] = [];
  let spoken = 0;
  let total = 0;
  let unattributed: DialogueLine[] = [];
  const flushRun = () => {
    if (unattributed.length >= 4) {
      const l = unattributed[3];
      issues.push({
        kind: 'unattributed-run',
        block: l.block,
        start: l.start,
        end: l.end,
        message: `${unattributed.length} lines in a row don’t say who is speaking. Readers can lose track; add a tag (“she said”) or an action beat every few lines.`,
      });
    }
    unattributed = [];
  };

  texts.forEach((text, block) => {
    total += words(text);
    const qs = quotes(text);
    if (!qs.length) {
      flushRun();
      return;
    }
    const inPara: DialogueLine[] = [];
    qs.forEach(([s, e], k) => {
      const end = e < 0 ? text.length : e;
      spoken += words(text.slice(s, end));
      if (e < 0) {
        // Fiction convention: a speech running on into the next paragraph leaves its quote open there.
        const next = texts[block + 1]?.trimStart() ?? '';
        if (!/^["“]/.test(next)) {
          issues.push({ kind: 'unclosed', block, start: s, end: Math.min(text.length, s + 40), message: 'This quotation is never closed. Add the closing quote mark where the speech ends.' });
        }
      }
      const after = e < 0 ? '' : text.slice(e, qs[k + 1]?.[0] ?? text.length);
      const before = text.slice(k ? (qs[k - 1][1] < 0 ? 0 : qs[k - 1][1]) : 0, s);
      let speaker: string | null = null;
      let tag: string | null = null;
      const a = TAG_AFTER.exec(after);
      if (a) {
        speaker = speakerFrom(a[1] ?? a[4], knownNames);
        tag = (a[2] ?? a[3]).toLowerCase();
      } else {
        const b = TAG_BEFORE.exec(before);
        if (b) {
          speaker = speakerFrom(b[1], knownNames);
          tag = b[2].toLowerCase();
        }
      }
      if (!speaker) {
        // Action beat anywhere in the paragraph's narration: "Tom shrugged. “Fine.”"
        const narration = text.replace(/“[^”]*”|"[^"]*"/g, ' ');
        for (const beat of narration.matchAll(BEAT)) {
          speaker = speakerFrom(beat[1], knownNames);
          if (speaker) break;
        }
      }
      const line: DialogueLine = { block, start: s, end, text: text.slice(s, end), speaker, tag };
      lines.push(line);
      inPara.push(line);
      if (speaker) flushRun();
      else unattributed.push(line);
    });
    const named = [...new Set(inPara.map((l) => l.speaker).filter((x): x is string => !!x && !/^(?:he|she|they|I|we|you|it)$/.test(x)))];
    if (named.length >= 2) {
      const second = inPara.find((l) => l.speaker === named[1])!;
      issues.push({
        kind: 'two-speakers',
        block,
        start: second.start,
        end: second.end,
        message: `${named[0]} and ${named[1]} both speak in this paragraph. Start a new paragraph when the speaker changes, so readers always know who’s talking.`,
      });
    }
  });
  flushRun();

  const count = (xs: (string | null)[]) => {
    const m = new Map<string, number>();
    for (const x of xs) if (x) m.set(x, (m.get(x) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  const tags = count(lines.map((l) => l.tag));
  const tagged = tags.reduce((n, [, c]) => n + c, 0);
  const plain = tags.filter(([t]) => /^(?:said|says|say|asked|asks)$/.test(t)).reduce((n, [, c]) => n + c, 0);
  const tagNote =
    tagged >= 5 && plain / tagged < 0.5
      ? `Only ${plain} of ${tagged} speech tags are “said” or “asked”. Readers skim past those; showier verbs draw attention to the tag instead of the words. Let the dialogue carry the emotion, or use an action beat.`
      : null;
  return { lines, speakers: count(lines.map((l) => l.speaker)), tags, issues: issues.sort((a, b) => a.block - b.block || a.start - b.start), share: total ? spoken / total : 0, tagNote };
}
