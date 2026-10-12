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
  dialogue: 'Dialogue punctuation',
  consistency: 'Name & term consistency',
  clarity: 'Clarity & readability',
  style: 'Style (adverbs, passive voice, filler)',
};

/** error = very likely wrong; warning = probably wrong; style = optional craft suggestion. */
export type Severity = 'error' | 'warning' | 'style';

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
