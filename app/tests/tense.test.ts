import { describe, expect, it } from 'vitest';
import { findTenseSlips, narrationVerbs, tenseSlipMessage, toPast } from '../src/proofreading/tense';

const past = [
  'I stepped out of the room into the hallway.',
  'I stared at the wall and pressed my hand to my lips.',
  'She sighed. I clutched my phone tighter.',
  'He tightened his grip on the controller.',
  'I lowered my phone and wiped my face.',
  'I nodded. I sat down.',
];

describe('tense slips', () => {
  it('marks where a present-tense stretch starts in a past-tense scene', () => {
    const texts = [...past, 'I quietly reach for the knob and turn it. I change into some clothes.', 'I got in the Jeep and drove.'];
    const slips = findTenseSlips(texts);
    expect(slips).toHaveLength(1);
    expect(slips[0]).toMatchObject({ block: 6, word: 'reach', tense: 'present', main: 'past', run: 2, replacement: 'reached' });
    expect(tenseSlipMessage(slips[0])).toContain('mostly told in the past tense');
  });

  it('ignores dialogue, text messages and outline notes', () => {
    const texts = [...past, '"I want some peace and quiet," he snapped. "I am trying to hear my game."', 'Me: Hey, I love you! I miss you.', '- Finn helps her clean up'];
    expect(findTenseSlips(texts)).toEqual([]);
  });

  it('reads character names as subjects but not place names', () => {
    const v = narrationVerbs(['Jace snapped at me. The Book Shop sits on the corner. Finn picks up a box.'], ['Jace Kensington', 'The Book Shop', 'Finn Callahan']);
    expect(v.map((x) => [x.word, x.tense])).toEqual([
      ['snapped', 'past'],
      ['picks', 'present'],
    ]);
  });

  it('says nothing when the tense is evenly mixed or the scene is short', () => {
    expect(findTenseSlips(['I walked in. I sit down.'])).toEqual([]);
    expect(findTenseSlips(past)).toEqual([]);
  });

  it('flags a past slip in a present-tense scene without guessing a fix', () => {
    const present = ['I walk in. I sit down and I wait.', 'She smiles at me. He laughs. I look away.', 'I breathe out.', 'I stood up.', 'I open the door.'];
    const slips = findTenseSlips(present);
    expect(slips.map((s) => [s.word, s.replacement])).toEqual([['stood', null]]);
  });

  it('puts verbs into the past', () => {
    expect(['rub', 'reach', 'picks', 'tries', 'is', 'hold', 'arrive', 'open', 'watches', 'Make'].map((w) => toPast(w, /s$/.test(w)))).toEqual([
      'rubbed', 'reached', 'picked', 'tried', 'was', 'held', 'arrived', 'opened', 'watched', 'Made',
    ]);
  });
});

describe('tense slips and the AI Editor', () => {
  it('asks the AI to put the sentence back in the scene’s tense, not keep the slip', async () => {
    const { aiTaskForMark } = await import('../src/ai/markTask');
    const { buildMessages, AI_TASKS } = await import('../src/ai/prompts');
    const pick = aiTaskForMark({ ruleId: 'tense-shift', category: 'grammar', original: 'reach', data: { toTense: 'past' } });
    expect(pick).toEqual({ task: 'grammar', focus: 'reach', toTense: 'past' });
    const m = buildMessages(AI_TASKS.find((t) => t.id === 'grammar')!, { text: 'I quietly reach for the knob.', focus: 'reach', toTense: 'past' });
    expect(m[1].content).toContain('into the past tense');
    expect(m[1].content).not.toContain('Keep it in the present tense');
    expect(m[0].content).not.toContain('voice, tense,');
  });
});
