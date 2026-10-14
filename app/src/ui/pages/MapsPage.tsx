import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { MapPoint, MapRecord, ReferenceEntry } from '../../domain/schema';
import { REFERENCE_TYPE_ICONS } from '../../domain/referenceTemplates';
import { familyTree, type Kin } from '../../domain/familyTree';
import { forceLayout, type Point } from '../../domain/graphLayout';
import { countMentions } from '../../domain/references';
import { db } from '../../storage/db';
import { createRecord, deleteRecord, updateRecord } from '../../storage/repo';
import { useReferences } from '../data';
import { navigate } from '../router';
import { confirmDialog, reportError } from '../store';
import { downscale } from '../image';

type Tab = 'relationships' | 'family' | 'places';

/** Maps: the relationship web, family trees, and pictures of places with pins. Drawn from the World entries. */
export function MapsPage({ projectId, selectedId }: { projectId: string; selectedId: string | null }) {
  const [tab, setTab] = useState<Tab>(selectedId ? 'places' : 'relationships');
  const refs = useReferences(projectId);
  const live = useMemo(() => refs.filter((r) => !r.archivedAt), [refs]);
  const maps = useLiveQuery(() => db.maps.where('projectId').equals(projectId).toArray(), [projectId]);
  return (
    <div className="page maps-page">
      <div className="row gap wrap">
        <h1 className="grow">Maps</h1>
        <div className="tabs" role="tablist">
          {(
            [
              ['relationships', 'Relationships'],
              ['family', 'Family tree'],
              ['places', 'Places'],
            ] as [Tab, string][]
          ).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {tab === 'relationships' && <RelationshipMap projectId={projectId} refs={live} saved={maps?.find((m) => m.kind === 'relationships') ?? null} />}
      {tab === 'family' && <FamilyTreeView projectId={projectId} refs={live} />}
      {tab === 'places' && <PlaceMaps projectId={projectId} refs={live} maps={maps ?? []} selectedId={selectedId} />}
    </div>
  );
}

const W = 900;
const H = 600;

/** Converts a pointer position to the SVG's own coordinates. */
function svgPoint(svg: SVGSVGElement, e: { clientX: number; clientY: number }): Point {
  const m = svg.getScreenCTM();
  if (!m) return { x: 0, y: 0 };
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
  return { x: p.x, y: p.y };
}

function RelationshipMap({ projectId, refs, saved }: { projectId: string; refs: ReferenceEntry[]; saved: MapRecord | null }) {
  const [charactersOnly, setCharactersOnly] = useState(true);
  const shown = refs.filter((r) => !charactersOnly || r.type === 'character');
  const ids = new Set(shown.map((r) => r.id));
  // One line per pair, with both directions' labels.
  const edges = useMemo(() => {
    const byPair = new Map<string, { a: string; b: string; labels: string[] }>();
    for (const r of shown) {
      for (const l of r.links) {
        if (!ids.has(l.targetId) || l.targetId === r.id) continue;
        const [a, b] = [r.id, l.targetId].sort();
        const e = byPair.get(`${a}|${b}`) ?? { a, b, labels: [] };
        if (l.label.trim() && !e.labels.includes(l.label.trim())) e.labels.push(l.label.trim());
        byPair.set(`${a}|${b}`, e);
      }
    }
    return [...byPair.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refs, charactersOnly]);
  const nodes = shown.filter((r) => edges.some((e) => e.a === r.id || e.b === r.id));
  const savedPos = useMemo(() => new Map((saved?.points ?? []).map((p) => [p.referenceId, { x: p.x, y: p.y }])), [saved]);
  const layout = useMemo(
    () =>
      forceLayout(
        nodes.map((n) => n.id),
        edges.map((e) => [e.a, e.b]),
        { width: W, height: H, fixed: savedPos },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodes.map((n) => n.id).join(','), edges.length, savedPos],
  );
  const [drag, setDrag] = useState<{ id: string; at: Point; moved: boolean } | null>(null);
  const [overrides, setOverrides] = useState<Map<string, Point>>(new Map());
  const svgRef = useRef<SVGSVGElement>(null);
  const pos = (id: string) => overrides.get(id) ?? layout.get(id) ?? { x: W / 2, y: H / 2 };

  const save = async (next: Map<string, Point>) => {
    const points: MapPoint[] = nodes.map((n) => ({ referenceId: n.id, ...(next.get(n.id) ?? pos(n.id)) }));
    try {
      if (saved) await updateRecord('maps', saved.id, { points });
      else await createRecord('maps', projectId, { kind: 'relationships', referenceId: null, title: 'Relationships', image: '', points });
    } catch (e) {
      reportError(e, 'Could not save the map');
    }
  };

  if (!nodes.length) {
    return (
      <section className="card">
        <p className="muted">No relationships yet.</p>
        <p className="small muted">
          Open a character in{' '}
          <button className="link-btn" onClick={() => navigate(projectId, 'refs')}>
            World
          </button>{' '}
          and use <em>+ Add connection</em> (“sister”, “rival”, “mentor”). They appear here as a map you can arrange.
        </p>
      </section>
    );
  }
  return (
    <section className="card map-card">
      <div className="row gap wrap small">
        <label>
          <input type="checkbox" checked={charactersOnly} onChange={(e) => setCharactersOnly(e.target.checked)} /> Characters only
        </label>
        <span className="muted grow">Drag to arrange (saved). Click a name to open the entry.</span>
        {saved && (
          <button
            className="small"
            onClick={() => {
              setOverrides(new Map());
              void deleteRecord('maps', saved.id);
            }}
          >
            Tidy up
          </button>
        )}
      </div>
      <svg
        ref={svgRef}
        className="rel-map"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Relationship map"
        onPointerMove={(e) => {
          if (!drag || !svgRef.current) return;
          const p = svgPoint(svgRef.current, e);
          const moved = drag.moved || Math.hypot(p.x - drag.at.x, p.y - drag.at.y) > 4;
          if (moved) setOverrides((o) => new Map(o).set(drag.id, { x: Math.min(W - 40, Math.max(40, p.x)), y: Math.min(H - 20, Math.max(20, p.y)) }));
          if (moved !== drag.moved) setDrag({ ...drag, moved });
        }}
        onPointerUp={() => {
          if (!drag) return;
          if (drag.moved) void save(overrides);
          else navigate(projectId, 'refs', drag.id);
          setDrag(null);
        }}
        onPointerLeave={() => drag?.moved && void save(overrides).then(() => setDrag(null))}
      >
        {edges.map((e) => {
          const a = pos(e.a);
          const b = pos(e.b);
          return (
            <g key={`${e.a}|${e.b}`} className="rel-edge">
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
              {e.labels.length > 0 && (
                <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4} textAnchor="middle">
                  {e.labels.join(' / ')}
                </text>
              )}
            </g>
          );
        })}
        {nodes.map((n) => {
          const p = pos(n.id);
          const label = `${REFERENCE_TYPE_ICONS[n.type]} ${n.name}`;
          const w = Math.max(70, label.length * 7.4 + 16);
          return (
            <g
              key={n.id}
              className="rel-node"
              transform={`translate(${p.x},${p.y})`}
              onPointerDown={(e) => {
                (e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId);
                setDrag({ id: n.id, at: svgPoint(svgRef.current!, e), moved: false });
              }}
              tabIndex={0}
              role="button"
              aria-label={`${n.name}: open entry`}
              onKeyDown={(e) => e.key === 'Enter' && navigate(projectId, 'refs', n.id)}
            >
              <rect x={-w / 2} y={-15} width={w} height={30} rx={15} />
              <text textAnchor="middle" y={5}>
                {label}
              </text>
            </g>
          );
        })}
      </svg>
    </section>
  );
}

const KIN_CLASS: Record<Kin, string> = {
  parent: 'kin-line',
  child: 'kin-line',
  grandparent: 'kin-far',
  grandchild: 'kin-far',
  sibling: 'kin-side',
  spouse: 'kin-spouse',
  auntuncle: 'kin-far',
  niblings: 'kin-far',
  cousin: 'kin-far',
};

function FamilyTreeView({ projectId, refs }: { projectId: string; refs: ReferenceEntry[] }) {
  const people = refs.filter((r) => r.type === 'character');
  const tree = useMemo(() => familyTree(people), [people]);
  const byId = new Map(people.map((p) => [p.id, p]));
  if (!tree.edges.length) {
    return (
      <section className="card">
        <p className="muted">No family yet.</p>
        <p className="small muted">
          Give characters family connections in{' '}
          <button className="link-btn" onClick={() => navigate(projectId, 'refs')}>
            World
          </button>
          : open a character, <em>+ Add connection</em>, and say what they are to the other person (“mother”, “son”, “sister”, “wife”, “grandmother”).
        </p>
      </section>
    );
  }
  const colW = 180;
  const rowH = 110;
  const widest = Math.max(...tree.rows.map((r) => r.length));
  const width = Math.max(600, widest * colW + 40);
  const height = tree.rows.length * rowH + 40;
  const at = new Map<string, Point>();
  tree.rows.forEach((row, g) => row.forEach((id, i) => at.set(id, { x: width / 2 + (i - (row.length - 1) / 2) * colW, y: 50 + g * rowH })));
  return (
    <section className="card map-card">
      <p className="small muted">
        From the family words in each character’s relationships. Solid: parent and child · double: married · dotted: siblings · dashed: grandparents, aunts, uncles and cousins.
      </p>
      <div className="table-scroll">
        <svg className="family-tree" viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label="Family tree">
          {tree.edges.map((e) => {
            const a = at.get(e.from)!;
            const b = at.get(e.to)!;
            const cls = KIN_CLASS[e.kin];
            if (cls === 'kin-spouse')
              return (
                <g key={`${e.from}|${e.to}`} className="kin-spouse">
                  <line x1={a.x} y1={a.y - 3} x2={b.x} y2={b.y - 3} />
                  <line x1={a.x} y1={a.y + 3} x2={b.x} y2={b.y + 3} />
                </g>
              );
            return <line key={`${e.from}|${e.to}`} className={cls} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
          })}
          {[...at].map(([id, p]) => {
            const r = byId.get(id)!;
            return (
              <g key={id} className="rel-node" transform={`translate(${p.x},${p.y})`} role="button" tabIndex={0} onClick={() => navigate(projectId, 'refs', id)} onKeyDown={(e) => e.key === 'Enter' && navigate(projectId, 'refs', id)}>
                <rect x={-colW / 2 + 12} y={-18} width={colW - 24} height={36} rx={8} />
                <text textAnchor="middle" y={5}>
                  {r.name.length > 22 ? r.name.slice(0, 21) + '…' : r.name}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}

function PlaceMaps({ projectId, refs, maps, selectedId }: { projectId: string; refs: ReferenceEntry[]; maps: MapRecord[]; selectedId: string | null }) {
  const places = refs.filter((r) => r.type === 'location').sort((a, b) => a.name.localeCompare(b.name));
  const [placeId, setPlaceId] = useState<string | null>(() => maps.find((m) => m.id === selectedId)?.referenceId ?? null);
  const place = places.find((p) => p.id === placeId) ?? places.find((p) => maps.some((m) => m.kind === 'location' && m.referenceId === p.id)) ?? places[0] ?? null;
  const map = maps.find((m) => m.kind === 'location' && m.referenceId === place?.id) ?? null;
  const [pinning, setPinning] = useState<string>('');
  const [open, setOpen] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => setOpen(null), [place?.id]);

  if (!places.length) {
    return (
      <section className="card">
        <p className="muted">No places yet.</p>
        <p className="small muted">
          Add places in{' '}
          <button className="link-btn" onClick={() => navigate(projectId, 'refs', null, { new: 'location' })}>
            World
          </button>
          . Then give one a picture (a hand-drawn town, a floor plan) and pin the other places on it.
        </p>
      </section>
    );
  }
  const upload = async (file: File | undefined) => {
    if (!file || !place) return;
    try {
      const image = await downscale(file, 1600);
      if (map) await updateRecord('maps', map.id, { image });
      else await createRecord('maps', projectId, { kind: 'location', referenceId: place.id, title: place.name, image, points: [] });
    } catch (e) {
      reportError(e, 'Could not use that picture');
    }
  };
  const placePin = async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!pinning || !map) return;
    const box = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - box.left) / box.width;
    const y = (e.clientY - box.top) / box.height;
    await updateRecord('maps', map.id, { points: [...map.points.filter((p) => p.referenceId !== pinning), { referenceId: pinning, x, y }] });
    setPinning('');
  };
  const pinnable = refs.filter((r) => r.id !== place?.id && (r.type === 'location' || r.type === 'character' || r.type === 'item'));
  const byId = new Map(refs.map((r) => [r.id, r]));
  const openRef = open ? byId.get(open) : null;

  return (
    <section className="card map-card">
      <div className="row gap wrap">
        <select value={place?.id ?? ''} onChange={(e) => setPlaceId(e.target.value)} aria-label="Place">
          {places.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {maps.some((m) => m.kind === 'location' && m.referenceId === p.id) ? ' (map)' : ''}
            </option>
          ))}
        </select>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void upload(e.target.files?.[0])} />
        <button onClick={() => fileRef.current?.click()}>{map ? 'Replace picture…' : `Add a picture of ${place?.name}…`}</button>
        {map && (
          <>
            <select value={pinning} onChange={(e) => setPinning(e.target.value)} aria-label="Pin an entry">
              <option value="">Pin a place or character…</option>
              {pinnable.map((r) => (
                <option key={r.id} value={r.id}>
                  {REFERENCE_TYPE_ICONS[r.type]} {r.name}
                </option>
              ))}
            </select>
            <button
              className="danger-text link-btn"
              onClick={async () => {
                if (await confirmDialog('Remove this map?', `The picture of ${place?.name} and its pins will be removed. The entries themselves stay.`, { confirmLabel: 'Remove', danger: true })) await deleteRecord('maps', map.id);
              }}
            >
              Remove map
            </button>
          </>
        )}
      </div>
      {pinning && <p className="small">Click on the picture where {byId.get(pinning)?.name} is.</p>}
      {map?.image ? (
        <div className="place-map-wrap">
          <div className={`place-map${pinning ? ' pinning' : ''}`} onClick={(e) => void placePin(e)}>
            <img src={map.image} alt={`Map of ${place?.name}`} draggable={false} />
            {map.points.map((p) => {
              const r = byId.get(p.referenceId);
              if (!r) return null;
              return (
                <button
                  key={p.referenceId}
                  className={`pin${open === r.id ? ' on' : ''}`}
                  style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(open === r.id ? null : r.id);
                  }}
                  title={r.name}
                >
                  <span>
                    {REFERENCE_TYPE_ICONS[r.type]} {r.name}
                  </span>
                </button>
              );
            })}
          </div>
          {openRef && map && <PinCard projectId={projectId} r={openRef} onRemove={() => void updateRecord('maps', map.id, { points: map.points.filter((p) => p.referenceId !== openRef.id) }).then(() => setOpen(null))} />}
        </div>
      ) : (
        <p className="muted small">No picture yet. Any image works: a sketch, a floor plan, a real map. It stays on this computer.</p>
      )}
    </section>
  );
}

