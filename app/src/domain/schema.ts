import { z } from 'zod';

/** Bump when the persisted/exported shape changes; add a migration in storage/migrations.ts. */
export const SCHEMA_VERSION = 1;

const id = z.string().min(1).max(64);
const iso = z.string().min(1);
const idList = z.array(id).default([]);

/** Fields every persisted record carries. Loose objects preserve unknown fields from newer exports. */
const base = {
  id,
  projectId: id,
  createdAt: iso,
  updatedAt: iso,
  archivedAt: iso.nullable().default(null),
  /** Monotonic per-record revision; used for sync conflict detection instead of device clocks. */
  rev: z.number().int().nonnegative().default(1),
};

export const WRITING_STATUSES = ['idea', 'planned', 'drafting', 'written', 'revised', 'final'] as const;
export const writingStatus = z.enum(WRITING_STATUSES);
export type WritingStatus = z.infer<typeof writingStatus>;

export const projectSchema = z.looseObject({
  ...base,
  name: z.string(),
  kind: z.enum(['book', 'series']).default('book'),
  description: z.string().default(''),
  dailyGoal: z.number().int().nonnegative().default(0),
});

export const bookSchema = z.looseObject({
  ...base,
  title: z.string(),
  subtitle: z.string().default(''),
  order: z.number(),
  /** Optional word-count goal for the whole book (Home dashboard). */
  targetWords: z.number().int().nonnegative().optional(),
  /** Publishing details (used by the KDP / eBook exports). Optional on older records. */
  publishing: z
    .object({
      author: z.string().default(''),
      publisher: z.string().default(''),
      isbn: z.string().default(''),
      copyrightYear: z.string().default(''),
      dedication: z.string().default(''),
      aboutAuthor: z.string().default(''),
      language: z.string().default('en'),
      description: z.string().default(''),
    })
    .optional(),
  /** Logline, back-cover blurb and synopsis (Home → Pitch), the author's own text. Optional on older records. */
  pitch: z
    .object({
      logline: z.string().default(''),
      blurb: z.string().default(''),
      synopsis: z.string().default(''),
    })
    .optional(),
});

export const partSchema = z.looseObject({
  ...base,
  bookId: id,
  title: z.string(),
  order: z.number(),
});

export const chapterSchema = z.looseObject({
  ...base,
  bookId: id,
  partId: id.nullable().default(null),
  title: z.string(),
  order: z.number(),
  summary: z.string().default(''),
  status: writingStatus.default('drafting'),
  pinned: z.boolean().default(false),
  /** Optional word-count goal for the chapter. */
  targetWords: z.number().int().nonnegative().optional(),
});

/** ProseMirror/TipTap JSON document. Validated structurally by the editor schema at load time. */
export const docJson = z.looseObject({ type: z.literal('doc'), content: z.array(z.any()).optional() });
export type DocJson = z.infer<typeof docJson>;

export const sceneSchema = z.looseObject({
  ...base,
  chapterId: id,
  title: z.string(),
  order: z.number(),
  content: docJson,
  /** Derived from content on save; used for search, counts and exports. */
  plainText: z.string().default(''),
  wordCount: z.number().int().nonnegative().default(0),
  summary: z.string().default(''),
  /** Sentence fingerprint of the text an AI summary was written from (to flag it when the scene changes a lot). */
  summaryBasis: z.array(z.string()).optional(),
  status: writingStatus.default('drafting'),
  povCharacterId: id.nullable().default(null),
  locationId: id.nullable().default(null),
  timeMarker: z.string().default(''),
  notes: z.string().default(''),
  plotThreadIds: idList,
  /** Reference ids linked from the prose (derived from refLink marks). */
  referenceIds: idList,
});

export const REFERENCE_TYPES = [
  'character',
  'location',
  'faction',
  'species',
  'item',
  'lore',
  'glossary',
  'research',
] as const;
export const referenceType = z.enum(REFERENCE_TYPES);
export type ReferenceType = z.infer<typeof referenceType>;

export const referenceLink = z.object({ targetId: id, label: z.string().default('') });

export const referenceSchema = z.looseObject({
  ...base,
  type: referenceType,
  name: z.string(),
  aliases: z.array(z.string()).default([]),
  summary: z.string().default(''),
  /** Template-driven structured fields, keyed by field key (see referenceTemplates.ts). */
  fields: z.record(z.string(), z.string()).default({}),
  tags: z.array(z.string()).default([]),
  favorite: z.boolean().default(false),
  status: z.string().default(''),
  links: z.array(referenceLink).default([]),
  notes: z.string().default(''),
  /** Optional small image (data URL, downscaled on import to keep the database light). */
  image: z.string().default(''),
});

