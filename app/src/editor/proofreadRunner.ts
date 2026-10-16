import type { Editor } from '@tiptap/core';
import { db } from '../storage/db';
import { getSettings } from '../storage/settings';
import { checkBlocks, findNewNames, SPELL_PROVIDER_ID } from '../proofreading/providers';
import { knownNameSpans, protectNames } from '../proofreading/names';
import { characterDetailSuggestions, type CharacterInfo } from '../proofreading/characterFacts';
import { avoidEchoes, findEchoes } from '../proofreading/echo';
import { findHardSentences, hardSentenceMessage } from '../proofreading/hardSentence';
import { findTenseSlips, tenseSlipMessage } from '../proofreading/tense';
import { findContradictions, findDeathIssues } from '../proofreading/continuity';
import { findAgeIssues } from '../proofreading/ages';
import { bookScenesFor, placeFactsCached, storyDates } from '../proofreading/continuityData';
import { synonymsFor } from '../proofreading/synonyms';
import { fetchAiStatus } from '../ai/aiEditor';
import { AI_JUDGED_RULES, cachedVerdict, judgeAdverbs, judgedWord, sentenceAround, type AdverbItem } from '../ai/adverbJudge';

/** When the AI Editor last failed to judge; adverbs show unjudged for a while after a failure. */
let aiJudgeFailedAt = 0;
import { checkOnline } from '../proofreading/languageTool';
import { dedupe, normalizeRuleId } from '../proofreading/rules';
import type { ProofreadContext, Suggestion } from '../proofreading/types';
import { hashText } from '../domain/text';
import { collectTextBlocks } from './blocks';
import { setSuggestionsMeta, proofreadKey, type PlacedSuggestion } from './proofreadExtension';

export async function buildProofreadContext(projectId: string): Promise<ProofreadContext> {
  const [settings, dict, refs] = await Promise.all([
    getSettings(),
    db.dictionary.where('projectId').equals(projectId).toArray(),
    db.references.where('projectId').equals(projectId).toArray(),
  ]);
  const knownNames: string[] = [];
  for (const r of refs) {
    if (r.archivedAt) continue;
    knownNames.push(r.name, ...r.aliases);
  }
  return {
    dialect: settings.dialect,
    disabledRules: new Set(settings.disabledRules.map(normalizeRuleId)),
    disabledCategories: new Set(settings.disabledCategories),
    dictionary: new Set(dict.map((d) => d.word.toLowerCase())),
    knownNames,
  };
}

/** Key identifying one flagged occurrence, stable across edits elsewhere in the scene. */
export function ignoreKey(ruleId: string, original: string, context: string): string {
  return `${ruleId}|${original}|${hashText(context)}`;
}

export interface ProofreadOutcome {
  count: number;
  spellingError: string | null;
  stale: boolean;
  /** Online check: null when it is off; otherwise a short status ("checked", or why it didn't fully run). */
  online: { error: string | null; unchecked: number } | null;
}

/**
 * Check the whole scene and place suggestions in the editor. Never modifies the text.
 * On-device results are placed first; if the online check is on, its results are merged in when they arrive
 * (`onLocal` reports the first phase so the status can update meanwhile).
 */
