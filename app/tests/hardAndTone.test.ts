import { findHardSentences, hardSentenceMessage, sentenceSpans } from '../src/proofreading/hardSentence';
import { aiTaskForMark } from '../src/ai/markTask';
import { AI_TASKS, buildMessages, isAnswerTask, narrativeTense, pickBest } from '../src/ai/prompts';
import { bestForMark, bestOf, taskById } from '../src/ai/markRewrite';

describe('hard-to-read sentences', () => {
  const long =
    'I quietly reach for the knob and return to the room, changing into some clothes and grabbing the keys to my Jeep, careful not to wake Jace as I close the door and make my way to the hospital.';

  it('finds sentences with their exact offsets', () => {
    const text = 'Short one. Another short one! And a third?';
    expect(sentenceSpans(text).map((s) => text.slice(s.start, s.end))).toEqual(['Short one.', 'Another short one!', 'And a third?']);
  });

  it('flags a long sentence made of many clauses, and says why', () => {
    const text = `She sat down. ${long}`;
    const [h] = findHardSentences(text);
    expect(text.slice(h.start, h.end)).toBe(long);
    expect(hardSentenceMessage(h)).toMatch(/hard to follow \(\d+ words in \d+ parts\)/);
  });

  it('flags dense sentences by reading grade, and leaves ordinary ones alone', () => {
    expect(findHardSentences('The institutional administration’s comprehensive reorganization necessitated considerable interdepartmental communication regarding organizational responsibilities, operational accountability and the consequential reallocation of administrative resources throughout the organization.')).toHaveLength(1);
    expect(findHardSentences('The rain came down hard on the tin roof, and she listened to it for a long time before she slept.')).toEqual([]);
  });

  it('leaves outline notes alone', () => {
    expect(findHardSentences(`- ${long}`)).toEqual([]);
  });

  it('opens the AI Editor’s “Clearer” action on the sentence', () => {
    expect(aiTaskForMark({ ruleId: 'hard-sentence', category: 'clarity', original: long })).toEqual({ task: 'clearer', focus: null });
  });
});

describe('the AI suggestion in a mark’s popover', () => {
  it('picks the best usable version, or none when nothing changed', () => {
    const noRepeat = taskById('no-repeat');
    expect(bestOf(noRepeat, '1. I squeeze my eyes shut tightly.\n2. I press my eyes shut.\n3. I clamp my eyes shut.', 'I squeeze my eyes shut tightly.', 'tightly')).toBe('I press my eyes shut.');
    expect(bestOf(taskById('grammar'), 'He went home.', 'He went home.', null)).toBeNull();
    expect(bestOf(taskById('grammar'), 'He went home.', 'He goed home.', null)).toBe('He went home.');
  });

  it('runs the request itself when the side panel isn’t open', async () => {
    let body: { messages: { content: string }[] } | null = null;
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      body = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ choices: [{ message: { content: '1. She left early.\n2. She went early.' } }] }));
    }) as unknown as typeof fetch;
    const best = await bestForMark({ id: 1, text: 'She left, and then she left again early.', context: '', task: 'clearer', focus: null, from: 1, to: 40, markKey: 'k', panel: false }, { fetchImpl });
    expect(best).toBe('She left early.');
    expect(body!.messages[1].content).toMatch(/easier to follow/);
  });
});

describe('“What’s the tone?”', () => {
  const task = AI_TASKS.find((t) => t.id === 'tone-read')!;

  it('is an answer, not a rewrite', () => {
    expect(isAnswerTask('tone-read')).toBe(true);
    expect(isAnswerTask('rewrite')).toBe(false);
  });

  it('asks for tones with quoted evidence, and compares with the tone the author wants', () => {
    const plain = buildMessages(task, { text: 'The house was silent.' })[1].content;
    expect(plain).toMatch(/Name 1 to 3 tones/);
    expect(plain).not.toMatch(/wants this scene/);
    const aimed = buildMessages(task, { text: 'The house was silent.', intendedTone: 'warm, hopeful' })[1].content;
    expect(aimed).toMatch(/wants this scene to feel: warm, hopeful/);
  });
});

describe('keeping the tense', () => {
  it('reads the tense of the narration, ignoring dialogue', () => {
    expect(narrativeTense('I quietly reach for the knob and return to the room. I close the door.')).toBe('present');
    expect(narrativeTense('She reached for the knob. She closed the door and went out.')).toBe('past');
    expect(narrativeTense('“I am fine,” she said. She walked away.')).toBe('past');
    expect(narrativeTense('Rain.')).toBeNull();
  });

  it('tells the model the tense, and drops versions that change it', () => {
    const clearer = AI_TASKS.find((t) => t.id === 'clearer')!;
    const original = 'I quietly reach for the knob and return to the room, and I close the door.';
    expect(buildMessages(clearer, { text: original })[1].content).toMatch(/Keep it in the present tense/);
    expect(pickBest(clearer, ['I reached for the knob and returned to the room. I closed the door.', 'I reach for the knob and return to the room. I close the door.'], original)).toEqual([
      'I reach for the knob and return to the room. I close the door.',
    ]);
  });
});
