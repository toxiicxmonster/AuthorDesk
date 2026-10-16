import { describe, expect, it } from 'vitest';
import { quoted, readRelations, supportedRole } from '../src/ai/relationships';

const ch = (id: string, name: string, links: { targetId: string; label: string }[] = []) => ({ id, name, aliases: [], summary: '', fields: {}, notes: '', links, type: 'character' as const, archivedAt: null });
const chars = [ch('w', 'Winnie Hartley'), ch('j', 'Jace Kensington'), ch('b', 'Betty Hartley'), ch('f', 'Finn Callahan')];
const source = 'Winnie and Jace relationship: Fake perfect couple. Winnie finds out Grandma died. Finn find her in a hallway and makes a remark.';
const answer = (rels: object[]) => JSON.stringify({ relations: rels });

describe('suggested relationships', () => {
  it('keeps only what the quote supports, fixing family words from it', () => {
    const r = readRelations(
      answer([
        { person: 'Jace Kensington', role: 'boyfriend', of: 'Winnie Hartley', reverse: 'girlfriend', evidence: 'Winnie and Jace relationship: Fake perfect couple' },
        { person: 'Betty Hartley', role: 'mother', of: 'Winnie Hartley', reverse: 'daughter', evidence: 'Winnie finds out Grandma died' },
        { person: 'Finn Callahan', role: 'friend', of: 'Winnie Hartley', reverse: 'friend', evidence: 'Finn find her in a hallway and makes a remark' },
        { person: 'Finn Callahan', role: 'protector', of: 'Winnie Hartley', reverse: 'ward', evidence: 'Finn find her in a hallway' },
        { person: 'Jace', role: 'rival', of: 'Finn', reverse: 'rival', evidence: 'Jace is Finn’s rival on the field' },
      ]),
      chars,
      source,
    );
    expect(r.map((x) => `${x.bName} is ${x.aName}'s ${x.bToA} / ${x.aToB}`)).toEqual([
      "Jace Kensington is Winnie Hartley's boyfriend / girlfriend",
      "Betty Hartley is Winnie Hartley's grandmother / grandchild",
    ]);
  });

  it('skips pairs that already have a relationship', () => {
    const linked = [ch('w', 'Winnie Hartley', [{ targetId: 'j', label: 'boyfriend' }]), ch('j', 'Jace Kensington')];
    expect(readRelations(answer([{ person: 'Jace Kensington', role: 'boyfriend', of: 'Winnie Hartley', reverse: 'girlfriend', evidence: 'Fake perfect couple' }]), linked, source)).toEqual([]);
  });

  it('checks quotes and roles', () => {
    expect(quoted('Winnie finds out Grandma died', source)).toBe(true);
    expect(quoted('Winnie loves her grandmother dearly', source)).toBe(false);
    expect(supportedRole('mother', 'Grandma died')).toBe('grandmother');
    expect(supportedRole('rival', 'They hate each other')).toBe('rival');
    expect(supportedRole('friend', 'they met in a hallway')).toBeNull();
  });
});
