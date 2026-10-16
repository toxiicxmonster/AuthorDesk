import { describe, expect, it } from 'vitest';
import { inlinePoints, looksWritten, planItems, setPlanItem, splitPlanItem, withoutTicks } from '../src/domain/planChecklist';

const NOTES =
  'Plan (moved from the text):\n- Winnie hauls boxes heavier than her\n- [x] She drops some\n• Finn stops, grumpy after practice\nNot a bullet';

describe('scene plan checklist', () => {
  it('reads the bullet lines, ticked or not', () => {
    expect(planItems(NOTES)).toEqual([
      { line: 1, text: 'Winnie hauls boxes heavier than her', done: false },
      { line: 2, text: 'She drops some', done: true },
      { line: 3, text: 'Finn stops, grumpy after practice', done: false },
    ]);
    expect(planItems('Just a note.\n\n-not a bullet')).toEqual([]);
  });

  it('ticks and unticks a line, leaving the rest of the notes as they were', () => {
    const ticked = setPlanItem(NOTES, 1, true);
    expect(ticked.split('\n')[1]).toBe('- [x] Winnie hauls boxes heavier than her');
    expect(setPlanItem(ticked, 1, false)).toBe(NOTES);
    expect(setPlanItem(NOTES, 2, false).split('\n')[2]).toBe('- She drops some');
    expect(setPlanItem(NOTES, 4, true)).toBe(NOTES); // not a plan line
  });

  it('hints that a point looks written when most of its words are in the scene', () => {
    const text = 'Winnie hauled the last of the boxes up the stairs, each one heavier than the one before.';
    expect(looksWritten('Winnie hauls boxes heavier than her', text)).toBe(true);
    expect(looksWritten('Finn stops, grumpy after practice', text)).toBe(false);
    expect(looksWritten('She drops some', text)).toBe(false); // too few distinctive words to tell
  });

  it('doesn’t expect a first-person scene to name its narrator', () => {
    const text = 'I grabbed my keys and drove the Jeep to the hospital, my hands shaking on the wheel.';
    expect(looksWritten('Winnie drives her Jeep to the hospital', text)).toBe(false);
    expect(looksWritten('Winnie drives her Jeep to the hospital', text, ['Winnie Hartley'])).toBe(true);
    // Other missing names still count against the point.
    expect(looksWritten('Lawyer tells Winnie the Bookshop is in her name', 'He told me my name.', ['Winnie Hartley'])).toBe(false);
  });

  it('doesn’t count plan lines left in the text as written', () => {
    expect(looksWritten('Finn catches a glimpse of her at the game', 'It was game day.\n\n- Finn catches a glimpse of her at the game')).toBe(false);
  });

  it('splits points typed on one line into a line each', () => {
    const notes = 'Intro\n\n- Winnie wearing Jace number - Finn catches a glimpse of her - He was surprised, but goes back to the game';
    expect(inlinePoints(planItems(notes)[0].text)).toHaveLength(3);
    expect(splitPlanItem(notes, 2)).toBe('Intro\n\n- Winnie wearing Jace number\n- Finn catches a glimpse of her\n- He was surprised, but goes back to the game');
    // A dash inside a point that isn't followed by a new sentence stays.
    expect(inlinePoints('Finn helps - reluctantly - with the boxes')).toEqual(['Finn helps - reluctantly - with the boxes']);
    expect(splitPlanItem(notes, 0)).toBe(notes);
  });

  it('leaves the tick marks out of what the AI reads', () => {
    expect(withoutTicks('- [x] Funeral happens\n- Lawyer calls\n  • [ ] Jace objects')).toBe('- Funeral happens\n- Lawyer calls\n  • Jace objects');
  });
});
