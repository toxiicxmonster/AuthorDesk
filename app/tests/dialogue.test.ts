import { analyzeDialogue } from '../src/proofreading/dialogue';

const names = ['Winnie Hartley', 'Tom Reyes'];

describe('dialogue assistant', () => {
  it('works out who speaks from tags, leading tags and action beats', () => {
    const r = analyzeDialogue(
      [
        '“Where were you?” Winnie asked.',
        '“Out,” said Tom.',
        'Tom said, “Leave it.”',
        'Winnie folded her arms. “No.”',
        '“Fine,” she whispered.',
      ],
      names,
    );
    expect(r.lines.map((l) => [l.speaker, l.tag])).toEqual([
      ['Winnie Hartley', 'asked'],
      ['Tom Reyes', 'said'],
      ['Tom Reyes', 'said'],
      ['Winnie Hartley', null],
      ['she', 'whispered'],
    ]);
    expect(r.speakers[0]).toEqual(['Winnie Hartley', 2]);
    expect(r.issues).toEqual([]);
  });

  it('flags long runs with no speaker named', () => {
    const r = analyzeDialogue(['“One.”', '“Two.”', '“Three.”', '“Four.”', '“Five,” Tom said.'], names);
    expect(r.issues.map((i) => i.kind)).toEqual(['unattributed-run']);
    expect(r.issues[0].message).toMatch(/4 lines in a row/);
  });

  it('flags two speakers sharing a paragraph', () => {
    const r = analyzeDialogue(['“Hi,” Tom said. “Hello,” Winnie replied.'], names);
    expect(r.issues.map((i) => i.kind)).toEqual(['two-speakers']);
    expect(r.issues[0].message).toMatch(/Tom Reyes and Winnie Hartley/);
  });

  it('knows a speech continued into the next paragraph is not unclosed', () => {
    expect(analyzeDialogue(['“It began long ago.', '“And it never ended,” Tom said.'], names).issues).toEqual([]);
    expect(analyzeDialogue(['“It began long ago.', 'The fire crackled.'], names).issues.map((i) => i.kind)).toEqual(['unclosed']);
  });

  it('handles straight quotes and measures how much is dialogue', () => {
    const r = analyzeDialogue(['"Go home," he said.', 'The night was quiet and cold and long.'], names);
    expect(r.lines[0]).toMatchObject({ speaker: 'he', tag: 'said', text: '"Go home,"' });
    expect(r.share).toBeGreaterThan(0.1);
    expect(r.share).toBeLessThan(0.3);
  });

  it('notes when showy speech tags crowd out “said”', () => {
    const tags = ['exclaimed', 'retorted', 'hissed', 'snarled', 'growled'].map((t, i) => `“Line ${i},” Tom ${t === 'exclaimed' ? 'snapped' : t}.`);
    expect(analyzeDialogue(tags, names).tagNote).toMatch(/Only 0 of 5/);
    expect(analyzeDialogue(['“A,” Tom said.', '“B,” Tom said.', '“C,” Tom said.', '“D,” Tom said.', '“E,” Tom hissed.'], names).tagNote).toBeNull();
  });

  it('does not take ordinary words for speakers', () => {
    const r = analyzeDialogue(['The door slammed. “Who’s there?”', 'and said, “nothing”'], names);
    expect(r.lines.map((l) => l.speaker)).toEqual([null, null]);
  });
});
