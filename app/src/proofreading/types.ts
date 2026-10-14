export const CATEGORIES = [
  'spelling',
  'grammar',
  'punctuation',
  'capitalization',
  'confused',
  'repetition',
  'dialogue',
  'consistency',
  'clarity',
  'style',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  spelling: 'Spelling',
  grammar: 'Grammar',
  punctuation: 'Punctuation',
  capitalization: 'Capitalization',
  confused: 'Commonly confused words',
  repetition: 'Repeated words',
  dialogue: 'Dialogue',
  consistency: 'Name & term consistency',
  clarity: 'Clarity & readability',
  style: 'Style (adverbs, passive voice, filler)',
};

/**
 * error = very likely wrong; warning = probably wrong; style = optional craft suggestion;
 * conflict = contradicts a character's reference entry; note = a detail the reference entry could gain;
 * echo = the same noticeable word used again a few lines later; hard = a sentence that may be hard to follow.
 * Each has its own underline colour.
 */
export type Severity = 'error' | 'warning' | 'echo' | 'hard' | 'style' | 'conflict' | 'note';

/** Most important first; also decides which colour shows when marks overlap. */
export const SEVERITY_RANK: Record<Severity, number> = { error: 0, conflict: 1, warning: 2, echo: 3, hard: 4, style: 5, note: 6 };

export const SEVERITY_LABEL: Record<Severity, string> = {
  error: 'Likely error',
  conflict: 'Doesn’t match the character',
  warning: 'Check',
  echo: 'Echo',
  hard: 'Hard to read',
  style: 'Style',
  note: 'Character detail',
};

export interface Suggestion {
  /** Offsets into the exact text string that was checked. */
  start: number;
  end: number;
  /** The text that was flagged; used to detect stale suggestions before applying. */
  original: string;
  replacements: string[];
  category: Category;
  severity: Severity;
  message: string;
  ruleId: string;
  providerId: string;
  confidence?: number;
  /** Extra facts for suggestions whose action isn't a text change (e.g. which character entry to update). */
  data?: Record<string, string>;
}

export interface ProofreadContext {
  dialect: 'en-US' | 'en-GB';
  disabledRules: ReadonlySet<string>;
  disabledCategories: ReadonlySet<string>;
  /** Lower-cased words from the custom dictionary. */
  dictionary: ReadonlySet<string>;
  /** Character/location/term names (and aliases) from the reference library. */
  knownNames: readonly string[];
}

/** Replaceable proofreading backend. Local providers run in-browser; remote providers must be opt-in. */
export interface ProofreadingProvider {
  id: string;
  label: string;
  /** True if text never leaves the device. */
  local: boolean;
  check(text: string, ctx: ProofreadContext): Promise<Suggestion[]>;
}
