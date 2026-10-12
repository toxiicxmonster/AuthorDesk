/**
 * Three-way merge rules for sync. Pure functions so they can be tested exhaustively.
 *
 * - `base` is the last version both sides agreed on (null if never synced).
 * - Independent field edits merge automatically.
 * - The same field edited on both sides is a conflict. For prose (scene content) both versions are
 *   always preserved; nothing is ever silently overwritten.
 */

export type Rec = Record<string, unknown>;

export type MergeOutcome =
  | { kind: 'keep-local' }
  | { kind: 'take-remote' }
  | { kind: 'merged'; result: Rec }
  | { kind: 'conflict'; result: Rec; conflictingFields: string[] };

/** Fields managed by the system that never count as user edits. */
const META = new Set(['rev', 'updatedAt', 'createdAt', 'serverVersion']);

/** Derived from `content`; merged with it. */
const DERIVED = new Set(['plainText', 'wordCount', 'referenceIds']);

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function threeWayMerge(base: Rec | null, local: Rec, remote: Rec): MergeOutcome {
  if (same(stripMeta(local), stripMeta(remote))) return { kind: 'take-remote' };
  if (base) {
    const localChanged = !same(stripMeta(base), stripMeta(local));
    const remoteChanged = !same(stripMeta(base), stripMeta(remote));
    if (!localChanged) return { kind: 'take-remote' };
    if (!remoteChanged) return { kind: 'keep-local' };
  }
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)].filter((k) => !META.has(k) && !DERIVED.has(k)));
  const result: Rec = { ...remote };
  const conflicts: string[] = [];
  for (const k of keys) {
    const l = local[k];
    const r = remote[k];
    if (same(l, r)) continue;
    const b = base ? base[k] : undefined;
    const lChanged = !base || !same(b, l);
    const rChanged = !base || !same(b, r);
    if (lChanged && !rChanged) {
      result[k] = l;
      if (k === 'content') for (const d of DERIVED) if (d in local) result[d] = local[d];
    } else if (!lChanged && rChanged) {
      result[k] = r;
    } else {
      conflicts.push(k);
      // Default the merged record to the local value; the other side is preserved by the caller.
      result[k] = l;
      if (k === 'content') for (const d of DERIVED) if (d in local) result[d] = local[d];
    }
  }
  if (conflicts.length) return { kind: 'conflict', result, conflictingFields: conflicts };
  return { kind: 'merged', result };
}

function stripMeta(r: Rec): Rec {
  const o: Rec = {};
  for (const [k, v] of Object.entries(r)) if (!META.has(k)) o[k] = v;
  return o;
}

/**
 * Decide what to do when a record was deleted on one side and edited on the other.
 * Edits win over deletes so writing is never lost; the author can delete again.
 */
export function resolveDeleteEdit(localDeleted: boolean, remoteDeleted: boolean, localEditedSinceBase: boolean, remoteEditedSinceBase: boolean) {
  if (localDeleted && remoteDeleted) return 'delete' as const;
  if (localDeleted) return remoteEditedSinceBase ? ('restore-remote' as const) : ('delete' as const);
  if (remoteDeleted) return localEditedSinceBase ? ('keep-local' as const) : ('delete' as const);
  return 'merge' as const;
}
