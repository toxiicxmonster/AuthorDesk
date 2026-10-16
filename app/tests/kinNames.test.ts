import { describe, expect, it } from 'vitest';
import { kinNames } from '../src/domain/kinNames';
import type { ReferenceEntry } from '../src/domain/schema';

// A link's label says what the linked person is to the entry: on Winnie's entry, "Betty — grandmother".
const ref = (id: string, name: string, links: { targetId: string; label: string }[] = [], aliases: string[] = []) =>
  ({ id, name, aliases, links, archivedAt: null, type: 'character' }) as unknown as ReferenceEntry;

const winnieScenes = [
  { povId: 'w', text: 'My phone lit up beside me. Grammy\n\nMe: Hey, Grandma, sorry I didn’t catch your call.\n\nMy grandma’s name kept flickering. “Grandma?”' },
  { povId: 'f', text: 'Finn thought about his Grandma.' },
];

describe('family names for a character', () => {
  it('finds what the grandchild calls her in the scenes she tells', () => {
    const refs = [ref('b', 'Betty Hartley'), ref('w', 'Winnie Hartley', [{ targetId: 'b', label: 'grandmother' }])];
    expect(kinNames(refs[0], refs, winnieScenes)).toEqual([
      { name: 'Grandma', count: 2, relativeId: 'w' },
      { name: 'Grammy', count: 1, relativeId: 'w' },
    ]);
  });

  it('reads the relationship from either entry, and skips names already on the entry', () => {
    const refs = [ref('b', 'Betty Hartley', [{ targetId: 'w', label: 'granddaughter' }], ['Grandma']), ref('w', 'Winnie Hartley')];
    expect(kinNames(refs[0], refs, winnieScenes).map((k) => k.name)).toEqual(['Grammy']);
  });

  it('stays quiet when “Grandma” could mean either grandmother', () => {
    const winnie = ref('w', 'Winnie Hartley', [
      { targetId: 'b', label: 'grandmother' },
      { targetId: 'r', label: 'grandmother' },
      { targetId: 'g', label: 'grandfather' },
    ]);
    const refs = [ref('b', 'Betty Hartley'), ref('r', 'Rose Lane'), ref('g', 'George Lane'), winnie];
    expect(kinNames(refs[0], refs, winnieScenes)).toEqual([]);
    // A grandfather alongside is no clash for "Grandma".
    const two = [refs[0], refs[2], ref('w', 'Winnie Hartley', winnie.links.filter((l) => l.targetId !== 'r'))];
    expect(kinNames(two[0], two, winnieScenes).map((k) => k.name)).toEqual(['Grandma', 'Grammy']);
  });

  it('needs a family relationship and scenes told by that relative', () => {
    const refs = [ref('b', 'Betty Hartley'), ref('w', 'Winnie Hartley', [{ targetId: 'b', label: 'neighbour' }])];
    expect(kinNames(refs[0], refs, winnieScenes)).toEqual([]);
  });
});
