import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { TextSelection } from '@tiptap/pm/state';
import type { Revision, RevisionStatus } from '../../domain/schema';
import { db } from '../../storage/db';
import { updateRecord } from '../../storage/repo';
import { deleteEditPass } from '../../storage/revisions';
import { useEditorCtx } from '../../editor/EditorContext';
import { collectTextBlocks } from '../../editor/blocks';
import { applyPlaced, type PlacedSuggestion } from '../../editor/proofreadExtension';
import { PASS_KIND_LABELS, locateItem, passProgress, passReport } from '../../review/editPass';
import { aiTaskForMark } from '../../ai/markTask';
import { fetchAiStatus } from '../../ai/aiEditor';
import { saveFile } from '../../importExport/download';
import { navigate } from '../router';
import { confirmDialog, promptDialog, reportError, setUi, toast } from '../store';

/**
 * The side panel's "Edit pass" tab: work through a pass's items like an editor's notes. Fixes in the open scene are
 * applied on the author's click (one undoable step); everything else is Go to, Done, Dismiss or Later.
 */
export function EditPassPanel({ projectId, sceneId }: { projectId: string; sceneId: string }) {
  const { editor, proofVersion } = useEditorCtx();
  const all = useLiveQuery(() => db.revisions.where('projectId').equals(projectId).toArray(), [projectId]);
  const passes = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; createdAt: string }>();
    for (const r of all ?? []) if (!byId.has(r.passId) || r.createdAt < byId.get(r.passId)!.createdAt) byId.set(r.passId, { id: r.passId, name: r.passName, createdAt: r.createdAt });
    return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [all]);
  const [passId, setPassId] = useState<string | null>(null);
  const pass = passes.find((p) => p.id === passId) ?? passes[0] ?? null;
  const items = useMemo(() => (all ?? []).filter((r) => r.passId === pass?.id).sort((a, b) => a.order - b.order), [all, pass?.id]);
  const [show, setShow] = useState<'open' | 'later' | 'all'>('open');
  const [kind, setKind] = useState('');
  const [aiInstalled, setAiInstalled] = useState(false);
  useEffect(() => {
    void fetchAiStatus().then((s) => setAiInstalled(!!s?.installed));
  }, []);

  // The current text of every scene in the pass, to tell which items were rewritten since (their words are gone).
  const sceneIds = useMemo(() => [...new Set(items.map((i) => i.sceneId))], [items]);
  const texts = useLiveQuery(async () => new Map((await db.scenes.bulkGet(sceneIds)).filter((s) => !!s).map((s) => [s!.id, s!.plainText])), [sceneIds.join(',')]);
  const gone = useMemo(() => {
    const out = new Set<string>();
    if (!texts) return out;
    for (const it of items) {
      const t = texts.get(it.sceneId);
      if (t === undefined || !locateItem(t, it)) out.add(it.id);
    }
    return out;
  }, [items, texts]);
  const chapterTitles = useLiveQuery(async () => new Map((await db.chapters.where('projectId').equals(projectId).toArray()).map((c) => [c.id, c.title])), [projectId]);

  if (!all) return <p className="muted">Loading…</p>;
  if (!pass) {
    return (
      <div className="edit-pass">
        <p className="muted">No edit pass yet.</p>
        <p className="small muted">
          An edit pass collects every suggestion and review finding for a chapter or the whole book into one checklist, like an editor’s notes. Start one from the{' '}
          <button className="link-btn" onClick={() => navigate(projectId, 'review')}>
            Review
          </button>{' '}
          page.
        </p>
      </div>
    );
  }

  const progress = passProgress(items, gone, items.map((i) => i.id));
  const statusOf = (it: Revision): RevisionStatus | 'changed' => (it.status === 'open' && gone.has(it.id) ? 'changed' : it.status);
  const kinds = [...new Set(items.map((i) => i.kind))];
  const visible = items.filter((it) => {
    const st = statusOf(it);
    if (kind && it.kind !== kind) return false;
    if (show === 'open') return st === 'open';
    if (show === 'later') return st === 'later';
    return true;
  });

  const setStatus = (it: Revision, status: RevisionStatus, note?: string) => void updateRecord('revisions', it.id, note === undefined ? { status } : { status, note }).catch((e) => reportError(e, 'Could not update the item'));

  /** The item's place in the open editor, if its scene is the one open. */
  const placeOf = (it: Revision): { from: number; to: number } | null => {
    if (!editor || it.sceneId !== sceneId) return null;
    for (const b of collectTextBlocks(editor.state.doc)) {
      const at = locateItem(b.text, it);
      if (at) return { from: b.pos + at.start, to: b.pos + at.end };
    }
    return null;
  };
  void proofVersion; // re-render as the text changes so places stay current

  const goTo = (it: Revision) => {
    const here = placeOf(it);
    if (here && editor) {
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, here.from, here.to)).scrollIntoView());
      editor.view.focus();
      return;
    }
    navigate(projectId, 'write', it.sceneId, { find: it.quote });
  };
  const applyFix = (it: Revision, rep: string) => {
    const here = placeOf(it);
    if (!here || !editor) return goTo(it);
    const placed = { ...here, original: it.quote, key: `pass:${it.id}` } as PlacedSuggestion;
    if (!applyPlaced(editor.state, editor.view.dispatch, placed, rep)) return toast('That passage has changed, so nothing was replaced.');
    setStatus(it, 'done');
    toast(`Changed “${it.quote}” to “${rep || '(removed)'}”`, { action: { label: 'Undo', run: () => editor.chain().focus().undo().run() } });
  };
  const askAi = (it: Revision) => {
    const here = placeOf(it);
    if (!here || !editor) return goTo(it);
    const pick = aiTaskForMark({ ruleId: it.ruleId, category: it.kind as never, original: it.quote }) ?? { task: it.kind === 'sticky' ? ('tighter' as const) : ('clearer' as const), focus: null };
    // The whole sentence, so the rewrite has something to work with.
    const $pos = editor.state.doc.resolve(here.from);
    const para = $pos.parent.textBetween(0, $pos.parent.content.size, undefined, '\n');
    const sentenceAt = para.indexOf(it.context);
    const text = sentenceAt >= 0 ? it.context : it.quote;
    const from = sentenceAt >= 0 ? $pos.start() + sentenceAt : here.from;
    setUi({ rightTab: 'ai', aiRequest: { id: Date.now(), text, context: para, task: pick.task, focus: pick.focus, from, to: from + text.length, markKey: '', panel: true }, aiBest: null });
  };
  const later = async (it: Revision) => {
    const note = await promptDialog('Note for later', 'What to come back to (optional):', it.note);
    if (note === null) return;
    setStatus(it, 'later', note);
  };
  const exportReport = async () => {
    try {
      await saveFile(passReport(pass.name, items, chapterTitles ?? new Map()), `${pass.name.replace(/[\\/:*?"<>|]+/g, '-')}.md`, 'text/markdown');
    } catch (e) {
      reportError(e, 'Could not save the report');
    }
  };
  const remove = async () => {
    if (!(await confirmDialog('Delete this edit pass?', `“${pass.name}” and its ${items.length} items will be deleted. Your manuscript isn’t changed.`, { confirmLabel: 'Delete pass', danger: true }))) return;
    await deleteEditPass(pass.id);
    setPassId(null);
  };

  return (
    <div className="edit-pass">
      <div className="row gap wrap">
        {passes.length > 1 ? (
          <select value={pass.id} onChange={(e) => setPassId(e.target.value)} aria-label="Edit pass">
            {passes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        ) : (
          <strong>{pass.name}</strong>
        )}
      </div>
      <div className="pass-progress" title={`${progress.done} done, ${progress.later} for later, ${progress.open} to go`}>
        <div className="pass-bar">
          <span style={{ width: `${progress.total ? (100 * progress.done) / progress.total : 0}%` }} />
        </div>
        <span className="small">
          {progress.done} of {progress.total} done{progress.later ? ` · ${progress.later} for later` : ''}
        </span>
      </div>
      <div className="row gap wrap small">
        <select value={show} onChange={(e) => setShow(e.target.value as typeof show)} aria-label="Show">
          <option value="open">To do</option>
          <option value="later">For later</option>
          <option value="all">All</option>
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
          <option value="">Every kind</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {PASS_KIND_LABELS[k] ?? k}
            </option>
          ))}
        </select>
      </div>
      {!visible.length && <p className="muted small">{show === 'open' && progress.open === 0 ? 'All done. Nice work.' : 'Nothing here.'}</p>}
      <ul className="pass-items">
        {visible.slice(0, 200).map((it) => {
          const st = statusOf(it);
          const here = it.sceneId === sceneId;
          return (
            <li key={it.id} className={`pass-item st-${st}`}>
              <div className="pass-item-head small">
                <span className="chip">{PASS_KIND_LABELS[it.kind] ?? it.kind}</span>
                <span className="muted">{(it.chapterId && chapterTitles?.get(it.chapterId)) || ''}</span>
                {st !== 'open' && <span className="muted">· {st === 'changed' ? 'rewritten ✓' : st === 'later' ? 'later' : st}</span>}
              </div>
              <button className="link-btn pass-quote" onClick={() => goTo(it)} title={here ? 'Show it in the scene' : 'Go to this scene'}>
                “{it.quote.length > 90 ? it.quote.slice(0, 87) + '…' : it.quote}”
              </button>
              <p className="small">{it.message}</p>
              {it.note && <p className="small muted">Note: {it.note}</p>}
              {st === 'open' || st === 'later' ? (
                <div className="pop-reps">
                  {here && it.replacements.slice(0, 4).map((r) => (
                    <button key={r} className="primary small" onClick={() => applyFix(it, r)}>
                      {r === '' ? 'Remove' : r === ' ' ? 'Single space' : r}
                    </button>
                  ))}
                  {!here && <button className="small" onClick={() => goTo(it)}>Go to</button>}
                  {here && aiInstalled && !it.replacements.length && (
                    <button className="small primary" onClick={() => askAi(it)}>
                      Ask the AI Editor
                    </button>
                  )}
                  <button className="small" onClick={() => setStatus(it, 'done')}>
                    Done
                  </button>
                  <button className="small" onClick={() => setStatus(it, 'dismissed')}>
                    Dismiss
                  </button>
                  {st === 'open' && (
                    <button className="small" onClick={() => void later(it)}>
                      Later…
                    </button>
                  )}
                </div>
              ) : (
                <button className="link-btn small" onClick={() => setStatus(it, 'open')}>
                  Undo
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {visible.length > 200 && <p className="small muted">Showing the first 200. Filter by kind to see the rest.</p>}
      <div className="row gap wrap">
        <button onClick={() => void exportReport()}>Export as a report</button>
        <button className="danger-text link-btn" onClick={() => void remove()}>
          Delete pass
        </button>
      </div>
    </div>
  );
}