export const plotThreadSchema = z.looseObject({
  ...base,
  name: z.string(),
  description: z.string().default(''),
  stakes: z.string().default(''),
  keyCharacterIds: idList,
  status: z.enum(['open', 'resolved', 'paused']).default('open'),
  resolution: z.string().default(''),
});

export const timelineEventSchema = z.looseObject({
  ...base,
  bookId: id.nullable().default(null),
  title: z.string(),
  /** Free-form in-world date or relative marker ("three days before the siege"). */
  when: z.string().default(''),
  /** Optional numeric sort key for chronological ordering; null means unknown. */
  sortKey: z.number().nullable().default(null),
  description: z.string().default(''),
  characterIds: idList,
  locationId: id.nullable().default(null),
  chapterId: id.nullable().default(null),
  sceneId: id.nullable().default(null),
  plotThreadIds: idList,
});

export const boardLaneSchema = z.looseObject({
  ...base,
  bookId: id,
  title: z.string(),
  order: z.number(),
});

export const CARD_TYPES = ['scene', 'beat', 'idea', 'question', 'research', 'reminder'] as const;
export type CardType = (typeof CARD_TYPES)[number];

export const boardCardSchema = z.looseObject({
  ...base,
  bookId: id,
  laneId: id,
  order: z.number(),
  title: z.string(),
  summary: z.string().default(''),
  type: z.enum(CARD_TYPES).default('scene'),
  status: writingStatus.default('idea'),
  chapterId: id.nullable().default(null),
  sceneId: id.nullable().default(null),
  povCharacterId: id.nullable().default(null),
  locationId: id.nullable().default(null),
  timeMarker: z.string().default(''),
  plotThreadIds: idList,
  referenceIds: idList,
  tags: z.array(z.string()).default([]),
  notes: z.string().default(''),
});

export const noteSchema = z.looseObject({
  ...base,
  title: z.string(),
  body: z.string().default(''),
  url: z.string().default(''),
  tags: z.array(z.string()).default([]),
  referenceIds: idList,
});

export const snapshotSchema = z.looseObject({
  ...base,
  sceneId: id,
  content: docJson,
  plainText: z.string().default(''),
  wordCount: z.number().int().nonnegative().default(0),
  reason: z.string().default('auto'),
});

export const REVISION_STATUSES = ['open', 'done', 'dismissed', 'later'] as const;
export type RevisionStatus = (typeof REVISION_STATUSES)[number];

/** One item of an edit pass: a suggestion or review finding to work through, anchored to its scene by its text. */
export const revisionSchema = z.looseObject({
  ...base,
  passId: id,
  /** The pass's name ("Edit pass: Chapter 3, 14 Oct"), repeated on each item. */
  passName: z.string(),
  sceneId: id,
  chapterId: id.nullable().default(null),
  /** Reading order within the pass. */
  order: z.number().default(0),
  /** The flagged words, and the sentence around them, to find the place again after edits. */
  quote: z.string(),
  context: z.string().default(''),
  /** What kind of item: a check's category ("grammar", "repetition"…) or a review finding ("sticky", "long"). */
  kind: z.string(),
  ruleId: z.string().default(''),
  message: z.string(),
  replacements: z.array(z.string()).default([]),
  status: z.enum(REVISION_STATUSES).default('open'),
  note: z.string().default(''),
});

/** Where a reference sits on a map: its node on the relationship map, or its pin on a location's picture. */
export const mapPoint = z.object({ referenceId: id, x: z.number(), y: z.number() });

/** A map: the relationship map (node positions) or a location's picture with pins on it. */
export const mapSchema = z.looseObject({
  ...base,
  kind: z.enum(['relationships', 'location']),
  /** For a location map: the place whose picture this is. */
  referenceId: id.nullable().default(null),
  title: z.string().default(''),
  /** Location maps: the picture (data URL, downscaled). */
  image: z.string().default(''),
  points: z.array(mapPoint).default([]),
});

export const dictionaryEntrySchema = z.looseObject({
  ...base,
  word: z.string().min(1),
});

