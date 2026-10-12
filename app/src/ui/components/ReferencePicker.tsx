import { useMemo, useState } from 'react';
import { Modal } from './common';
import { useReferences } from '../data';
import { REFERENCE_TYPES, type ReferenceEntry, type ReferenceType } from '../../domain/schema';
import { REFERENCE_TYPE_ICONS, REFERENCE_TYPE_LABELS } from '../../domain/referenceTemplates';
import { createReference, matchesReference } from '../../domain/references';

export function ReferencePicker({
  projectId,
  initialQuery = '',
  onPick,
  onClose,
  types,
  title = 'Link to reference',
}: {
  projectId: string;
  initialQuery?: string;
  onPick: (r: ReferenceEntry) => void;
  onClose: () => void;
  types?: ReferenceType[];
  title?: string;
}) {
  const refs = useReferences(projectId);
  const [q, setQ] = useState(initialQuery.trim());
  const [newType, setNewType] = useState<ReferenceType>(types?.[0] ?? 'character');
  const list = useMemo(
    () => refs.filter((r) => !r.archivedAt && (!types || types.includes(r.type)) && matchesReference(r, q)).slice(0, 50),
    [refs, q, types],
  );
  const exact = refs.some((r) => r.name.toLowerCase() === q.trim().toLowerCase());
  return (
    <Modal title={title} onClose={onClose}>
      <input
        className="wide-input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search characters, places, terms…"
        aria-label="Search references"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && list[0]) onPick(list[0]);
        }}
      />
      <ul className="pick-list" role="listbox">
        {list.map((r) => (
          <li key={r.id}>
            <button onClick={() => onPick(r)} role="option" aria-selected="false">
              <span aria-hidden>{REFERENCE_TYPE_ICONS[r.type]}</span> <strong>{r.name}</strong>
              {r.aliases.length > 0 && <span className="muted"> ({r.aliases.join(', ')})</span>}
              <span className="muted small"> · {REFERENCE_TYPE_LABELS[r.type]}</span>
            </button>
          </li>
        ))}
        {!list.length && <li className="muted pad">No matching entries.</li>}
      </ul>
      {q.trim() && !exact && (
        <div className="row gap">
          <select value={newType} onChange={(e) => setNewType(e.target.value as ReferenceType)} aria-label="New entry type">
            {(types ?? REFERENCE_TYPES).map((t) => (
              <option key={t} value={t}>
                {REFERENCE_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <button
            className="primary"
            onClick={async () => {
              const r = await createReference(projectId, newType, q.trim());
              onPick(r);
            }}
          >
            Create “{q.trim()}”
          </button>
        </div>
      )}
    </Modal>
  );
}