/** A pinned entry: open it, or jump to the scenes set there (or that mention it). */
function PinCard({ projectId, r, onRemove }: { projectId: string; r: ReferenceEntry; onRemove: () => void }) {
  const scenes = useLiveQuery(async () => {
    const all = (await db.scenes.where('projectId').equals(projectId).toArray()).filter((s) => !s.archivedAt);
    const chapters = new Map((await db.chapters.where('projectId').equals(projectId).toArray()).map((c) => [c.id, c]));
    return all
      .filter((s) => s.locationId === r.id || s.povCharacterId === r.id || countMentions(s.plainText, r) > 0)
      .map((s) => ({ s, ch: chapters.get(s.chapterId) }))
      .sort((a, b) => (a.ch?.order ?? 0) - (b.ch?.order ?? 0) || a.s.order - b.s.order)
      .slice(0, 12);
  }, [projectId, r.id]);
  return (
    <div className="pin-card">
      <strong>
        {REFERENCE_TYPE_ICONS[r.type]} {r.name}
      </strong>
      {r.summary && <p className="small">{r.summary}</p>}
      <p className="small muted">{r.type === 'location' ? 'Scenes set here or mentioning it:' : 'Scenes with them:'}</p>
      {!scenes ? null : !scenes.length ? (
        <p className="small muted">None yet.</p>
      ) : (
        <ul className="small">
          {scenes.map(({ s, ch }) => (
            <li key={s.id}>
              <button className="link-btn" onClick={() => navigate(projectId, 'write', s.id, { find: r.name.split(/\s+/)[0] })}>
                {ch?.title ? `${ch.title}: ` : ''}
                {s.title || 'Scene'}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="row gap">
        <button className="small" onClick={() => navigate(projectId, 'refs', r.id)}>
          Open entry
        </button>
        <button className="small" onClick={onRemove}>
          Remove pin
        </button>
      </div>
    </div>
  );
}