export type Project = z.infer<typeof projectSchema>;
export type Book = z.infer<typeof bookSchema>;
export type Part = z.infer<typeof partSchema>;
export type Chapter = z.infer<typeof chapterSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type ReferenceEntry = z.infer<typeof referenceSchema>;
export type PlotThread = z.infer<typeof plotThreadSchema>;
export type TimelineEvent = z.infer<typeof timelineEventSchema>;
export type BoardLane = z.infer<typeof boardLaneSchema>;
export type BoardCard = z.infer<typeof boardCardSchema>;
export type Note = z.infer<typeof noteSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type DictionaryEntry = z.infer<typeof dictionaryEntrySchema>;
export type Revision = z.infer<typeof revisionSchema>;
export type MapRecord = z.infer<typeof mapSchema>;
export type MapPoint = z.infer<typeof mapPoint>;

/** Every project-scoped table, in dependency order (parents first). Shared by storage and archives. */
export const PROJECT_TABLES = {
  projects: projectSchema,
  books: bookSchema,
  parts: partSchema,
  chapters: chapterSchema,
  scenes: sceneSchema,
  references: referenceSchema,
  plotThreads: plotThreadSchema,
  timelineEvents: timelineEventSchema,
  boardLanes: boardLaneSchema,
  boardCards: boardCardSchema,
  notes: noteSchema,
  snapshots: snapshotSchema,
  dictionary: dictionaryEntrySchema,
  revisions: revisionSchema,
  maps: mapSchema,
} as const;

export type TableName = keyof typeof PROJECT_TABLES;
export const TABLE_NAMES = Object.keys(PROJECT_TABLES) as TableName[];

export interface TableTypes {
  projects: Project;
  books: Book;
  parts: Part;
  chapters: Chapter;
  scenes: Scene;
  references: ReferenceEntry;
  plotThreads: PlotThread;
  timelineEvents: TimelineEvent;
  boardLanes: BoardLane;
  boardCards: BoardCard;
  notes: Note;
  snapshots: Snapshot;
  dictionary: DictionaryEntry;
  revisions: Revision;
  maps: MapRecord;
}

export interface CustomTheme {
  id: string;
  name: string;
  colors: { background: string; panel: string; page: string; text: string; accent: string };
  /** An optional picture behind everything (see ThemeBackground). */
  background?: { image: string; mode: 'fit' | 'repeat'; fade: number } | null;
}

/** Optional online grammar check (LanguageTool). Off until the author opts in. */
export interface OnlineCheckSettings {
  enabled: boolean;
  /** Full URL of a LanguageTool /v2/check endpoint. */
  endpoint: string;
  /** LanguageTool's "picky" level adds more style and typography rules. */
  picky: boolean;
  /** When the author agreed to send text (ISO time); null until then. */
  consentedAt: string | null;
  /** The author turned off the grammar engine on this computer; don't switch it back on automatically. */
  localEngineOptOut: boolean;
}

export const LT_PUBLIC_ENDPOINT = 'https://api.languagetool.org/v2/check';

export interface UserSettings {
  /** 'system' (Paper/Night by OS setting) or a theme id. */
  theme: string;
  customThemes: CustomTheme[];
  fontSize: number;
  lineHeight: number;
  fontFamily: 'serif' | 'sans';
  dialect: 'en-US' | 'en-GB';
  disabledRules: string[];
  disabledCategories: string[];
  staleThreadChapters: number;
  lastProjectId: string | null;
  lastBackupAt: string | null;
  backupReminderDays: number;
  proofreadEnabled: boolean;
  browserSpellcheck: boolean;
  onlineCheck: OnlineCheckSettings;
  /** With the AI Editor installed: let it read each flagged adverb's sentence and keep only the weak ones underlined. */
  aiJudgeAdverbs: boolean;
  /** AI Editor creativity, 0 (faithful) to 1 (creative). */
  aiTemperature: number;
  /** Offer to install missing add-ons (grammar engine, AI Editor) when AuthorDesk starts. */
  addonPrompt: 'ask' | 'never';
  pageWidth: 'narrow' | 'medium' | 'wide';
  /** The pacing strip beside the page (sentence lengths, dialogue and narration). */
  pacingStrip: boolean;
}

export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'system',
  customThemes: [],
  fontSize: 19,
  lineHeight: 1.7,
  fontFamily: 'serif',
  dialect: 'en-US',
  disabledRules: [],
  disabledCategories: ['style'],
  staleThreadChapters: 5,
  lastProjectId: null,
  lastBackupAt: null,
  backupReminderDays: 7,
  proofreadEnabled: true,
  browserSpellcheck: false,
  onlineCheck: { enabled: false, endpoint: LT_PUBLIC_ENDPOINT, picky: false, consentedAt: null, localEngineOptOut: false },
  aiJudgeAdverbs: true,
  aiTemperature: 0.4,
  addonPrompt: 'ask',
  pageWidth: 'medium',
  pacingStrip: true,
};
