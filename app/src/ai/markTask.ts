import type { Suggestion } from '../proofreading/types';
import type { AiTaskId } from './prompts';
import { AI_JUDGED_RULES, judgedWord } from './adverbJudge';

/**
 * Which AI Editor action suits a flagged mark, if any. Clicking such a mark opens the AI Editor on its sentence and
 * runs this action. Spelling, punctuation, names and character details have exact fixes already, so they don't.
 */
export function aiTaskForMark(s: Pick<Suggestion, 'ruleId' | 'category' | 'original'>): { task: AiTaskId; focus: string | null } | null {
  if (AI_JUDGED_RULES.has(s.ruleId)) return { task: 'no-adverb', focus: judgedWord(s) };
  if (s.ruleId === 'dialogue-redundant-tag') return { task: 'no-adverb', focus: s.original.split(/\s+/).pop() ?? null };
  if (s.ruleId.startsWith('character-') || s.ruleId === 'new-name' || s.ruleId === 'name-consistency') return null;
  switch (s.category) {
    case 'grammar':
    case 'confused':
      return { task: 'grammar', focus: s.original };
    case 'repetition':
      return { task: 'rewrite', focus: s.original };
    case 'clarity':
    case 'style':
      return { task: 'smoother', focus: s.original };
    default:
      return null;
  }
}
