import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Chapter, ReferenceEntry, Scene } from '../../domain/schema';
import { REFERENCE_TYPES, type ReferenceType } from '../../domain/schema';
import { REFERENCE_TEMPLATES, REFERENCE_TYPE_ICONS, REFERENCE_TYPE_LABELS } from '../../domain/referenceTemplates';
import { createReference, detectMentions, matchesReference } from '../../domain/references';
import { useProjectTable, useReferences } from '../data';
import { navigate } from '../router';
import { confirmDialog, promptDialog, reportError, setUi, toast, useUi } from '../store';
import { db } from '../../storage/db';
import { cardFromScene, mergeScenes, restoreSnapshot, splitScene, updateRecord } from '../../storage/repo';
import { CommitInput, StatusSelect, relativeTime, Modal } from './common';
import { useEditorCtx, flushAllEdits } from '../../editor/EditorContext';
import { applyPlaced, getSuggestions, type PlacedSuggestion } from '../../editor/proofreadExtension';
import { TextSelection } from '@tiptap/pm/state';
import { CATEGORY_LABELS } from '../../proofreading/types';
import { LT_PROVIDER_ID } from '../../proofreading/languageTool';
import { useSettings } from '../../storage/settings';
import { Icon } from './Icon';

export function RightPanel({ scene, chapter, nextScene }: { scene: Scene; chapter: Chapter; nextScene: Scene | null }) {
  const tab = useUi((s) => s.rightTab);
  const tabs: [typeof tab, string][] = [
    ['reference', 'Look up'],
    ['scene', 'Scene notes'],
    ['proof', 'Suggestions'],
    ['history', 'Versions'],
  ];
  return (
    <aside className="right-panel" aria-label="Writing tools">
      <div className="tabs" role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setUi({ rightTab: k })}>
            {label}
          </button>
        ))}
        <button className="icon-btn close-panel" aria-label="Close panel" title="Close panel" onClick={() => setUi({ rightOpen: false })}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="panel-body">
        {tab === 'reference' && <QuickReference scene={scene} />}
        {tab === 'scene' && <SceneInspector scene={scene} chapter={chapter} nextScene={nextScene} />}
        {tab === 'proof' && <ProofPanel projectId={scene.projectId} />}
        {tab === 'history' && <HistoryPanel scene={scene} />}
      </div>
    </aside>
  );
}

