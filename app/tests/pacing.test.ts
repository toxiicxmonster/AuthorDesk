import { pacingSummary, pacingTicks, tickAt } from '../src/review/pacing';

const long = Array.from({ length: 32 }, (_, i) => `word${i}`).join(' ') + '.';

describe('pacing strip', () => {
  it('gives each sentence a tick at its document position, marking dialogue and long sentences', () => {
    const ticks = pacingTicks([
      { text: 'I squeeze my eyes shut. "Grandma?" I whisper.', pos: 1 },
      { text: long, pos: 60 },
      { text: '', pos: 200 },
    ]);
    expect(ticks.map((t) => [t.pos, t.dialogue, t.long, t.paragraphStart])).toEqual([
      [1, false, false, true],
      [1 + 'I squeeze my eyes shut. '.length, true, false, false],
      [1 + 'I squeeze my eyes shut. "Grandma?" '.length, false, false, false],
      [60, false, true, true],
    ]);
    expect(ticks[0].words).toBe(5);
  });

  it('marks every sentence of a long paragraph', () => {
    const para = Array.from({ length: 25 }, () => 'The shop bell rings and rings again.').join(' ');
    const ticks = pacingTicks([{ text: para, pos: 1 }]);
    expect(ticks).toHaveLength(25);
    expect(ticks.every((t) => t.longParagraph)).toBe(true);
  });

  it('summarises the scene and finds the sentence under a click', () => {
    const ticks = pacingTicks([
      { text: 'One two three. "Four," she said.', pos: 1 },
      { text: 'Five six seven eight.', pos: 50 },
    ]);
    expect(pacingSummary(ticks)).toEqual({ sentences: 3, dialogue: 1 / 3, averageWords: 3, long: 0 });
    expect(tickAt(ticks, 0, 10)).toBe(0);
    expect(tickAt(ticks, 0.99, 10)).toBe(2);
  });
});
