import { Editor } from '@tiptap/core';
import { avoidEchoes, stem, findEchoes } from '../src/proofreading/echo';
import { reviewManuscript } from '../src/review/metrics';
import { aiTaskForMark } from '../src/ai/markTask';
import { AI_TASKS, buildMessages, pickBest } from '../src/ai/prompts';
import { resetDbForTests } from '../src/storage/db';
import { createProject } from '../src/storage/repo';
import { editorExtensions } from '../src/editor/extensions';
import { getSuggestions } from '../src/editor/proofreadExtension';
import { runProofread } from '../src/editor/proofreadRunner';

const echoes = (texts: string[], names: string[] = [], window?: number) => findEchoes(texts, names, window).map((e) => `${e.block}:${e.word}:${e.distance}`);

describe('echo words', () => {
  it('flags a noticeable word used again a few lines later, marking the second use', () => {
    expect(echoes(['She glanced at the teapot. Waves broke on the stones. He glanced back at her.'])).toEqual(['0:glanced:10']);
  });

  it('works across paragraphs, within the window only', () => {
    expect(echoes(['The teapot was quiet.', 'Later the teapot filled with boats.'])).toEqual(['1:teapot:5']);
    const filler = 'alpha bravo cedar delta ember fable glade haven indigo jumble kettle lantern meadow nectar orchid pebble quarry raven saddle timber umber velvet willow yonder zephyr amber birch cobalt dapple ermine flint garnet hollow ivory jasper kestrel lilac maple nimbus ochre plume quill russet sable thistle umbra vesper wren yarrow';
    const far = `The teapot was quiet. ${filler}. The teapot woke.`;
    expect(echoes([far])).toEqual([]);
  });

  it('ignores little words, natural repeats, names, plurals of possessives and speech', () => {
    expect(echoes(['Winnie said yes. Winnie said no. The door, the door.'], ['Winnie Hartley'])).toEqual([]);
    expect(echoes(['“Never, never, never again,” she whispered.'])).toEqual([]);
    expect(echoes(['The teapot’s lights faded. The teapot slept.'])).toEqual(['0:teapot:4']);
  });

  it('leaves names of people and places alone, listed or not', () => {
    // In the references, by any part of the name or an alias.
    expect(echoes(['They reached Willow Creek at dusk. The creek road led on to Willow Creek.'], ['Willow Creek'])).toEqual([]);
    expect(echoes(['Doc Marsh waved. Later Marsh left.'], ['Tobias Marsh', 'Doc'])).toEqual([]);
    // Not listed: capitalised mid-sentence and never in lower case, including at the start of a sentence.
    expect(echoes(['They rode to Ashford. Ashford was asleep, and the road to Ashford was empty.'])).toEqual([]);
    expect(echoes(['She met Marguerite at noon. “Marguerite!” she called.'])).toEqual([]);
    // Words that name a person, and contractions.
    expect(echoes(['Me: Hey, Grandma, sorry. After all, she was my grandma. The nurse came; the nurse left.'])).toEqual([]);
    expect(echoes(['Wouldn’t she? He wouldn’t.', "I'll go. I'll stay."])).toEqual([]);
    // Everyday places.
    expect(echoes(['I make my way through the lobby to the elevator. The elevator doors open onto another lobby.'])).toEqual([]);
    // An ordinary word that only happens to start a sentence is still an echo.
    expect(echoes(['The teapot was quiet. Teapot lights blinked in the teapot.'])).toEqual(['0:Teapot:3', '0:teapot:5']);
  });

  it('counts echoes per chapter in the review', () => {
    const r = reviewManuscript([{ sceneId: 's', chapterId: 'c', chapterTitle: 'One', text: 'She glanced at the teapot. He glanced back. The teapot shone.' }]);
    expect(r.chapters[0].per1k.echoes).toBeGreaterThan(0);
  });

  it('opens the AI Editor with a "without the echo" rewrite of the paragraph', () => {
    expect(aiTaskForMark({ ruleId: 'echo-word', category: 'repetition', original: 'glanced' })).toEqual({ task: 'no-repeat', focus: 'glanced' });
    const task = AI_TASKS.find((t) => t.id === 'no-repeat')!;
    expect(buildMessages(task, { text: 'She glanced up. He glanced back.', focus: 'glanced' })[1].content).toMatch(/so the word “glanced” is used only once/);
  });
});

describe('echo words in the editor', () => {
  beforeEach(() => resetDbForTests());

  it('underlines the second use in teal, with synonyms', async () => {
    const { project } = await createProject('Echoes');
    const ed = new Editor({ extensions: editorExtensions(), content: '<p>She walked to the gate. The wind rose. Then she walked home.</p>' });
    await runProofread(ed, project.id);
    const echo = getSuggestions(ed.state).filter((s) => s.ruleId === 'echo-word');
    expect(echo).toHaveLength(1);
    expect(echo[0]).toMatchObject({ severity: 'echo', original: 'walked', replacements: expect.arrayContaining(['strolled']) });
    expect(echo[0].message).toMatch(/also used \d+ words earlier/);
    ed.destroy();
  });

  it('leaves out echoes it has nothing to offer for when the AI Editor isn’t installed', async () => {
    const { project } = await createProject('Echoes');
    const ed = new Editor({ extensions: editorExtensions(), content: '<p>The lighthouse stood alone. Gulls circled. The lighthouse was dark.</p>' });
    await runProofread(ed, project.id);
    expect(getSuggestions(ed.state).filter((s) => s.ruleId === 'echo-word')).toEqual([]);
    ed.destroy();
  });
});

describe('echo alternatives that would only echo again', () => {
  it('treats forms of one word as the same word', () => {
    expect(stem('glanced')).toBe(stem('glance'));
    expect(stem('glancing')).toBe(stem('glances'));
  });

  it('drops other forms of the word and words already used nearby, but not glue words', () => {
    expect(avoidEchoes('glanced', ['peered', 'stole a glance', 'looked over'], 'She looked away, over the fence.')).toEqual(['peered']);
    expect(avoidEchoes('quiet', ['silent', 'hushed', 'cast over'], 'The air was silent. He walked over.')).toEqual(['hushed', 'cast over']);
  });
});

describe('"Without the echo" rewrites', () => {
  const task = AI_TASKS.find((t) => t.id === 'no-repeat')!;

  it('asks for the sentence without the word when the earlier use is outside it', () => {
    const prompt = buildMessages(task, { text: 'I squeeze my eyes shut tightly.', focus: 'tightly' })[1].content;
    expect(prompt).toMatch(/without “tightly” or any other form of it/);
    expect(prompt).toMatch(/exactly 5 versions/);
  });

  it('shows only versions that drop the word, in any form', () => {
    const original = 'I squeeze my eyes shut tightly.';
    const versions = ['I squeeze my eyes shut tight.', 'I squeeze my eyes closed.', 'I clench my eyes shut tightly.', 'I screw my eyes shut.'];
    expect(pickBest(task, versions, original, 'tightly')).toEqual(['I squeeze my eyes closed.', 'I screw my eyes shut.']);
    expect(pickBest(task, ['She glanced up. He looked back.', 'She glanced up. He glanced back.'], 'She glanced up. He glanced back.', 'glanced')).toEqual(['She glanced up. He looked back.']);
  });
});
