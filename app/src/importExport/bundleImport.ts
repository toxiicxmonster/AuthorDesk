/**
 * "Import your own files": chapters as Markdown/text files plus spreadsheets (CSV) for characters, places,
 * world entries, the story board, the timeline and plot threads. The exact layout is documented in
 * docs/IMPORTING.md; the example in docs/import-template is what "Download a starter template" gives you.
 *
 * Importing is two steps: buildImportPlan() reads and checks everything without touching data (shown as a
 * preview), then applyImportPlan() creates the records and links them by name.
 */
import { unzipSync, strFromU8 } from 'fflate';
import type { DocJson, ReferenceType, WritingStatus, CardType, ReferenceEntry } from '../domain/schema';
import { REFERENCE_TYPES, WRITING_STATUSES, CARD_TYPES } from '../domain/schema';
import { REFERENCE_TEMPLATES } from '../domain/referenceTemplates';
import { normalizeName } from '../domain/text';
import { normHeader, readSheet, splitList } from './csv';
import { inline } from './textImport';
import { db } from '../storage/db';
import { archiveRecord, createCard, createChapter, createRecord, createScene } from '../storage/repo';
import { createReference } from '../domain/references';

export interface BundleFile {
  path: string;
  text: string;
}

const TEXT_EXT = /\.(md|markdown|txt|csv|tsv)$/i;
const MAX_FILE = 20 * 1024 * 1024;
const MAX_TOTAL = 200 * 1024 * 1024;

// ---------------------------------------------------------------- reading files

/** Read the text files from a zip. Unsafe paths and non-text files are skipped. */
export function filesFromZip(bytes: Uint8Array): BundleFile[] {
  let total = 0;
  const entries = unzipSync(bytes, {
    filter: (f) => {
      if (!TEXT_EXT.test(f.name) || f.name.includes('..') || f.name.startsWith('/') || /(^|\/)(__MACOSX|\.)/.test(f.name)) return false;
      if (f.originalSize > MAX_FILE) return false;
      total += f.originalSize;
      if (total > MAX_TOTAL) throw new Error('The zip is too large to import (over 200 MB of text).');
      return true;
    },
  });
  return stripCommonRoot(Object.entries(entries).map(([path, data]) => ({ path, text: strFromU8(data) })));
}

/** Read files picked with a folder picker (webkitdirectory) or multi-file picker. */
export async function filesFromPicker(list: FileList | File[]): Promise<BundleFile[]> {
  const out: BundleFile[] = [];
  for (const f of Array.from(list)) {
    const path = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    if (!TEXT_EXT.test(path) || /(^|\/)(__MACOSX|\.)/.test(path) || f.size > MAX_FILE) continue;
    out.push({ path, text: await f.text() });
  }
  return stripCommonRoot(out);
}

