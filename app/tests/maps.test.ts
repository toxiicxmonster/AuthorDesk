import { familyTree, kinOf } from '../src/domain/familyTree';
import { forceLayout } from '../src/domain/graphLayout';

const ref = (id: string, name: string, links: [string, string][] = []) => ({ id, name, archivedAt: null, links: links.map(([targetId, label]) => ({ targetId, label })) });

describe('family tree', () => {
  it('reads family words in relationship labels', () => {
    expect(kinOf('granddaughter')).toBe('grandchild');
    expect(kinOf('her grandmother')).toBe('grandparent');
    expect(kinOf('Mother')).toBe('parent');
    expect(kinOf('older sister')).toBe('sibling');
    expect(kinOf('wife')).toBe('spouse');
    expect(kinOf('rival')).toBeNull();
    expect(kinOf('')).toBeNull();
  });

  it('puts each generation on its own row, oldest first, with spouses side by side', () => {
    const t = familyTree([
      ref('w', 'Winnie Hartley', [['b', 'granddaughter']]),
      ref('b', 'Betty Hartley', [['w', '']]),
      ref('j', 'Jace Kensington', [['w', 'husband']]),
      ref('m', 'Mary Hartley', [['w', 'mother'], ['b', 'daughter']]),
      ref('f', 'Finn Callahan', [['j', 'rival']]),
    ]);
    expect(t.rows).toEqual([['b'], ['m'], ['w', 'j']]);
    expect(t.edges.map((e) => `${e.from}>${e.to}:${e.kin}`).sort()).toEqual(['j>w:spouse', 'm>b:child', 'm>w:parent', 'w>b:grandchild']);
    expect(t.generation.has('f')).toBe(false); // a rival isn't family
  });
});

describe('relationship map layout', () => {
  it('keeps everyone inside the box, apart from each other, and connected entries closer', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const pos = forceLayout(ids, [['a', 'b']], { width: 600, height: 400 });
    for (const p of pos.values()) {
      expect(p.x).toBeGreaterThanOrEqual(40);
      expect(p.x).toBeLessThanOrEqual(560);
      expect(p.y).toBeGreaterThanOrEqual(30);
      expect(p.y).toBeLessThanOrEqual(370);
    }
    const d = (x: string, y: string) => Math.hypot(pos.get(x)!.x - pos.get(y)!.x, pos.get(x)!.y - pos.get(y)!.y);
    expect(d('a', 'b')).toBeLessThan(d('c', 'd'));
    expect(Math.min(d('c', 'd'), d('c', 'e'), d('d', 'e'))).toBeGreaterThan(30);
  });

  it('leaves dragged entries where the author put them', () => {
    const pos = forceLayout(['a', 'b', 'c'], [['a', 'b']], { fixed: new Map([['a', { x: 100, y: 100 }]]) });
    expect(pos.get('a')).toEqual({ x: 100, y: 100 });
  });
});
