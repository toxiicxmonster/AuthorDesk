import { Editor } from '@tiptap/core';
import { chat, cleanAnswer, readStream, splitOptions } from '../src/ai/aiEditor';
import { AI_TASKS, buildMessages, countAdverbs, pickBest } from '../src/ai/prompts';
import { wordDiff } from '../src/ai/diff';
import { aiTaskForMark } from '../src/ai/markTask';
import { validateDetails } from '../src/ai/characterDetails';
import { cachedVerdict, judgeAdverbs, judgedWord, resetAdverbVerdicts, sentenceAround } from '../src/ai/adverbJudge';
import { resetDbForTests } from '../src/storage/db';
import { createProject } from '../src/storage/repo';
import { updateSettings } from '../src/storage/settings';
import { editorExtensions } from '../src/editor/extensions';
import { getSuggestions } from '../src/editor/proofreadExtension';
import { runProofread } from '../src/editor/proofreadRunner';

const sse = (chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      for (const ch of chunks) c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: ch } }] })}\n\n`));
      c.enqueue(enc.encode('data: [DONE]\n\n'));
      c.close();
    },
  });

const task = (id: string) => AI_TASKS.find((t) => t.id === id)!;

describe('AI Editor client', () => {
  it('reads a streamed answer, reporting progress', async () => {
    const seen: string[] = [];
    expect(await readStream(sse(['She ', 'crept ', 'out.']), (t) => seen.push(t))).toBe('She crept out.');
    expect(seen).toEqual(['She ', 'She crept ', 'She crept out.']);
  });

  it('turns HTTP errors into plain messages', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: 'The AI Editor is not installed.' }), { status: 503 })) as unknown as typeof fetch;
    await expect(chat([{ role: 'user', content: 'x' }], { fetchImpl })).rejects.toThrow('not installed');
  });

  it('cleans chatter and splits numbered versions', () => {
    expect(cleanAnswer('Here’s a rewrite:\n“She crept out.”')).toBe('She crept out.');
    expect(cleanAnswer("Sure! Here's the tighter version: She left.")).toBe('She left.');
    expect(splitOptions('1. She crept out.\n2. She slipped away.\n3. “She left.”')).toEqual(['She crept out.', 'She slipped away.', 'She left.']);
    expect(splitOptions('Just one answer.')).toEqual(['Just one answer.']);
  });

  it('builds prompts that forbid inventing, and include character notes read-only', () => {
    const [sys, user] = buildMessages(task('voice'), { text: '“Go,” she said.', character: 'Winnie Hartley', characters: [{ name: 'Winnie Hartley', aliases: [], notes: { 'Voice / dialogue notes': 'clipped, dry' } }] });
    expect(sys.content).toMatch(/Never add anything/);
    expect(sys.content).toMatch(/Voice \/ dialogue notes: clipped, dry/);
    expect(user.content).toMatch(/sound like Winnie Hartley would say them/);
    expect(user.content).toMatch(/exactly 3 versions/);
    expect(buildMessages(task('no-adverb'), { text: 'x' })[1].content).toMatch(/exactly 5 versions/);
  });

  it('keeps the versions that manage without adverbs', () => {
    expect(countAdverbs('She silently and gently pushed it, very slowly.')).toBe(4);
    expect(countAdverbs('She barely made it, only just.')).toBe(0);
    const shown = pickBest(task('no-adverb'), ['She quietly left.', 'She crept out.', 'She softly, slowly left.', 'She slipped away.', 'She eased out.']);
    expect(shown).toEqual(['She crept out.', 'She slipped away.', 'She eased out.']);
  });

  it('keeps only the spoken words of a character-voice suggestion', () => {
    const shown = pickBest(task('voice'), ['“Don’t wait for me,” she snapped, her braid whipping.', '"Never wait," he said.', '“Don’t wait for me,”']);
    expect(shown).toEqual(['“Don’t wait for me,”', '"Never wait,"']);
  });

  it('restores the quotation marks and closing comma a voice suggestion dropped', () => {
    const original = '“I told you not to wait for me,”';
    expect(pickBest(task('voice'), ["I told you, don't wait for me.", 'Did I not say so?'], original)).toEqual(["“I told you, don't wait for me,”", '“Did I not say so?”']);
  });

  it('highlights what a suggestion changed', () => {
    const parts = wordDiff('She walked slowly to the door.', 'She crept to the door.');
    expect(parts.filter((p) => p.changed).map((p) => p.text.trim())).toEqual(['crept']);
    expect(parts.map((p) => p.text).join('')).toBe('She crept to the door.');
  });
});

describe('finding character details with the AI', () => {
  const chars = [{ id: 'w', name: 'Winnie Hartley', aliases: ['Win'], fields: { fears: 'the dark' } }];
  const scene = 'Winnie hated the sea. Win’s laugh was loud and sudden.';

  it('keeps only real, quoted, new facts about listed characters', () => {
    const found = validateDetails(
      {
        details: [
          { character: 'Winnie', field: 'fears', fact: 'Hates the sea', quote: 'Winnie hated the sea.' },
          { character: 'Win', field: 'voice', fact: 'Loud, sudden laugh', quote: 'Win’s laugh was loud and sudden' },
          { character: 'Winnie', field: 'fears', fact: 'the dark', quote: 'Winnie hated the sea.' }, // already noted
          { character: 'Winnie', field: 'backstory', fact: 'Grew up by the sea', quote: 'She grew up by the sea.' }, // not in the scene
          { character: 'Tom', field: 'goals', fact: 'Wants money', quote: 'Winnie hated the sea.' }, // not listed
          { character: 'Winnie', field: 'shoeSize', fact: 'Nine', quote: 'Winnie hated the sea.' }, // not a field
        ],
      },
      chars,
      scene,
    );
    expect(found.map((d) => `${d.characterName}|${d.field}|${d.fact}`)).toEqual(['Winnie Hartley|fears|Hates the sea', 'Winnie Hartley|voice|Loud, sudden laugh']);
  });
});

describe('AI judging adverbs', () => {
  beforeEach(() => {
    resetAdverbVerdicts();
    resetDbForTests();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('finds the sentence and whether it is inside dialogue', () => {
    const text = 'He left. “Go home,” she whispered softly. Then rain.';
    expect(sentenceAround(text, text.indexOf('softly'), text.indexOf('softly') + 6)).toEqual({ sentence: '“Go home,” she whispered softly.', inDialogue: false });
    const t2 = '“I really don’t care,” Tom said.';
    expect(sentenceAround(t2, 3, 9).inDialogue).toBe(true);
    expect(judgedWord({ ruleId: 'stronger-word', original: 'ran quickly' })).toBe('quickly');
    expect(judgedWord({ ruleId: 'stronger-word', original: 'very tired' })).toBe('very');
  });

  it('asks once per word and sentence, and caches the verdicts', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ verdicts: [{ id: 1, verdict: 'cut', reason: 'Try “sprinted”.' }, { id: 2, verdict: 'keep', reason: 'Changes the meaning.' }] }) } }] }));
    }) as unknown as typeof fetch;
    const items = [
      { word: 'quickly', sentence: 'He ran quickly.', inDialogue: false },
      { word: 'barely', sentence: 'She barely breathed.', inDialogue: false },
    ];
    await judgeAdverbs(items, { fetchImpl });
    await judgeAdverbs(items, { fetchImpl });
    expect(calls).toBe(1);
    expect(cachedVerdict(items[0])).toEqual({ keep: false, reason: 'Try “sprinted”.' });
    expect(cachedVerdict(items[1])?.keep).toBe(true);
  });

  it('drops a reason that recommends another adverb, keeping the verdict', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ verdicts: [{ id: 1, verdict: 'cut', reason: "Replace 'quickly' with 'hurriedly'." }] }) } }] }))) as unknown as typeof fetch;
    const item = { word: 'quickly', sentence: 'She left quickly.', inDialogue: false };
    await judgeAdverbs([item], { fetchImpl });
    expect(cachedVerdict(item)).toEqual({ keep: false, reason: '' });
  });

  it('in the editor, hides adverbs the AI keeps and explains the ones it cuts', async () => {
    const { project } = await createProject('Adverbs');
    await updateSettings({ disabledCategories: [] }); // style hints on
    const text = 'He ran quickly. She could barely breathe.';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/ai/status') return new Response(JSON.stringify({ installed: true, ready: true, starting: false, model: 'test' }), { headers: { 'Content-Type': 'application/json' } });
        // The judge: "quickly" is weak, "barely" earns its place.
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ verdicts: [{ id: 1, verdict: 'cut', reason: 'Try “sprinted”.' }, { id: 2, verdict: 'keep', reason: 'Changes the meaning.' }] }) } }] }));
      }),
    );
    const ed = new Editor({ extensions: editorExtensions(), content: `<p>${text}</p>` });
    await runProofread(ed, project.id);
    // Held back until the AI has read them…
    expect(getSuggestions(ed.state).filter((s) => s.ruleId === 'adverb' || s.ruleId === 'stronger-word')).toEqual([]);
    await vi.waitFor(() => expect(getSuggestions(ed.state).some((s) => /AI Editor: Try “sprinted”/.test(s.message))).toBe(true));
    // …then only the weak one shows, with the AI's reason; "barely" never does.
    expect(getSuggestions(ed.state).some((s) => s.original.includes('barely'))).toBe(false);
    ed.destroy();
  });
});

describe('opening the AI Editor from a flagged mark', () => {
  const mark = (ruleId: string, category: string, original: string) => ({ ruleId, category, original }) as Parameters<typeof aiTaskForMark>[0];

  it('picks the action that suits the mark', () => {
    expect(aiTaskForMark(mark('stronger-word', 'clarity', 'ran quickly'))).toEqual({ task: 'no-adverb', focus: 'quickly' });
    expect(aiTaskForMark(mark('adverb', 'style', 'softly'))).toEqual({ task: 'no-adverb', focus: 'softly' });
    expect(aiTaskForMark(mark('lt:HE_VERB_AGR', 'grammar', 'go'))?.task).toBe('grammar');
    expect(aiTaskForMark(mark('repeated-word', 'repetition', 'the'))?.task).toBe('rewrite');
    expect(aiTaskForMark(mark('lt:TOO_LONG', 'clarity', 'This sentence'))?.task).toBe('smoother');
  });

  it('leaves marks with exact fixes to their popover', () => {
    for (const [r, c] of [['spelling', 'spelling'], ['space-before-punct', 'punctuation'], ['new-name', 'consistency'], ['character-fact', 'consistency'], ['sentence-capital', 'capitalization']])
      expect(aiTaskForMark(mark(r, c, 'x'))).toBeNull();
  });

  it('asks for a focused fix that leaves the rest of the sentence alone', () => {
    const [, user] = buildMessages(task('no-adverb'), { text: 'He ran quickly to the gate.', focus: 'quickly' });
    expect(user.content).toMatch(/without the word “quickly”/);
    expect(user.content).toMatch(/keep everything else as written/);
    expect(buildMessages(task('grammar'), { text: 'He go home.', focus: 'go' })[1].content).toMatch(/Focus on “go”/);
  });
});