/** "My Book/characters.csv" → "characters.csv" when everything sits inside one top folder. */
export function stripCommonRoot(files: BundleFile[]): BundleFile[] {
  const norm = files.map((f) => ({ ...f, path: f.path.replace(/\\/g, '/').replace(/^\.\//, '') }));
  const firsts = new Set(norm.map((f) => (f.path.includes('/') ? f.path.split('/')[0] : '')));
  if (firsts.size === 1 && !firsts.has('')) {
    const root = [...firsts][0];
    const known = ['chapters', 'characters', 'locations', 'places', 'notes', 'research'];
    if (!known.includes(root.toLowerCase())) return norm.map((f) => ({ ...f, path: f.path.slice(root.length + 1) }));
  }
  return norm;
}

// ---------------------------------------------------------------- plan types

export interface PlanRef {
  type: ReferenceType;
  name: string;
  aliases: string[];
  summary: string;
  status: string;
  fields: Record<string, string>;
  tags: string[];
  notes: string;
  favorite: boolean;
  source: string;
}
export interface PlanChapter {
  title: string;
  scenes: { title: string; doc: DocJson; words: number }[];
  source: string;
}
export interface PlanCard {
  lane: string;
  title: string;
  summary: string;
  type: CardType;
  status: WritingStatus;
  chapter: string;
  pov: string;
  location: string;
  characters: string[];
  threads: string[];
  when: string;
  tags: string[];
  notes: string;
}
export interface PlanEvent {
  title: string;
  when: string;
  order: number | null;
  description: string;
  characters: string[];
  location: string;
  chapter: string;
  threads: string[];
}
export interface PlanThread {
  name: string;
  description: string;
  stakes: string;
  status: 'open' | 'resolved' | 'paused';
  characters: string[];
  resolution: string;
}
export interface PlanNote {
  title: string;
  body: string;
  url: string;
  tags: string[];
}
export interface ImportPlan {
  chapters: PlanChapter[];
  refs: PlanRef[];
  cards: PlanCard[];
  events: PlanEvent[];
  threads: PlanThread[];
  notes: PlanNote[];
  /** Things the author should know (ignored files, unknown values…). Nothing here stops the import. */
  warnings: string[];
  /** Files that were understood, for the preview. */
  used: string[];
}

// ---------------------------------------------------------------- column mapping

const COMMON: Record<string, keyof PlanRef> = {
  name: 'name',
  title: 'name',
  alsoknownas: 'aliases',
  aka: 'aliases',
  alias: 'aliases',
  aliases: 'aliases',
  nickname: 'aliases',
  nicknames: 'aliases',
  othernames: 'aliases',
  summary: 'summary',
  shortdescription: 'summary',
  inasentence: 'summary',
  inasentenceortwo: 'summary',
  oneliner: 'summary',
  status: 'status',
  currentstatus: 'status',
  statusrightnow: 'status',
  tags: 'tags',
  tag: 'tags',
  notes: 'notes',
  note: 'notes',
  favourite: 'favorite',
  favorite: 'favorite',
  star: 'favorite',
  starred: 'favorite',
};

/** Extra spellings people use for template fields. */
const SYNONYMS: Partial<Record<ReferenceType, Record<string, string>>> = {
  character: {
    looks: 'appearance',
    physicalappearance: 'appearance',
    physicaldescription: 'appearance',
    description: '__summary',
    motivation: 'goals',
    motivations: 'goals',
    goalsandmotivations: 'goals',
    secrets: 'fears',
    fearsandsecrets: 'fears',
    skills: 'strengths',
    strengthsandskills: 'strengths',
    weaknesses: 'flaws',
    flawsandlimitations: 'flaws',
    history: 'backstory',
    background: 'backstory',
    characterarc: 'arc',
    dialogue: 'voice',
    speech: 'voice',
    voicedialoguenotes: 'voice',
    temperament: 'personality',
    personalityandtemperament: 'personality',
  },
  location: {
    parent: 'region',
    parentlocation: 'region',
    regionparentlocation: 'region',
    sightssoundssmells: 'sensory',
    senses: 'sensory',
    people: 'inhabitants',
  },
};

const TYPE_NAMES: Record<string, ReferenceType> = {
  character: 'character',
  person: 'character',
  people: 'character',
  location: 'location',
  place: 'location',
  faction: 'faction',
  family: 'faction',
  organisation: 'faction',
  organization: 'faction',
  group: 'faction',
  species: 'species',
  culture: 'species',
  race: 'species',
  item: 'item',
  object: 'item',
  artifact: 'item',
  artefact: 'item',
  technology: 'item',
  magic: 'item',
  lore: 'lore',
  event: 'lore',
  history: 'lore',
  legend: 'lore',
  glossary: 'glossary',
  term: 'glossary',
  rule: 'glossary',
  word: 'glossary',
  research: 'research',
  source: 'research',
};

export function resolveRefType(v: string): ReferenceType | null {
  const k = normHeader(v).replace(/s$/, '');
  return TYPE_NAMES[k] ?? TYPE_NAMES[normHeader(v)] ?? ((REFERENCE_TYPES as readonly string[]).includes(k) ? (k as ReferenceType) : null);
}

const truthy = (v: string) => /^(y|yes|true|1|x|★|\*)$/i.test(v.trim());

function emptyRef(type: ReferenceType, source: string): PlanRef {
  return { type, name: '', aliases: [], summary: '', status: '', fields: {}, tags: [], notes: '', favorite: false, source };
}

/** Put one "column/key = value" into a reference, using template fields where the name matches. */
function assignRefValue(r: PlanRef, header: string, value: string) {
  if (!value) return;
  const k = normHeader(header);
  const common = COMMON[k];
  if (common === 'aliases') r.aliases.push(...splitList(value));
  else if (common === 'tags') r.tags.push(...splitList(value, true));
  else if (common === 'favorite') r.favorite = truthy(value);
  else if (common === 'name' || common === 'summary' || common === 'status' || common === 'notes') r[common] = value;
  else {
    const template = REFERENCE_TEMPLATES[r.type];
    const syn = SYNONYMS[r.type]?.[k];
    if (syn === '__summary') {
      r.summary = r.summary || value;
      return;
    }
    const field = template.find((f) => normHeader(f.key) === k || normHeader(f.label) === k || f.key === syn);
    r.fields[field ? field.key : header.trim()] = value;
  }
}

function refsFromSheet(text: string, source: string, fixedType: ReferenceType | null, warnings: string[]): PlanRef[] {
  const sheet = readSheet(text);
  const out: PlanRef[] = [];
  const typeKey = sheet.headers.map(normHeader).find((h) => h === 'type' || h === 'kind' || h === 'category');
  sheet.rows.forEach((row, i) => {
    let type = fixedType;
    if (!type) {
      type = resolveRefType(row[typeKey ?? 'type'] ?? '');
      if (!type) {
        warnings.push(`${source} row ${i + 2}: unknown type “${row[typeKey ?? 'type'] ?? ''}”, imported as Lore.`);
        type = 'lore';
      }
    }
    const r = emptyRef(type, `${source} row ${i + 2}`);
    sheet.headers.forEach((h) => {
      if (normHeader(h) !== typeKey) assignRefValue(r, h, row[normHeader(h)] ?? '');
    });
    if (!r.name) {
      if (Object.values(row).some(Boolean)) warnings.push(`${source} row ${i + 2}: no Name, skipped.`);
      return;
    }
    out.push(r);
  });
  return out;
}

/** A profile file: "# Name", then "Key: value" lines, then free-form notes. */
export function refFromMarkdown(text: string, fileName: string, type: ReferenceType, source: string): PlanRef {
  const r = emptyRef(type, source);
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  const h = lines[i]?.match(/^#\s+(.+)/);
  if (h) {
    r.name = h[1].trim();
    i++;
  } else r.name = baseName(fileName);
  const rest: string[] = [];
  let inHeader = true;
  let seenKey = false;
  for (; i < lines.length; i++) {
    const line = lines[i];
    const kv = inHeader ? line.match(/^\s*([A-Za-z][\w ’'/&()-]{0,40}):\s*(.+)$/) : null;
    if (kv) {
      assignRefValue(r, kv[1], kv[2].trim());
      seenKey = true;
    } else if (inHeader && !line.trim()) {
      // A blank line after the "Key: value" block ends it; everything after is notes.
      if (seenKey) inHeader = false;
    } else {
      inHeader = false;
      rest.push(line);
    }
  }
  const body = rest.join('\n').trim();
  if (body) r.notes = r.notes ? `${r.notes}\n\n${body}` : body;
  return r;
}

// ---------------------------------------------------------------- chapters

function baseName(path: string): string {
  const file = path.split('/').pop() ?? path;
  return file
    .replace(/\.[^.]+$/, '')
    .replace(/^\s*\d+\s*[-_.):]*\s*/, '')
    .trim() || file;
}

const BREAK = /^\s*(\*\s*\*\s*\*|\*{3,}|#|-{3,}|~{3,})\s*$/;

/** Turn the body of one scene into a document. Blank lines separate paragraphs. */
export function textToDoc(body: string): DocJson {
  const text = body.replace(/\r\n?/g, '\n').trim();
  const single = !/\n\s*\n/.test(text);
  const blocks = single ? text.split('\n') : text.split(/\n\s*\n/);
  const content: unknown[] = [];
  for (const raw of blocks) {
    const b = raw.replace(/\n/g, ' ').trim();
    if (!b) continue;
    if (BREAK.test(b)) content.push({ type: 'horizontalRule' });
    else if (/^###\s+/.test(b)) content.push({ type: 'heading', attrs: { level: 3 }, content: inline(b.replace(/^###\s+/, '')) });
    else if (/^>\s?/.test(b)) content.push({ type: 'blockquote', content: [{ type: 'paragraph', content: inline(b.replace(/^>\s?/, '')) }] });
    else content.push({ type: 'paragraph', content: inline(b) });
  }
  return { type: 'doc', content: content.length ? (content as DocJson['content']) : [{ type: 'paragraph' }] };
}

const wordsIn = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/**
 * One chapter file. Title: a "# Heading" line, or (for plain text) a short first line followed by a blank
 * line, otherwise the file name without its leading number. "## Heading" lines start a new scene.
 */
export function chapterFromFile(text: string, path: string): PlanChapter {
  const lines = text.replace(/\r\n?/g, '\n').replace(new RegExp('^' + String.fromCharCode(0xfeff)), '').split('\n');
  let title = '';
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  const h1 = lines[i]?.match(/^#\s+(.+)/);
  if (h1) {
    title = h1[1].trim();
    i++;
  } else if (lines[i] && lines[i].trim().length <= 80 && !/[.!?"”,;]$/.test(lines[i].trim()) && !(lines[i + 1] ?? '').trim()) {
    title = lines[i].trim();
    i++;
  }
  if (!title) title = baseName(path);
  const scenes: PlanChapter['scenes'] = [];
  let sceneTitle = '';
  let buf: string[] = [];
  const flush = () => {
    const body = buf.join('\n').trim();
    if (body || sceneTitle) {
      scenes.push({ title: sceneTitle || `Scene ${scenes.length + 1}`, doc: textToDoc(body), words: wordsIn(body) });
    }
    buf = [];
  };
  for (; i < lines.length; i++) {
    const h2 = lines[i].match(/^##\s+(.+)/);
    if (h2) {
      flush();
      sceneTitle = h2[1].trim();
    } else buf.push(lines[i]);
  }
  flush();
  if (!scenes.length) scenes.push({ title: 'Scene 1', doc: textToDoc(''), words: 0 });
  return { title, scenes, source: path };
}

/** A whole manuscript in one file: chapters start at "# Title" (or lines beginning with Chapter/Prologue/Epilogue). */
export function chaptersFromManuscript(text: string, path: string): PlanChapter[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const starts: number[] = [];
  lines.forEach((l, i) => {
    if (/^#\s+\S/.test(l) || /^(chapter|prologue|epilogue)\b.{0,60}$/i.test(l.trim())) starts.push(i);
  });
  if (!starts.length) return [chapterFromFile(text, path)];
  const out: PlanChapter[] = [];
  const pre = lines.slice(0, starts[0]).join('\n').trim();
  if (pre) out.push(chapterFromFile(pre, 'Opening'));
  starts.forEach((s, k) => {
    const chunk = lines.slice(s, starts[k + 1] ?? lines.length);
    if (!/^#\s/.test(chunk[0])) chunk[0] = `# ${chunk[0].trim()}`;
    out.push(chapterFromFile(chunk.join('\n'), path));
  });
  return out;
}

// ---------------------------------------------------------------- board, timeline, threads

const CARD_TYPE_NAMES: Record<string, CardType> = {
  scene: 'scene',
  beat: 'beat',
  plotbeat: 'beat',
  idea: 'idea',
  question: 'question',
  research: 'research',
  reminder: 'reminder',
  note: 'reminder',
  todo: 'reminder',
};

const STATUS_NAMES: Record<string, WritingStatus> = {
  idea: 'idea',
  planned: 'planned',
  plan: 'planned',
  outlined: 'planned',
  todo: 'planned',
  drafting: 'drafting',
  draft: 'drafting',
  inprogress: 'drafting',
  started: 'drafting',
  written: 'written',
  done: 'written',
  drafted: 'written',
  firstdraft: 'written',
  revised: 'revised',
  edited: 'revised',
  final: 'final',
  finished: 'final',
  complete: 'final',
};

function status(v: string, where: string, warnings: string[], dflt: WritingStatus): WritingStatus {
  if (!v) return dflt;
  const s = STATUS_NAMES[normHeader(v)];
  if (!s) warnings.push(`${where}: status “${v}” isn’t one of ${WRITING_STATUSES.join(', ')}; used “${dflt}”.`);
  return s ?? dflt;
}

function pick(row: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) if (row[k]) return row[k];
  return '';
}

function cardsFromSheet(text: string, source: string, warnings: string[]): PlanCard[] {
  return readSheet(text).rows.flatMap((row, i) => {
    const where = `${source} row ${i + 2}`;
    const title = pick(row, 'title', 'card', 'name', 'scene');
    if (!title) {
      if (Object.values(row).some(Boolean)) warnings.push(`${where}: no Title, skipped.`);
      return [];
    }
    const t = pick(row, 'type', 'kind');
    const type = t ? CARD_TYPE_NAMES[normHeader(t)] : 'scene';
    if (t && !type) warnings.push(`${where}: type “${t}” isn’t one of ${CARD_TYPES.join(', ')}; used “scene”.`);
    return [
      {
        lane: pick(row, 'column', 'lane', 'act', 'list', 'group'),
        title,
        summary: pick(row, 'summary', 'description', 'synopsis'),
        type: type ?? 'scene',
        status: status(pick(row, 'status'), where, warnings, 'idea'),
        chapter: pick(row, 'chapter'),
        pov: pick(row, 'pov', 'pointofview', 'viewpoint'),
        location: pick(row, 'location', 'place', 'setting'),
        characters: splitList(pick(row, 'characters', 'cast', 'people', 'references', 'links')),
        threads: splitList(pick(row, 'plotthreads', 'plotthread', 'threads', 'thread', 'subplots', 'subplot')),
        when: pick(row, 'when', 'time', 'timemarker', 'date'),
        tags: splitList(pick(row, 'tags', 'tag'), true),
        notes: pick(row, 'notes', 'note'),
      },
    ];
  });
}

function eventsFromSheet(text: string, source: string, warnings: string[]): PlanEvent[] {
  return readSheet(text).rows.flatMap((row, i) => {
    const title = pick(row, 'title', 'event', 'name', 'what');
    if (!title) {
      if (Object.values(row).some(Boolean)) warnings.push(`${source} row ${i + 2}: no Title, skipped.`);
      return [];
    }
    const orderRaw = pick(row, 'order', 'sort', 'sortkey', 'number', 'sequence');
    const order = orderRaw === '' ? null : Number(orderRaw);
    if (orderRaw && Number.isNaN(order)) warnings.push(`${source} row ${i + 2}: Order “${orderRaw}” isn’t a number; left blank.`);
    return [
      {
        title,
        when: pick(row, 'when', 'date', 'time'),
        order: order === null || Number.isNaN(order) ? null : order,
        description: pick(row, 'description', 'summary', 'details', 'notes'),
        characters: splitList(pick(row, 'characters', 'who', 'people', 'cast')),
        location: pick(row, 'location', 'where', 'place'),
        chapter: pick(row, 'chapter'),
        threads: splitList(pick(row, 'plotthreads', 'plotthread', 'threads', 'thread')),
      },
    ];
  });
}

function threadsFromSheet(text: string, source: string, warnings: string[]): PlanThread[] {
  return readSheet(text).rows.flatMap((row, i) => {
    const name = pick(row, 'name', 'title', 'thread', 'plotthread');
    if (!name) {
      if (Object.values(row).some(Boolean)) warnings.push(`${source} row ${i + 2}: no Name, skipped.`);
      return [];
    }
    const s = normHeader(pick(row, 'status'));
    return [
      {
        name,
        description: pick(row, 'description', 'summary'),
        stakes: pick(row, 'stakes'),
        status: s === 'resolved' || s === 'done' || s === 'closed' || s === 'finished' ? 'resolved' : s === 'paused' || s === 'onhold' ? 'paused' : 'open',
        characters: splitList(pick(row, 'characters', 'keycharacters', 'who', 'cast')),
        resolution: pick(row, 'resolution', 'ending', 'outcome'),
      },
    ];
  });
}

function noteFromFile(text: string, path: string): PlanNote {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  let title = baseName(path);
  const h = lines[i]?.match(/^#\s+(.+)/);
  if (h) {
    title = h[1].trim();
    i++;
  }
  let url = '';
  let tags: string[] = [];
  const body: string[] = [];
  let header = true;
  for (; i < lines.length; i++) {
    const m = header ? lines[i].match(/^\s*(source|url|link|tags)\s*:\s*(.+)$/i) : null;
    if (m) {
      if (/tags/i.test(m[1])) tags = splitList(m[2], true);
      else url = m[2].trim();
    } else if (header && !lines[i].trim()) continue;
    else {
      header = false;
      body.push(lines[i]);
    }
  }
  return { title, body: body.join('\n').trim(), url, tags };
}

// ---------------------------------------------------------------- plan

const isCsv = (p: string) => /\.(csv|tsv)$/i.test(p);
const isText = (p: string) => /\.(md|markdown|txt)$/i.test(p);

/** Read and check every file without changing anything. */
export function buildImportPlan(files: BundleFile[]): ImportPlan {
  const plan: ImportPlan = { chapters: [], refs: [], cards: [], events: [], threads: [], notes: [], warnings: [], used: [] };
  const w = plan.warnings;
  const sorted = files.slice().sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }));
  for (const f of sorted) {
    const p = f.path.toLowerCase();
    const parts = p.split('/');
    const folder = parts.length > 1 ? parts[0] : '';
    const file = parts[parts.length - 1];
    const stem = file.replace(/\.[^.]+$/, '').replace(/[\s_-]+/g, '');
    let used = true;
    if (folder === 'chapters' && isText(p)) plan.chapters.push(chapterFromFile(f.text, f.path));
    else if (!folder && isText(p) && /^(manuscript|book|draft|novel)$/.test(stem)) plan.chapters.push(...chaptersFromManuscript(f.text, f.path));
    else if ((folder === 'characters' || folder === 'people') && isText(p)) plan.refs.push(refFromMarkdown(f.text, f.path, 'character', f.path));
    else if ((folder === 'locations' || folder === 'places') && isText(p)) plan.refs.push(refFromMarkdown(f.text, f.path, 'location', f.path));
    else if ((folder === 'notes' || folder === 'research') && isText(p)) plan.notes.push(noteFromFile(f.text, f.path));
    else if (!folder && isCsv(p) && /^(characters|people|cast)$/.test(stem)) plan.refs.push(...refsFromSheet(f.text, f.path, 'character', w));
    else if (!folder && isCsv(p) && /^(locations|places|settings)$/.test(stem)) plan.refs.push(...refsFromSheet(f.text, f.path, 'location', w));
    else if (!folder && isCsv(p) && /^(world|references|worldbuilding|storybible)$/.test(stem)) plan.refs.push(...refsFromSheet(f.text, f.path, null, w));
    else if (!folder && isCsv(p) && /^(board|storyboard|cards|outline)$/.test(stem)) plan.cards.push(...cardsFromSheet(f.text, f.path, w));
    else if (!folder && isCsv(p) && /^(timeline|events)$/.test(stem)) plan.events.push(...eventsFromSheet(f.text, f.path, w));
    else if (!folder && isCsv(p) && /^(plotthreads|threads|subplots)$/.test(stem)) plan.threads.push(...threadsFromSheet(f.text, f.path, w));
    else if (/(^|\/)readme\.(md|txt)$/.test(p)) used = false;
    else if (!folder && isText(p)) plan.chapters.push(...chaptersFromManuscript(f.text, f.path));
    else {
      used = false;
      w.push(`Ignored “${f.path}” — it doesn’t match the import layout (see “How to lay out your files”).`);
    }
    if (used) plan.used.push(f.path);
  }
  // Same name twice in the import itself.
  const seen = new Map<string, string>();
  plan.refs = plan.refs.filter((r) => {
    const k = `${r.type}:${normalizeName(r.name)}`;
    if (seen.has(k)) {
      w.push(`“${r.name}” appears twice (${seen.get(k)} and ${r.source}); only the first is imported.`);
      return false;
    }
    seen.set(k, r.source);
    return true;
  });
  return plan;
}

// ---------------------------------------------------------------- apply

export interface BundleReport {
  chapters: number;
  scenes: number;
  words: number;
  refs: number;
  refsSkipped: string[];
  cards: number;
  lanesCreated: string[];
  events: number;
  threads: number;
  notes: number;
  /** Names in the board/timeline that didn't match any character, place, chapter or thread. */
  unmatched: string[];
}

/**
 * Create everything in the plan inside `bookId`. Chapters are added after existing ones. Characters/places
 * that already exist (same name) are skipped unless duplicates = 'add'. Board/timeline names are linked to
 * entries by name or alias, chapters by title.
 */
export async function applyImportPlan(projectId: string, bookId: string, plan: ImportPlan, opts: { duplicates: 'skip' | 'add' } = { duplicates: 'skip' }): Promise<BundleReport> {
  const report: BundleReport = { chapters: 0, scenes: 0, words: 0, refs: 0, refsSkipped: [], cards: 0, lanesCreated: [], events: 0, threads: 0, notes: 0, unmatched: [] };

  // References (and a name index covering existing + new, by name and alias)
  const existing = (await db.references.where('projectId').equals(projectId).toArray()).filter((r) => !r.archivedAt);
  const byName = new Map<string, ReferenceEntry>();
  const index = (r: ReferenceEntry) => {
    for (const n of [r.name, ...r.aliases]) if (!byName.has(normalizeName(n))) byName.set(normalizeName(n), r);
  };
  existing.forEach(index);
  for (const r of plan.refs) {
    const dup = existing.find((e) => e.type === r.type && normalizeName(e.name) === normalizeName(r.name));
    if (dup && opts.duplicates === 'skip') {
      report.refsSkipped.push(r.name);
      continue;
    }
    const created = await createReference(projectId, r.type, r.name, {
      aliases: [...new Set(r.aliases)],
      summary: r.summary,
      status: r.status,
      fields: r.fields,
      tags: [...new Set(r.tags)],
      notes: r.notes,
      favorite: r.favorite,
    });
    index(created);
    report.refs++;
  }
  const findRef = (name: string, what: string) => {
    if (!name) return null;
    const r = byName.get(normalizeName(name));
    if (!r) report.unmatched.push(`${what} “${name}”`);
    return r ?? null;
  };

  // Plot threads (existing ones are reused by name; unknown names used on cards/events are created)
  const threadByName = new Map((await db.plotThreads.where('projectId').equals(projectId).toArray()).filter((t) => !t.archivedAt).map((t) => [normalizeName(t.name), t.id]));
  for (const t of plan.threads) {
    if (threadByName.has(normalizeName(t.name))) continue;
    const created = await createRecord('plotThreads', projectId, {
      name: t.name,
      description: t.description,
      stakes: t.stakes,
      status: t.status,
      resolution: t.resolution,
      keyCharacterIds: t.characters.map((c) => findRef(c, 'Character')?.id).filter((x): x is string => !!x),
    });
    threadByName.set(normalizeName(t.name), created.id);
    report.threads++;
  }
  const threadIds = async (names: string[]) => {
    const ids: string[] = [];
    for (const n of names) {
      let id = threadByName.get(normalizeName(n));
      if (!id) {
        id = (await createRecord('plotThreads', projectId, { name: n, description: '', stakes: '', keyCharacterIds: [], status: 'open', resolution: '' })).id;
        threadByName.set(normalizeName(n), id);
        report.threads++;
      }
      ids.push(id);
    }
    return ids;
  };

  // Chapters. A brand-new book's untouched, empty 'Chapter 1' is moved to Trash so imported chapters come first.
  if (plan.chapters.length) {
    const live = (await db.chapters.where('bookId').equals(bookId).toArray()).filter((c) => !c.archivedAt);
    if (live.length === 1 && /^chapter 1$/i.test(live[0].title.trim())) {
      const sc = (await db.scenes.where('chapterId').equals(live[0].id).toArray()).filter((s) => !s.archivedAt);
      if (sc.every((s) => !s.plainText.trim())) await archiveRecord('chapters', live[0].id);
    }
  }
  const chapterByTitle = new Map<string, { chapterId: string; sceneId: string | null }>();
  for (const c of (await db.chapters.where('bookId').equals(bookId).toArray()).filter((c) => !c.archivedAt)) chapterByTitle.set(normalizeName(c.title), { chapterId: c.id, sceneId: null });
  for (const ch of plan.chapters) {
    const created = await createChapter(projectId, bookId, ch.title, { withScene: false });
    let first: string | null = null;
    for (const s of ch.scenes) {
      const sc = await createScene(projectId, created.id, s.title, s.doc);
      first ??= sc.id;
      report.scenes++;
      report.words += sc.wordCount;
    }
    chapterByTitle.set(normalizeName(ch.title), { chapterId: created.id, sceneId: first });
    report.chapters++;
  }
  const findChapter = (title: string) => {
    if (!title) return null;
    const c = chapterByTitle.get(normalizeName(title));
    if (!c) report.unmatched.push(`Chapter “${title}”`);
    return c ?? null;
  };

  // Board
  if (plan.cards.length) {
    const lanes = (await db.boardLanes.where('bookId').equals(bookId).toArray()).filter((l) => !l.archivedAt).sort((a, b) => a.order - b.order);
    const laneByName = new Map(lanes.map((l) => [normalizeName(l.title), l.id]));
    let order = lanes.length;
    const laneFor = async (name: string) => {
      const n = name || 'Imported cards';
      let id = laneByName.get(normalizeName(n));
      if (!id) {
        id = (await createRecord('boardLanes', projectId, { bookId, title: n, order: order++ })).id;
        laneByName.set(normalizeName(n), id);
        report.lanesCreated.push(n);
      }
      return id;
    };
    for (const c of plan.cards) {
      const ch = findChapter(c.chapter);
      await createCard(projectId, bookId, await laneFor(c.lane), {
        title: c.title,
        summary: c.summary,
        type: c.type,
        status: c.status,
        chapterId: ch?.chapterId ?? null,
        sceneId: ch?.sceneId ?? null,
        povCharacterId: findRef(c.pov, 'POV')?.id ?? null,
        locationId: findRef(c.location, 'Location')?.id ?? null,
        referenceIds: c.characters.map((n) => findRef(n, 'Character')?.id).filter((x): x is string => !!x),
        plotThreadIds: await threadIds(c.threads),
        timeMarker: c.when,
        tags: c.tags,
        notes: c.notes,
      });
      report.cards++;
    }
  }

  // Timeline
  for (const e of plan.events) {
    const ch = findChapter(e.chapter);
    await createRecord('timelineEvents', projectId, {
      bookId,
      title: e.title,
      when: e.when,
      sortKey: e.order,
      description: e.description,
      characterIds: e.characters.map((n) => findRef(n, 'Character')?.id).filter((x): x is string => !!x),
      locationId: findRef(e.location, 'Location')?.id ?? null,
      chapterId: ch?.chapterId ?? null,
      sceneId: ch?.sceneId ?? null,
      plotThreadIds: await threadIds(e.threads),
    });
    report.events++;
  }

  // Notes (linked to any entry whose name appears in the title)
  for (const n of plan.notes) {
    await createRecord('notes', projectId, { title: n.title, body: n.body, url: n.url, tags: n.tags, referenceIds: [] });
    report.notes++;
  }

  report.unmatched = [...new Set(report.unmatched)];
  return report;
}

// ---------------------------------------------------------------- starter template

/** The example layout from docs/import-template, bundled into the app as a downloadable zip. */
export async function starterTemplateZip(): Promise<Uint8Array> {
  const { zipSync, strToU8 } = await import('fflate');
  const raw = import.meta.glob('../../../docs/import-template/**/*.{md,csv,txt}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const files: Record<string, Uint8Array> = {};
  for (const [p, text] of Object.entries(raw)) {
    const rel = p.split('docs/import-template/')[1];
    files[`AuthorDesk import template/${rel}`] = strToU8(text);
  }
  files['AuthorDesk import template/README.txt'] = strToU8(
    'Replace the example content with your own, keep the file and folder names, then choose\nBackup > Import your own files > Choose a folder (or the zipped folder).\nFull instructions: IMPORTING.md in the AuthorDesk folder, or Help inside the app.\nDelete any file you do not need; every file is optional.\n',
  );
  return zipSync(files);
}

export function templateFiles(): BundleFile[] {
  const raw = import.meta.glob('../../../docs/import-template/**/*.{md,csv,txt}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  return Object.entries(raw).map(([p, text]) => ({ path: p.split('docs/import-template/')[1], text }));
}
