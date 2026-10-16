import { describe, expect, it } from 'vitest';
import { looksWritten, planItems, setPlanItem } from '../src/domain/planChecklist';

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
});