function QuickReference({ scene }: { scene: Scene }) {
  const refs = useReferences(scene.projectId);
  const selectedId = useUi((s) => s.quickRefId);
  const [q, setQ] = useState('');
  const [type, setType] = useState<ReferenceType | ''>('');
  const selected = refs.find((r) => r.id === selectedId) ?? null;
  const list = useMemo(
    () =>
      refs
        .filter((r) => !r.archivedAt && (!type || r.type === type) && matchesReference(r, q))
        .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name)),
    [refs, q, type],
  );
  const linked = refs.filter((r) => scene.referenceIds.includes(r.id) || r.id === scene.povCharacterId || r.id === scene.locationId);
  const mentioned = useMemo(() => detectMentions(scene.plainText, refs, linked.map((r) => r.id)), [scene.plainText, refs, linked]);

  if (selected) {
    return (
      <div className="quickref">
        <button className="link" onClick={() => setUi({ quickRefId: null })}>
          ← All references
        </button>
        <ReferenceCard r={selected} all={refs} />
        <button onClick={() => navigate(scene.projectId, 'refs', selected.id)}>Open full entry</button>
      </div>
    );
  }
  return (
    <div className="quickref">
      <div className="row gap">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Look up…" aria-label="Look up reference" />
        <select value={type} onChange={(e) => setType(e.target.value as ReferenceType | '')} aria-label="Reference type">
          <option value="">All</option>
          {REFERENCE_TYPES.map((t) => (
            <option key={t} value={t}>
              {REFERENCE_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>
      {!q && linked.length + mentioned.length > 0 && (
        <section>
          <h4>In this scene</h4>
          <ul className="ref-mini">
            {linked.map((r) => (
              <RefMini key={r.id} r={r} note="linked" />
            ))}
            {mentioned.slice(0, 12).map(({ ref, count }) => (
              <RefMini key={ref.id} r={ref} note={`mentioned ${count}×`} />
            ))}
          </ul>
        </section>
      )}
      <section>
        <h4>{q || type ? 'Results' : 'All references'}</h4>
        <ul className="ref-mini">
          {list.slice(0, 100).map((r) => (
            <RefMini key={r.id} r={r} />
          ))}
          {!list.length && <li className="muted">Nothing here yet. Add characters and places from the References view.</li>}
        </ul>
      </section>
    </div>
  );
}

function RefMini({ r, note }: { r: ReferenceEntry; note?: string }) {
  return (
    <li>
      <button onClick={() => setUi({ quickRefId: r.id })}>
        <span aria-hidden>{REFERENCE_TYPE_ICONS[r.type]}</span> {r.favorite ? '★ ' : ''}
        {r.name}
        {note && <span className="muted small"> · {note}</span>}
        {r.summary && <span className="muted small block">{r.summary.slice(0, 90)}</span>}
      </button>
    </li>
  );
}

export function ReferenceCard({ r, all }: { r: ReferenceEntry; all: ReferenceEntry[] }) {
  const fields = REFERENCE_TEMPLATES[r.type].filter((f) => r.fields[f.key]?.trim());
  const custom = Object.entries(r.fields).filter(([k, v]) => v.trim() && !REFERENCE_TEMPLATES[r.type].some((f) => f.key === k));
  return (
    <article className="ref-card">
      <h3>
        <span aria-hidden>{REFERENCE_TYPE_ICONS[r.type]}</span> {r.name}
      </h3>
      <div className="muted small">
        {REFERENCE_TYPE_LABELS[r.type]}
        {r.status && ` · ${r.status}`}
        {r.aliases.length > 0 && ` · aka ${r.aliases.join(', ')}`}
      </div>
      {r.summary && <p>{r.summary}</p>}
      <dl>
        {fields.map((f) => (
          <div key={f.key}>
            <dt>{f.label}</dt>
            <dd>{r.fields[f.key]}</dd>
          </div>
        ))}
        {custom.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {r.links.length > 0 && (
        <>
          <h4>Connections</h4>
          <ul>
            {r.links.map((l) => {
              const t = all.find((x) => x.id === l.targetId);
              return t ? (
                <li key={l.targetId}>
                  <button className="link" onClick={() => setUi({ quickRefId: t.id })}>
                    {t.name}
                  </button>
                  {l.label && <span className="muted"> — {l.label}</span>}
                </li>
              ) : null;
            })}
          </ul>
        </>
      )}
      {r.notes && (
        <>
          <h4>Notes</h4>
          <p className="pre">{r.notes}</p>
        </>
      )}
      {r.tags.length > 0 && <div className="tags">{r.tags.map((t) => <span key={t} className="tag">{t}</span>)}</div>}
    </article>
  );
}

function SceneInspector({ scene, chapter, nextScene }: { scene: Scene; chapter: Chapter; nextScene: Scene | null }) {
  const refs = useReferences(scene.projectId);
  const threads = useProjectTable('plotThreads', scene.projectId).filter((t) => !t.archivedAt);
  const lanes = useProjectTable('boardLanes', scene.projectId);
  const { editor } = useEditorCtx();
  const characters = refs.filter((r) => r.type === 'character' && !r.archivedAt);
  const locations = refs.filter((r) => r.type === 'location' && !r.archivedAt);
  const upd = (patch: Partial<Scene>) => void updateRecord('scenes', scene.id, patch);
  const linkedCard = useLiveQuery(() => db.boardCards.where('projectId').equals(scene.projectId).filter((c) => c.sceneId === scene.id && !c.archivedAt).first(), [scene.id]);

  return (
    <div className="inspector">
      <h4>Chapter</h4>
      <CommitInput label="Chapter title" value={chapter.title} onCommit={(v) => v.trim() && void updateRecord('chapters', chapter.id, { title: v.trim() })} />
      <CommitInput label="Chapter summary" multiline value={chapter.summary} onCommit={(v) => void updateRecord('chapters', chapter.id, { summary: v })} />
      <StatusSelect label="Chapter status" value={chapter.status} onChange={(v) => void updateRecord('chapters', chapter.id, { status: v })} />
      <h4>Scene</h4>
      <CommitInput label="Scene title" value={scene.title} onCommit={(v) => v.trim() && upd({ title: v.trim() })} />
      <CommitInput label="Summary" multiline value={scene.summary} onCommit={(v) => upd({ summary: v })} />
      <StatusSelect value={scene.status} onChange={(v) => upd({ status: v })} />
      <label className="field">
        <span>POV character</span>
        <select value={scene.povCharacterId ?? ''} onChange={(e) => upd({ povCharacterId: e.target.value || null })}>
          <option value="">—</option>
          {characters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Location</span>
        <select value={scene.locationId ?? ''} onChange={(e) => upd({ locationId: e.target.value || null })}>
          <option value="">—</option>
          {locations.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <CommitInput label="Time marker" value={scene.timeMarker} placeholder="e.g. Day 3, dawn" onCommit={(v) => upd({ timeMarker: v })} />
      <fieldset className="field">
        <legend>Plot threads</legend>
        {threads.length === 0 && <span className="muted small">No plot threads yet.</span>}
        {threads.map((t) => (
          <label key={t.id} className="check">
            <input
              type="checkbox"
              checked={scene.plotThreadIds.includes(t.id)}
              onChange={(e) =>
                upd({ plotThreadIds: e.target.checked ? [...scene.plotThreadIds, t.id] : scene.plotThreadIds.filter((x) => x !== t.id) })
              }
            />{' '}
            {t.name}
          </label>
        ))}
      </fieldset>
      <CommitInput label="Scene notes" multiline rows={5} value={scene.notes} onCommit={(v) => upd({ notes: v })} />
      <h4>Scene tools</h4>
      <div className="stack">
        <button
          onClick={async () => {
            if (!editor) return;
            const pos = editor.state.selection.from;
            let blockIndex = 0;
            editor.state.doc.forEach((_node, offset, index) => {
              if (offset < pos) blockIndex = index;
            });
            if (blockIndex === 0) {
              toast('Place the cursor in the paragraph that should start the new scene (not the first paragraph).');
              return;
            }
            const title = await promptDialog('Split scene at cursor', 'New scene title', `${scene.title} (cont.)`, 'Split');
            if (!title) return;
            try {
              await flushAllEdits();
              const created = await splitScene(scene.id, blockIndex, title);
              navigate(scene.projectId, 'write', created.id);
            } catch (e) {
              reportError(e, 'Split failed');
            }
          }}
        >
          Split scene at cursor…
        </button>
        <button
          disabled={!nextScene || nextScene.chapterId !== scene.chapterId}
          onClick={async () => {
            if (!nextScene) return;
            const ok = await confirmDialog('Merge with next scene?', `“${nextScene.title}” will be appended to “${scene.title}” after a scene break, and then archived. Snapshots of both are saved first.`, { confirmLabel: 'Merge' });
            if (!ok) return;
            await flushAllEdits();
            await mergeScenes(scene.id, nextScene.id);
            toast('Scenes merged');
          }}
        >
          Merge with next scene…
        </button>
        {linkedCard ? (
          <button onClick={() => navigate(scene.projectId, 'board', linkedCard.id)}>Open board card</button>
        ) : (
          <button
            disabled={!lanes.length}
            onClick={async () => {
              const lane = lanes.filter((l) => !l.archivedAt).sort((a, b) => a.order - b.order)[0];
              if (!lane) return;
              await cardFromScene(scene.id, lane.id);
              toast('Board card created in the first lane');
            }}
          >
            Create board card from scene
          </button>
        )}
      </div>
    </div>
  );
}

function ProofPanel({ projectId }: { projectId: string }) {
  const { editor, proofVersion, rerunProofread, proofStatus } = useEditorCtx();
  const [, force] = useState(0);
  const [cat, setCat] = useState<string>('');
  const [bulk, setBulk] = useState<PlacedSuggestion[] | null>(null);
  const settings = useSettings();
  const online = settings.onlineCheck.enabled && !!settings.onlineCheck.consentedAt;
  useEffect(() => {
    if (!editor) return;
    const f = () => force((n) => n + 1);
    editor.on('transaction', f);
    return () => {
      editor.off('transaction', f);
    };
  }, [editor]);
  void proofVersion;
  if (!editor) return <p className="muted">Open a scene to proofread.</p>;
  const items = getSuggestions(editor.state);
  const shown = items.filter((s) => !cat || s.category === cat);
  const cats = [...new Set(items.map((s) => s.category))];
  const bulkable = shown.filter((s) => s.severity === 'error' && s.replacements.length > 0 && s.category !== 'spelling');

  const focus = (s: PlacedSuggestion) => {
    editor.chain().focus().command(({ tr }) => {
      tr.setSelection(TextSelection.create(tr.doc, s.from, s.to)).scrollIntoView();
      return true;
    }).run();
  };

  return (
    <div className="proof-panel">
      <div className="row gap">
        <button onClick={rerunProofread}>Re-check</button>
        <span className="muted small" aria-live="polite">{proofStatus}</span>
      </div>
      <p className="muted small">
        {online
          ? 'Checked on this computer, plus the online grammar check (turn it off in Settings → Proofreading).'
          : 'Checked on this computer — your text is never sent anywhere.'}{' '}
        Nothing changes unless you choose a fix. Click a suggestion to jump to it.
      </p>
      {cats.length > 1 && (
        <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Filter by category">
          <option value="">All categories ({items.length})</option>
          {cats.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]} ({items.filter((s) => s.category === c).length})
            </option>
          ))}
        </select>
      )}
      {bulkable.length > 1 && (
        <button onClick={() => setBulk(bulkable)}>Review & apply {bulkable.length} fixes…</button>
      )}
      <ul className="sugg-list">
        {shown.map((s) => (
          <li key={s.key} className={`sugg sev-${s.severity}`}>
            <button className="sugg-main" onClick={() => focus(s)}>
              <span className={`sev sev-${s.severity}`}>{s.severity === 'error' ? 'Error' : s.severity === 'warning' ? 'Check' : 'Style'}</span>{' '}
              <strong>“{s.original}”</strong>
              {s.providerId === LT_PROVIDER_ID && <span className="muted small"> · LanguageTool</span>}
              <span className="block small">{s.message}</span>
            </button>
            {s.ruleId === 'new-name' ? (
              <button
                className="primary small"
                onClick={async () => {
                  try {
                    await createReference(projectId, 'character', s.original);
                    toast(`Added “${s.original}” to your characters`);
                    rerunProofread();
                  } catch (e) {
                    reportError(e, 'Could not add the name');
                  }
                }}
              >
                + Add to characters
              </button>
            ) : s.replacements[0] !== undefined && (
              <button
                className="primary small"
                onClick={() => {
                  const ok = applyPlaced(editor.state, editor.view.dispatch, s, s.replacements[0]);
                  if (!ok) {
                    toast('Out of date — re-checking');
                    rerunProofread();
                  } else toast('Applied', { action: { label: 'Undo', run: () => editor.commands.undo() } });
                }}
              >
                → {s.replacements[0] === ' ' ? 'space' : s.replacements[0] || 'remove'}
              </button>
            )}
          </li>
        ))}
        {!shown.length && <li className="muted">No suggestions.</li>}
      </ul>
      {bulk && (
        <Modal title="Apply these fixes?" onClose={() => setBulk(null)}>
          <p>Only these {bulk.length} likely errors will change. Each can be undone with Ctrl+Z.</p>
          <ul className="bulk-preview">
            {bulk.map((s) => (
              <li key={s.key}>
                <del>{s.original}</del> → <ins>{s.replacements[0] === ' ' ? '␣' : s.replacements[0]}</ins> <span className="muted small">{s.message}</span>
              </li>
            ))}
          </ul>
          <div className="dialog-actions">
            <button onClick={() => setBulk(null)}>Cancel</button>
            <button
              className="primary"
              onClick={() => {
                // Apply from the end so earlier positions stay valid; each apply re-validates its text.
                let applied = 0;
                for (const s of bulk.slice().sort((a, b) => b.from - a.from)) {
                  const live = getSuggestions(editor.state).find((x) => x.key === s.key);
                  if (live && applyPlaced(editor.state, editor.view.dispatch, live, live.replacements[0])) applied++;
                }
                setBulk(null);
                toast(`Applied ${applied} of ${bulk.length}${applied < bulk.length ? ' (some were out of date)' : ''}`);
              }}
            >
              Apply {bulk.length}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function HistoryPanel({ scene }: { scene: Scene }) {
  const snaps = useLiveQuery(
    async () => (await db.snapshots.where('sceneId').equals(scene.id).toArray()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [scene.id],
  );
  const [preview, setPreview] = useState<string | null>(null);
  const shown = snaps?.find((s) => s.id === preview);
  return (
    <div>
      <p className="muted small">Earlier versions of this scene. One is saved automatically every 10 minutes while you write (and before big changes), or press 📸 Snapshot any time. Click one to read it or bring it back.</p>
      <ul className="snap-list">
        {snaps?.map((s) => (
          <li key={s.id}>
            <button className="link" onClick={() => setPreview(s.id)}>
              {new Date(s.createdAt).toLocaleString()}
            </button>
            <span className="muted small">
              {' '}
              · {s.wordCount.toLocaleString()} words · {s.reason} · {relativeTime(s.createdAt)}
            </span>
          </li>
        ))}
        {snaps?.length === 0 && <li className="muted">No snapshots yet.</li>}
      </ul>
      {shown && (
        <Modal title={`Snapshot from ${new Date(shown.createdAt).toLocaleString()}`} onClose={() => setPreview(null)} wide>
          <div className="snap-preview">{shown.plainText}</div>
          <div className="dialog-actions">
            <button onClick={() => navigator.clipboard?.writeText(shown.plainText).then(() => toast('Copied'))}>Copy text</button>
            <button
              className="primary"
              onClick={async () => {
                const ok = await confirmDialog('Restore this snapshot?', 'The current text will be saved as a snapshot first, so you can switch back.', { confirmLabel: 'Restore' });
                if (!ok) return;
                await flushAllEdits();
                await restoreSnapshot(shown.id);
                setPreview(null);
                toast('Snapshot restored');
              }}
            >
              Restore
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