export async function runProofread(
  editor: Editor,
  projectId: string,
  opts: {
    onLocal?: (o: ProofreadOutcome) => void;
    /** false = don't send anything; reuse online results for unchanged paragraphs. */
    sendOnline?: boolean;
    /** The open scene, so continuity can compare it with the rest of its book. */
    sceneId?: string;
  } = {},
): Promise<ProofreadOutcome> {
  const { onLocal, sendOnline = true } = opts;
  const docAtStart = editor.state.doc;
  const blocks = collectTextBlocks(docAtStart);
  const texts = blocks.map((b) => b.text);
  const [ctx, settings, ignoredRows] = await Promise.all([buildProofreadContext(projectId), getSettings(), db.ignored.where('projectId').equals(projectId).toArray()]);
  const ignored = new Set(ignoredRows.map((i) => i.key));
  const [{ results, spellingError }, newNames, characters] = await Promise.all([
    checkBlocks(texts, ctx),
    findNewNames(texts, ctx).catch(() => texts.map((): Suggestion[] => [])),
    db.references.where('projectId').equals(projectId).toArray(),
  ]);
  const charInfo: CharacterInfo[] = characters
    .filter((r) => !r.archivedAt && r.type === 'character')
    .map((r) => ({ id: r.id, name: r.name, aliases: r.aliases, appearance: r.fields.appearance ?? '' }));
  // With the AI Editor installed, it reads each flagged adverb's sentence first; only the weak ones stay underlined.
  const aiInstalled = !!(await fetchAiStatus())?.installed;
  const aiJudging = settings.aiJudgeAdverbs && Date.now() - aiJudgeFailedAt > 120_000 && aiInstalled;
  const pendingAi: AdverbItem[] = [];
  const judged = (s: Suggestion, bi: number): Suggestion | null => {
    if (!aiJudging || !AI_JUDGED_RULES.has(s.ruleId)) return s;
    const item: AdverbItem = { word: judgedWord(s), ...sentenceAround(texts[bi], s.start, s.end) };
    const v = cachedVerdict(item);
    if (!v) {
      pendingAi.push(item); // hidden until the AI has read it
      return null;
    }
    if (v.keep) return null;
    return v.reason ? { ...s, message: `${s.message} AI Editor: ${v.reason}` } : s;
  };
  // Echo words (teal): the same noticeable word again within a few lines. Offered with synonyms; without any,
  // only when the AI Editor can suggest a rewrite instead.
  const echoes = texts.map((): Suggestion[] => []);
  if (!ctx.disabledRules.has('echo-word') && !ctx.disabledCategories.has('repetition')) {
    for (const e of findEchoes(texts, ctx.knownNames)) {
      // Leave out synonyms already used in the paragraphs around it: they'd only make another echo.
      const replacements = avoidEchoes(e.word, synonymsFor(e.word), texts.slice(Math.max(0, e.block - 1), e.block + 2).join(' '));
      if (!replacements.length && !aiInstalled) continue;
      echoes[e.block].push({
        start: e.start,
        end: e.end,
        original: e.word,
        replacements,
        category: 'repetition',
        severity: 'echo',
        ruleId: 'echo-word',
        providerId: 'local-echo',
        message: `“${e.word}” was also used ${e.distance} words earlier. A different word${replacements.length ? '' : ' or a small rephrase'} avoids the echo.`,
      });
    }
  }
  // Hard to read (orange): long, many-claused or very dense sentences. The fix is the AI Editor's "Clearer" version.
  const hard = texts.map((): Suggestion[] => []);
  if (aiInstalled && !ctx.disabledRules.has('hard-sentence') && !ctx.disabledCategories.has('clarity')) {
    texts.forEach((t, bi) => {
      for (const h of findHardSentences(t)) {
        hard[bi].push({
          start: h.start,
          end: h.end,
          original: t.slice(h.start, h.end),
          replacements: [],
          category: 'clarity',
          severity: 'hard',
          ruleId: 'hard-sentence',
          providerId: 'local-hard',
          message: hardSentenceMessage(h),
        });
      }
    });
  }
  // Tense slips: narration that drifts out of the scene's main tense, marked where each stretch starts.
  const tense = texts.map((): Suggestion[] => []);
  if (!ctx.disabledRules.has('tense-shift') && !ctx.disabledCategories.has('grammar')) {
    for (const t of findTenseSlips(texts, charInfo.flatMap((c) => [c.name, ...c.aliases]))) {
      tense[t.block].push({
        start: t.start,
        end: t.end,
        original: t.word,
        replacements: t.replacement ? [t.replacement] : [],
        category: 'grammar',
        severity: 'warning',
        ruleId: 'tense-shift',
        providerId: 'local-tense',
        message: tenseSlipMessage(t),
        data: { toTense: t.main },
      });
    }
  }
  // Continuity (purple): this scene describes a character differently from elsewhere in the book, or a character
  // speaks after their entry says they died.
  const continuity = texts.map((): Suggestion[] => []);
  if (opts.sceneId && !ctx.disabledRules.has('continuity') && !ctx.disabledCategories.has('consistency')) {
    const book = await bookScenesFor(opts.sceneId);
    if (book) {
      const here = book.find((s) => s.sceneId === opts.sceneId);
      if (here) here.paragraphs = texts; // the live text, block for block with the editor
      const dismissed = new Set([...ignored].filter((k) => k.startsWith('continuity|')));
      const facts = placeFactsCached(book, charInfo);
      const { dates, births, startAges } = await storyDates(projectId, book, characters.filter((r) => !r.archivedAt && r.type === 'character'));
      for (const a of findAgeIssues(facts, dates, births, dismissed, startAges)) {
        if (a.fact.sceneId !== opts.sceneId) continue;
        continuity[a.fact.block]?.push({
          start: a.fact.start,
          end: a.fact.end,
          original: a.fact.original,
          replacements: [],
          category: 'consistency',
          severity: 'conflict',
          ruleId: 'continuity-age',
          providerId: 'local-continuity',
          message: a.message,
          data: a.earlier
            ? { ignoreKey: a.key, characterId: a.characterId, characterName: a.characterName, otherSceneId: a.earlier.sceneId, otherFind: a.earlier.original, otherChapter: a.earlier.chapterTitle }
            : { ignoreKey: a.key, characterId: a.characterId, characterName: a.characterName },
        });
      }
      for (const c of findContradictions(facts, dismissed, new Set(dates.keys()))) {
        for (const [mine, theirs, when] of [
          [c.other, c.first, 'earlier'],
          [c.first, c.other, 'later'],
        ] as const) {
          if (mine.sceneId !== opts.sceneId) continue;
          const what = c.label === 'Build' ? 'build' : c.label.toLowerCase();
          continuity[mine.block]?.push({
            start: mine.start,
            end: mine.end,
            original: mine.original,
            replacements: [],
            category: 'consistency',
            severity: 'conflict',
            ruleId: 'continuity',
            providerId: 'local-continuity',
            message: `${c.characterName}’s ${what} ${what === 'eyes' ? 'are' : 'is'} “${mine.value}” here, but “${theirs.value}” ${when} ${theirs.sceneId === mine.sceneId ? 'in this scene' : `in “${theirs.chapterTitle}”`}.${c.note ? ' ' + c.note : ''}`,
            data: { ignoreKey: c.key, characterId: c.characterId, characterName: c.characterName, otherSceneId: theirs.sceneId, otherFind: theirs.original, otherChapter: theirs.chapterTitle },
          });
        }
      }
      const statuses = new Map(characters.map((r) => [r.id, r.status]));
      for (const d of findDeathIssues(book.filter((s) => s.sceneId === opts.sceneId), charInfo.map((c) => ({ ...c, status: statuses.get(c.id) ?? '' })), ctx.knownNames, dismissed)) {
        continuity[d.block]?.push({
          start: d.start,
          end: d.end,
          original: d.text,
          replacements: [],
          category: 'consistency',
          severity: 'conflict',
          ruleId: 'continuity-death',
          providerId: 'local-continuity',
          message: `${d.characterName}’s entry says “${d.status}”, but they speak here.`,
          data: { ignoreKey: d.key, characterId: d.characterId, characterName: d.characterName },
        });
      }
    }
  }
  // Details about listed characters their entries don't have yet (green) or contradict (purple).
  const details = ctx.disabledCategories.has('consistency') ? texts.map((): Suggestion[] => []) : characterDetailSuggestions(texts, charInfo, ctx.disabledRules);
  /**
   * Names are never flagged: known names (and names waiting to be added) are shielded from every check,
   * on-device and online; an unlisted name gets an "add it?" prompt instead.
   */
  const finalize = (list: Suggestion[], bi: number): Suggestion[] => {
    // "Elsei" next to a listed "Elsie" is a typo of a known character, not a new person.
    const prompts = (newNames[bi] ?? []).filter((p) => !list.some((s) => s.ruleId === 'name-consistency' && s.start < p.end && p.start < s.end));
    const spans: [number, number][] = [...knownNameSpans(texts[bi], ctx.knownNames), ...prompts.map((p): [number, number] => [p.start, p.end])];
    // Only show what offers something to change the text to (name prompts offer "add to characters" instead).
    const actionable = protectNames(texts[bi], list, spans)
      .filter((s) => s.replacements.length > 0)
      .map((s) => judged(s, bi))
      .filter((s): s is Suggestion => s !== null);
    const echo = (echoes[bi] ?? []).filter((e) => !actionable.some((s) => s.start < e.end && e.start < s.end && s.severity !== 'style'));
    const overlaps = (a: Suggestion, b: Suggestion) => a.start < b.end && b.start < a.end;
    // A contradiction with the character's entry already says enough on the same words; otherwise a contradiction
    // across chapters comes before "add this to the entry" (settle which is right first).
    const cont = (continuity[bi] ?? []).filter((c) => !(details[bi] ?? []).some((d) => d.ruleId === 'character-conflict' && overlaps(c, d)));
    const mine = (details[bi] ?? []).filter((d) => !(d.ruleId === 'character-fact' && cont.some((c) => overlaps(c, d))));
    const slips = (tense[bi] ?? []).filter((t) => !actionable.some((s) => overlaps(s, t)));
    return [...actionable, ...prompts, ...mine, ...cont, ...slips, ...echo, ...(hard[bi] ?? [])].sort((a, b) => a.start - b.start);
  };

  let lastLists: Suggestion[][] = results;
  const place = (lists: Suggestion[][]): number => {
    lastLists = lists;
    pendingAi.length = 0;
    const placed: PlacedSuggestion[] = [];
    lists.forEach((raw, bi) => {
      const b = blocks[bi];
      const list = finalize(raw, bi);
      for (const s of list) {
        const context = b.text.slice(Math.max(0, s.start - 20), s.end + 20);
        const key = s.data?.ignoreKey ?? ignoreKey(s.ruleId, s.original, context);
        if (ignored.has(key)) continue;
        placed.push({ ...s, key: `${key}@${b.pos + s.start}`, from: b.pos + s.start, to: b.pos + s.end });
      }
    });
    editor.view.dispatch(editor.state.tr.setMeta(proofreadKey, setSuggestionsMeta(placed)).setMeta('addToHistory', false));
    return placed.length;
  };
  // The author kept typing while we checked: these offsets belong to an old version. Discard them.
  const stale = () => editor.isDestroyed || editor.state.doc !== docAtStart;
  /** Once suggestions are placed, let the AI judge the held-back adverbs in the background, then show the weak ones. */
  const judgeLater = <T>(outcome: T): T => {
    if (pendingAi.length && !stale()) {
      void judgeAdverbs(pendingAi.slice())
        .catch(() => {
          aiJudgeFailedAt = Date.now();
        })
        .then(() => {
          if (stale()) return;
          if (Date.now() - aiJudgeFailedAt < 1000) {
            // Couldn't judge: show them the ordinary way rather than hiding them.
            void runProofread(editor, projectId, { sendOnline: false });
          } else place(lastLists);
        });
    }
    return outcome;
  };

  if (stale()) return { count: 0, spellingError, stale: true, online: null };
  const online = settings.onlineCheck.enabled && settings.onlineCheck.consentedAt ? settings.onlineCheck : null;
  if (!online) return judgeLater({ count: place(results), spellingError, stale: false, online: null });
  // Keep earlier online findings for paragraphs that haven't changed (no network).
  const known = await checkOnline(texts, ctx, online, undefined, true);
  // LanguageTool reads the whole sentence, so on the same word its spelling fix beats the dictionary's guess ("dont" → "don't", not "cont").
  const merged = (extra: Suggestion[][]) =>
    results.map((list, i) => {
      const online = extra[i] ?? [];
      const local = list.filter((s) => !(s.providerId === SPELL_PROVIDER_ID && online.some((o) => o.category === 'spelling' && o.replacements.length && o.start < s.end && s.start < o.end)));
      return dedupe([...local, ...online]);
    });
  const local: ProofreadOutcome = { count: place(merged(known.results)), spellingError, stale: false, online: { error: null, unchecked: known.unchecked } };
  if (!sendOnline || !known.unchecked) return judgeLater(local);
  onLocal?.(local);

  const remote = await checkOnline(texts, ctx, online);
  if (stale()) return { ...local, stale: true };
  // On-device suggestions come first so they win ties with the same span.
  const count = place(merged(remote.results));
  return judgeLater({ count, spellingError, stale: false, online: { error: remote.error, unchecked: remote.unchecked } });
}

export function clearProofread(editor: Editor) {
  if (editor.isDestroyed) return;
  editor.view.dispatch(editor.state.tr.setMeta(proofreadKey, setSuggestionsMeta([])).setMeta('addToHistory', false));
}

/** The ignore key without the position suffix. */
export function baseKey(placedKey: string): string {
  return placedKey.replace(/@\d+$/, '');
}
