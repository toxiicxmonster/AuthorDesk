import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useReferences } from '../data';
import { navigate } from '../router';
import { REFERENCE_TYPES, type ReferenceEntry, type ReferenceType } from '../../domain/schema';
import { REFERENCE_TEMPLATES, REFERENCE_TYPE_HINTS, REFERENCE_TYPE_ICONS, REFERENCE_TYPE_LABELS } from '../../domain/referenceTemplates';
import { createReference, likelyDuplicates, matchesReference } from '../../domain/references';
import { archiveRecord, deleteRecord, unarchiveRecord, updateRecord } from '../../storage/repo';
import { referenceBacklinks, unlinkReferenceEverywhere, type Backlink } from '../../storage/backlinks';
import { CommitInput, EmptyState, Modal, TagInput, excerpt } from '../components/common';
import { ReferencePicker } from '../components/ReferencePicker';
import { Icon } from '../components/Icon';
import { confirmDialog, promptDialog, setUi, toast } from '../store';
import { db } from '../../storage/db';
import { downscale } from '../image';
import { CharacterArc } from '../components/CharacterArc';
import { kinNames } from '../../domain/kinNames';

export function ReferencesPage({ projectId, selectedId, newType }: { projectId: string; selectedId: string | null; newType?: string | null }) {
  const refs = useReferences(projectId);
  const [q, setQ] = useState('');
  const [type, setType] = useState<ReferenceType | '' | 'fav' | 'trash'>('');
  const [tag, setTag] = useState('');
  const [creating, setCreating] = useState<ReferenceType | 'choose' | null>(null);
  const selected = refs.find((r) => r.id === selectedId) ?? null;
  const allTags = useMemo(() => [...new Set(refs.flatMap((r) => r.tags))].sort(), [refs]);
  const live = refs.filter((r) => !r.archivedAt);
  const list = refs.filter(
    (r) =>
      (type === 'trash' ? !!r.archivedAt : !r.archivedAt) &&
      (type === '' || type === 'trash' || (type === 'fav' ? r.favorite : r.type === type)) &&
      (!tag || r.tags.includes(tag)) &&
      (matchesReference(r, q) || (q.length > 2 && JSON.stringify(r.fields).toLowerCase().includes(q.toLowerCase()))),
  );

  // Arriving from the quick switcher with ?new=character
  useEffect(() => {
    if (newType && (REFERENCE_TYPES as readonly string[]).includes(newType)) setCreating(newType as ReferenceType);
  }, [newType]);

  const usedTypes = REFERENCE_TYPES.filter((t) => live.some((r) => r.type === t));
  const chips: { id: typeof type; label: string }[] = [
    { id: '', label: `All (${live.length})` },
    ...usedTypes.map((t) => ({ id: t as typeof type, label: `${REFERENCE_TYPE_ICONS[t]} ${REFERENCE_TYPE_LABELS[t].split(' /')[0]} (${live.filter((r) => r.type === t).length})` })),
    ...(live.some((r) => r.favorite) ? [{ id: 'fav' as const, label: '★ Favourites' }] : []),
    ...(refs.some((r) => r.archivedAt) ? [{ id: 'trash' as const, label: 'Trash' }] : []),
  ];

  return (
    <div className={`split-page${selected ? ' has-detail' : ''}`}>
      <aside className="list-pane" aria-label="Characters and world">
        <div className="list-tools">
          <button className="primary big-add" onClick={() => setCreating('choose')}>
            + New character, place or note…
          </button>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find by name or nickname…" aria-label="Search characters and world" />
          <div className="chip-row" role="tablist" aria-label="Show">
            {chips.map((c) => (
              <button key={c.id} role="tab" aria-selected={type === c.id} className={`chip-btn${type === c.id ? ' on' : ''}`} onClick={() => setType(c.id)}>
                {c.label}
              </button>
            ))}
          </div>
          {allTags.length > 0 && (
            <select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Filter by tag">
              <option value="">Any tag</option>
              {allTags.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          )}
        </div>
        <ul className="item-list">
          {list.map((r) => (
            <li key={r.id}>
              <a href={`#/p/${projectId}/refs/${r.id}`} className={r.id === selectedId ? 'on' : ''} aria-current={r.id === selectedId ? 'true' : undefined}>
                {r.image ? <img className="avatar" src={r.image} alt="" /> : <span className="avatar ph" aria-hidden>{REFERENCE_TYPE_ICONS[r.type]}</span>}
                <span className="grow">
                  {r.favorite && '★ '}
                  {r.name}
                  <span className="muted small block">{r.summary ? excerpt(r.summary, 70) : REFERENCE_TYPE_LABELS[r.type]}</span>
                </span>
              </a>
            </li>
          ))}
          {!list.length && (
            <li className="muted pad">
              {live.length ? 'Nothing matches.' : 'No one here yet. Add your main character to get started.'}
            </li>
          )}
        </ul>
      </aside>
      <section className="detail-pane">
        {selected ? (
          <>
            <button className="link back-link" onClick={() => navigate(projectId, 'refs')}>
              ← All characters & world
            </button>
            <ReferenceEditor key={selected.id} r={selected} all={refs} />
          </>
        ) : (
          <EmptyState title="Characters & world">
            <p>Keep notes on the people, places and things in your story — only as much as is useful to you.</p>
            <p>While writing, select a name and choose “Link” to connect it. Click linked words to peek at the notes without leaving your page.</p>
            {refs.some((r) => !r.archivedAt) ? (
              <p className="muted">Choose an entry on the left to open it.</p>
            ) : (
              <button className="primary" onClick={() => setCreating('choose')}>
                + Add your first entry
              </button>
            )}
          </EmptyState>
        )}
      </section>
      {creating && (
        <NewEntryDialog
          initialType={creating === 'choose' ? null : creating}
          initialName={q.trim()}
          all={refs}
          onClose={() => setCreating(null)}
          onCreate={async (t, name) => {
            const r = await createReference(projectId, t, name);
            setCreating(null);
            navigate(projectId, 'refs', r.id);
          }}
        />
      )}
    </div>
  );
}

function NewEntryDialog({
  initialType,
  initialName,
  all,
  onClose,
  onCreate,
}: {
  initialType: ReferenceType | null;
  initialName: string;
  all: ReferenceEntry[];
  onClose: () => void;
  onCreate: (t: ReferenceType, name: string) => void;
}) {
  const [type, setType] = useState<ReferenceType | null>(initialType);
  const [name, setName] = useState(initialName);
  const dupes = name.trim() ? likelyDuplicates({ id: '', name: name.trim(), aliases: [] }, all) : [];
  return (
    <Modal title={type ? `New ${REFERENCE_TYPE_LABELS[type].toLowerCase()}` : 'What would you like to add?'} onClose={onClose}>
      {!type ? (
        <div className="type-grid">
          {REFERENCE_TYPES.map((t) => (
            <button key={t} className="type-card" onClick={() => setType(t)}>
              <span className="type-icon" aria-hidden>
                {REFERENCE_TYPE_ICONS[t]}
              </span>
              <strong>{REFERENCE_TYPE_LABELS[t]}</strong>
              <span className="muted small">{REFERENCE_TYPE_HINTS[t]}</span>
            </button>
          ))}
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) onCreate(type, name.trim());
          }}
        >
          <label className="field">
            <span>Name</span>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={type === 'character' ? 'e.g. Elara Voss' : 'Name'} />
          </label>
          {dupes.length > 0 && (
            <p className="warn-text small">
              You already have {dupes.map((d) => `“${d.name}”`).join(', ')}. That’s fine if this is someone or something different.
            </p>
          )}
          <div className="dialog-actions">
            {!initialType && (
              <button type="button" onClick={() => setType(null)}>
                ← Back
              </button>
            )}
            <button type="submit" className="primary" disabled={!name.trim()}>
              Create
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function ReferenceEditor({ r, all }: { r: ReferenceEntry; all: ReferenceEntry[] }) {
  const upd = (patch: Partial<ReferenceEntry>) => void updateRecord('references', r.id, patch);
  const [backlinks, setBacklinks] = useState<Backlink[] | null>(null);
  const [linkPicker, setLinkPicker] = useState(false);
  const dupes = likelyDuplicates(r, all);
  const template = REFERENCE_TEMPLATES[r.type];
  const customKeys = Object.keys(r.fields).filter((k) => !template.some((f) => f.key === k));
  // New entries start with a few prompts; otherwise only fields in use (or just added) are shown.
  const [shown, setShown] = useState<Set<string>>(() =>
    template.some((f) => r.fields[f.key]?.trim()) ? new Set() : new Set(template.slice(0, 3).map((f) => f.key)),
  );
  const visible = template.filter((f) => r.fields[f.key]?.trim() || shown.has(f.key));
  const hidden = template.filter((f) => !visible.includes(f));

  useEffect(() => {
    let live = true;
    void referenceBacklinks(r).then((b) => live && setBacklinks(b));
    return () => {
      live = false;
    };
  }, [r]);

  const remove = async () => {
    const links = (backlinks ?? []).filter((b) => b.how !== 'mentioned').length;
    const choice = await confirmDialog(
      `Remove “${r.name}”?`,
      links
        ? `${links} place${links === 1 ? '' : 's'} in your book link to this. Moving it to Trash keeps those links safe and you can restore it. Deleting forever removes the links (your writing itself is not changed).`
        : 'Moving it to Trash lets you restore it later. Deleting forever cannot be undone.',
      { confirmLabel: 'Move to Trash', choices: [{ label: 'Delete forever', value: 'delete' }] },
    );
    if (!choice) return;
    if (choice === 'delete') {
      const sure = await confirmDialog('Delete permanently?', `“${r.name}” and its links will be removed. This cannot be undone.`, { confirmLabel: 'Delete', danger: true });
      if (!sure) return;
      await unlinkReferenceEverywhere(r.id, r.projectId);
      await deleteRecord('references', r.id);
      navigate(r.projectId, 'refs');
      toast(`Deleted “${r.name}”`);
    } else {
      await archiveRecord('references', r.id);
      toast(`Moved “${r.name}” to Trash`, { action: { label: 'Undo', run: () => void unarchiveRecord('references', r.id) } });
    }
  };

  const setImage = async (file: File) => {
    if (!file.type.startsWith('image/')) return toast('Choose an image file', { kind: 'error' });
    if (file.size > 15_000_000) return toast('That image is too large (max 15 MB)', { kind: 'error' });
    const url = await downscale(file, 512);
    upd({ image: url });
  };

  return (
    <article className="ref-editor">
      <header className="detail-head">
        <span className="type-pill">
          {REFERENCE_TYPE_ICONS[r.type]} {REFERENCE_TYPE_LABELS[r.type]}
        </span>
        <span className="grow" />
        {!r.archivedAt && r.name.trim() && (
          <button onClick={() => setUi({ replaceOpen: { query: r.name.trim() } })} title="Change this name in every chapter, and in this entry">
            Rename everywhere…
          </button>
        )}
        <button className={`fav-btn${r.favorite ? ' on' : ''}`} aria-pressed={r.favorite} onClick={() => upd({ favorite: !r.favorite })} title="Favourites appear first in lists">
          <Icon name="star" size={16} filled={r.favorite} /> {r.favorite ? 'Favourite' : 'Add to favourites'}
        </button>
        {r.archivedAt ? (
          <button onClick={() => void unarchiveRecord('references', r.id)}>Restore from Trash</button>
        ) : (
          <button className="danger-text" onClick={remove}>
            Remove…
          </button>
        )}
      </header>
      {dupes.length > 0 && (
        <div className="banner info">
          Possible duplicate of{' '}
          {dupes.map((d, i) => (
            <span key={d.id}>
              {i > 0 && ', '}
              <a href={`#/p/${r.projectId}/refs/${d.id}`}>{d.name}</a>
            </span>
          ))}
          . That’s fine if they’re different {r.type === 'character' ? 'people' : 'entries'}.
        </div>
      )}
      <div className="ref-top">
        <div className="ref-image">
          {r.image ? <img src={r.image} alt={`${r.name}`} /> : <div className="ph" aria-hidden>{REFERENCE_TYPE_ICONS[r.type]}</div>}
          <label className="button small">
            {r.image ? 'Change' : 'Add image'}
            <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && void setImage(e.target.files[0])} />
          </label>
          {r.image && (
            <button className="small" onClick={() => upd({ image: '' })}>
              Remove image
            </button>
          )}
        </div>
        <div className="grow">
          <CommitInput className="title-input" label="Name" value={r.name} onCommit={(v) => v.trim() && upd({ name: v.trim() })} />
          <CommitInput
            label="Also known as (nicknames, titles, other spellings)"
            value={r.aliases.join(', ')}
            placeholder="Separate with commas"
            onCommit={(v) => upd({ aliases: v.split(',').map((s) => s.trim()).filter(Boolean) })}
          />
          {r.type === 'character' && <KinNameOffer r={r} all={all} onAdd={(names) => upd({ aliases: [...r.aliases, ...names] })} />}
          <div className="two-col">
            <label className="field">
              <span>Kind</span>
              <select value={r.type} onChange={(e) => upd({ type: e.target.value as ReferenceType })}>
                {REFERENCE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {REFERENCE_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            <CommitInput label="Status right now" value={r.status} placeholder={r.type === 'character' ? 'e.g. alive, missing' : 'e.g. standing, ruined'} onCommit={(v) => upd({ status: v })} />
          </div>
        </div>
      </div>
      <CommitInput label="In a sentence or two" multiline rows={2} placeholder="Who or what is this, at a glance?" value={r.summary} onCommit={(v) => upd({ summary: v })} />
      <div className="field-grid">
        {visible.map((f) => (
          <CommitInput key={f.key} label={f.label} multiline={f.multiline} rows={f.multiline ? 3 : 1} value={r.fields[f.key] ?? ''} onCommit={(v) => upd({ fields: { ...r.fields, [f.key]: v } })} />
        ))}
        {customKeys.map((k) => (
          <div key={k} className="custom-field">
            <CommitInput label={k} multiline value={r.fields[k]} onCommit={(v) => upd({ fields: { ...r.fields, [k]: v } })} />
            <button
              className="small"
              onClick={() => {
                const f = { ...r.fields };
                delete f[k];
                upd({ fields: f });
              }}
              aria-label={`Remove field ${k}`}
            >
              Remove field
            </button>
          </div>
        ))}
      </div>
      <div className="add-details">
        <span className="muted small">Add details:</span>
        {hidden.map((f) => (
          <button key={f.key} className="chip-btn" onClick={() => setShown((s) => new Set(s).add(f.key))}>
            + {f.label.split(' (')[0]}
          </button>
        ))}
        <button
          className="chip-btn"
          onClick={async () => {
            const k = await promptDialog('Add your own detail', 'What should it be called? (e.g. “Favourite food”)', '', 'Add');
            if (k && !(k in r.fields)) upd({ fields: { ...r.fields, [k]: '' } });
          }}
        >
          + Your own…
        </button>
      </div>

      {r.type === 'character' && <CharacterArc r={r} all={all} />}
      <h3>{r.type === 'character' ? 'Relationships' : 'Connections'}</h3>
      <ul className="link-list">
        {r.links.map((l, i) => {
          const t = all.find((x) => x.id === l.targetId);
          return (
            <li key={l.targetId + i}>
              <a href={`#/p/${r.projectId}/refs/${l.targetId}`}>{t ? `${REFERENCE_TYPE_ICONS[t.type]} ${t.name}` : '(missing entry)'}</a>
              <CommitInput
                value={l.label}
                placeholder={r.type === 'character' && t?.type === 'character' ? 'e.g. sister, rival, mentor' : 'relationship'}
                onCommit={(v) => upd({ links: r.links.map((x, j) => (j === i ? { ...x, label: v } : x)) })}
              />
              <button className="small" onClick={() => upd({ links: r.links.filter((_, j) => j !== i) })} aria-label="Remove connection">
                ✕
              </button>
            </li>
          );
        })}
      </ul>
      <button className="small" onClick={() => setLinkPicker(true)}>
        + Add connection
      </button>
      {linkPicker && (
        <ReferencePicker
          projectId={r.projectId}
          title="Connect to…"
          onClose={() => setLinkPicker(false)}
          onPick={async (t) => {
            setLinkPicker(false);
            if (t.id === r.id || r.links.some((l) => l.targetId === t.id)) return;
            const label = (await promptDialog('Connection', `What is ${t.name} to ${r.name}? (for example “grandmother”, “sister”, “rival”)`, '', 'Save')) ?? '';
            await updateRecord('references', r.id, { links: [...r.links, { targetId: t.id, label }] });
            // Add the reverse link too so both entries show it.
            const target = await db.references.get(t.id);
            if (target && !target.links.some((l) => l.targetId === r.id)) {
              await updateRecord('references', t.id, { links: [...target.links, { targetId: r.id, label: '' }] });
            }
          }}
        />
      )}
      <TagInput value={r.tags} onChange={(tags) => upd({ tags })} />
      <CommitInput label="Notes" multiline rows={6} value={r.notes} onCommit={(v) => upd({ notes: v })} />

      <h3>Mentioned in</h3>
      {backlinks === null ? (
        <p className="muted">Looking…</p>
      ) : backlinks.length === 0 ? (
        <p className="muted">Not linked or mentioned anywhere yet.</p>
      ) : (
        <ul className="backlinks">
          {backlinks.map((b) => (
            <li key={b.kind + b.id}>
              <span className="pill">{b.kind}</span>{' '}
              <a
                href={
                  b.kind === 'scene'
                    ? `#/p/${r.projectId}/write/${b.sceneId}`
                    : b.kind === 'card'
                      ? `#/p/${r.projectId}/board/${b.id}`
                      : b.kind === 'event'
                        ? `#/p/${r.projectId}/timeline/${b.id}`
                        : b.kind === 'note'
                          ? `#/p/${r.projectId}/notes/${b.id}`
                          : b.kind === 'thread'
                            ? `#/p/${r.projectId}/threads/${b.id}`
                            : `#/p/${r.projectId}/refs/${b.id}`
                }
              >
                {b.title}
              </a>
              <span className="muted small">
                {' '}
                · {b.how}
                {b.detail ? ` · ${b.detail}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}


/** "In Winnie's scenes, Betty is called “Grandma” (5×)": family names from the text, offered as nicknames. */
function KinNameOffer({ r, all, onAdd }: { r: ReferenceEntry; all: ReferenceEntry[]; onAdd: (names: string[]) => void }) {
  const scenes = useLiveQuery(
    async () =>
      (await db.scenes.where('projectId').equals(r.projectId).toArray()).filter((s) => !s.archivedAt && s.povCharacterId).map((s) => ({ povId: s.povCharacterId, text: s.plainText })),
    [r.projectId],
  );
  const found = useMemo(() => (scenes ? kinNames(r, all, scenes) : []), [r, all, scenes]);
  if (!found.length) return null;
  const relative = all.find((x) => x.id === found[0].relativeId)?.name ?? 'their relative';
  const names = found.map((k) => `“${k.name}” (${k.count}×)`);
  return (
    <p className="small">
      In {relative}’s scenes, {r.name.split(/\s+/)[0]} is called {names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]}.{' '}
      <button className="link-btn" onClick={() => onAdd(found.map((k) => k.name))} title="So look-ups, mentions and the continuity checks find them under these names too">
        Add as nickname{found.length > 1 ? 's' : ''}
      </button>
    </p>
  );
}
