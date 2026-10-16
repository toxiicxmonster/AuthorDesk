import { describe, expect, it } from 'vitest';
import { learnPronouns, mentions, resolvePronoun } from '../src/proofreading/speakers';
import { analyzeDialogue } from '../src/proofreading/dialogue';

const chars = [
  { id: 'j', name: 'Jace Kensington', aliases: [] },
  { id: 'w', name: 'Winnie Hartley', aliases: [] },
];

describe('who "he" and "she" are', () => {
  const paras = [
    'Jace sat on my bed with a controller in his hand.',
    '“Can you not right now?” Jace snapped, while his eyes stayed glued to the television.',
    'Jace didn’t agree with her keeping it.',
    'Winnie pushed her hair back and she sighed.',
    '- Jace texts her, she ignores it',
    '“Apparently you can’t sit still,” he said.',
  ];

  it('learns pronouns from the text after a name, not from outline notes', () => {
    const p = learnPronouns(paras, chars);
    expect(p.get('j')).toBe('he');
    expect(p.get('w')).toBe('she');
  });

  it('gives a "he" line to the last man mentioned, ignoring names inside dialogue', () => {
    const ms = mentions(paras, chars);
    expect(resolvePronoun('he', 5, 0, ms, learnPronouns(paras, chars))).toBe('j');
    expect(resolvePronoun('she', 5, 0, ms, learnPronouns(paras, chars))).toBe('w');
    expect(resolvePronoun('they', 5, 0, ms, learnPronouns(paras, chars))).toBeNull();
    expect(mentions(['“Winnie, come here,” she said.'], chars)).toEqual([]);
  });

  it('dialogue: a paragraph is one speaker, beats after a quote count, and an open quote is not a name', () => {
    const r = analyzeDialogue(
      [
        '“Can you not?” Jace snapped. “I am trying to hear my game.”',
        '“Apparently you can’t sit still.” He tightened his grip. “I want some quiet.”',
        '“I’m so sorry, Winnie. Your grandmother came by ambulance last night.',
      ],
      ['Jace Kensington', 'Winnie Hartley'],
    );
    expect(r.lines.map((l) => l.speaker)).toEqual(['Jace Kensington', 'Jace Kensington', 'he', 'he', null]);
  });
});
