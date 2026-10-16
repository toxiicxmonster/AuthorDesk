import { useMemo, useState } from 'react';
import { versionDiff, type DiffBlock } from '../../domain/versionDiff';

/** Runs of unchanged paragraphs longer than this are folded away (click to show them). */
const FOLD = 2;

/**
 * Versions → a snapshot → "What changed since": the snapshot compared with the scene as it is now, removed words
 * struck through and added words highlighted, unchanged stretches folded.
 */
export function VersionChanges({ before, after }: { before: string; after: string }) {
  const diff = useMemo(() => versionDiff(before, after), [before, after]);
  const [open, setOpen] = useState<Set<number>>(new Set());
  if (!diff.added && !diff.removed) return <p className="muted">No changes: the scene reads exactly as it did then.</p>;

  // Group consecutive unchanged paragraphs so long stretches can fold.
  const groups: { start: number; blocks: DiffBlock[]; same: boolean }[] = [];
  diff.blocks.forEach((b, i) => {
    const same = b.kind === 'same';
    const last = groups[groups.length - 1];
    if (last && last.same && same) last.blocks.push(b);
    else groups.push({ start: i, blocks: [b], same });
  });

  return (
    <div className="version-changes">
      <p className="small">
        Since this version: <ins>+{diff.added.toLocaleString()} words</ins> · <del>−{diff.removed.toLocaleString()} words</del>
      </p>
      <div className="snap-preview diff-view">
        {groups.map((g) =>
          g.same && g.blocks.length > FOLD && !open.has(g.start) ? (
            <button key={g.start} className="link-btn fold" onClick={() => setOpen((o) => new Set(o).add(g.start))}>
              … {g.blocks.length} unchanged paragraphs …
            </button>
          ) : (
            g.blocks.map((b, k) => <Block key={`${g.start}-${k}`} b={b} />)
          ),
        )}
      </div>
    </div>
  );
}

function Block({ b }: { b: DiffBlock }) {
  if (b.kind === 'same') return <p>{b.text}</p>;
  if (b.kind === 'added')
    return (
      <p>
        <ins>{b.text}</ins>
      </p>
    );
  if (b.kind === 'removed')
    return (
      <p>
        <del>{b.text}</del>
      </p>
    );
  return (
    <p>
      {b.pieces.map((p, i) => (p.kind === 'same' ? <span key={i}>{p.text}</span> : p.kind === 'add' ? <ins key={i}>{p.text}</ins> : <del key={i}>{p.text}</del>))}
    </p>
  );
}
