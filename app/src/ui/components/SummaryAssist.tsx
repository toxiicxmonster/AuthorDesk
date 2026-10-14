import { useEffect, useState } from 'react';
import type { Chapter, Scene } from '../../domain/schema';
import { db } from '../../storage/db';
import { updateRecord } from '../../storage/repo';
import { flushAllEdits } from '../../editor/EditorContext';
import { fetchAiStatus, AiError } from '../../ai/aiEditor';
import { STALE_BELOW, summarizeChapter, summarizeScene, summaryBasis, summaryFreshness } from '../../ai/summaries';
import { reportError, toast } from '../store';

const useAiInstalled = () => {
  const [on, setOn] = useState(false);
  useEffect(() => {
    void fetchAiStatus().then((s) => setOn(!!s?.installed));
  }, []);
  return on;
};

const problem = (e: unknown) => (e instanceof AiError ? e.message : 'The AI Editor ran into a problem. Try again.');

/** Under a scene's Summary: "Summarize with the AI Editor", the draft to use or discard, and an out-of-date note. */
export function SceneSummaryAssist({ scene }: { scene: Scene }) {
  const ai = useAiInstalled();
  const [draft, setDraft] = useState<{ text: string; basis: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(null), [scene.id]);
  const stale = !!scene.summary.trim() && summaryFreshness(scene.plainText, scene.summaryBasis) < STALE_BELOW;
  if (!ai && !stale) return null;

  const run = async () => {
    setBusy(true);
    try {
      await flushAllEdits();
      const cur = (await db.scenes.get(scene.id)) ?? scene;
      if (!cur.plainText.trim()) return toast('This scene has no text to summarize yet.');
      setDraft({ text: await summarizeScene(cur.plainText), basis: summaryBasis(cur.plainText) });
    } catch (e) {
      toast(problem(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const use = () => {
    if (!draft) return;
    const before = { summary: scene.summary, summaryBasis: scene.summaryBasis };
    void updateRecord('scenes', scene.id, { summary: draft.text, summaryBasis: draft.basis })
      .then(() => toast('Summary saved. Edit it above if you like.', { action: { label: 'Undo', run: () => void updateRecord('scenes', scene.id, before) } }))
      .catch((e) => reportError(e, 'Could not save the summary'));
    setDraft(null);
  };

  return (
    <div className="summary-assist">
      {stale && !draft && <p className="small warn-text">The scene has changed a lot since this summary was written; it may be out of date.</p>}
      {draft ? (
        <div className="ai-draft">
          <p className="small muted">AI Editor’s summary</p>
          <p>{draft.text}</p>
          <div className="row gap">
            <button className="small primary" onClick={use}>
              Use this
            </button>
            <button className="small" onClick={() => setDraft(null)}>
              Discard
            </button>
            <button className="small" onClick={() => void run()} disabled={busy}>
              Try again
            </button>
          </div>
        </div>
      ) : (
        ai && (
          <button className="small" onClick={() => void run()} disabled={busy}>
            {busy ? 'Reading the scene…' : scene.summary.trim() ? 'Summarize again with the AI Editor' : 'Summarize with the AI Editor'}
          </button>
        )
      )}
    </div>
  );
}

/**
 * Under a chapter's summary: summarize every scene that has no summary (or an out-of-date one), then the chapter from
 * its scenes, one after another with progress. Everything is shown to use or leave before anything is saved.
 */
export function ChapterSummaryAssist({ chapter }: { chapter: Chapter }) {
  const ai = useAiInstalled();
  const [progress, setProgress] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<{ scenes: { scene: Scene; text: string; basis: string[]; use: boolean }[]; chapter: string; useChapter: boolean } | null>(null);
  const [stop, setStop] = useState<AbortController | null>(null);
  useEffect(() => setDrafts(null), [chapter.id]);
  if (!ai) return null;

  const run = async () => {
    const ctrl = new AbortController();
    setStop(ctrl);
    try {
      await flushAllEdits();
      const scenes = (await db.scenes.where('chapterId').equals(chapter.id).toArray()).filter((s) => !s.archivedAt && s.plainText.trim()).sort((a, b) => a.order - b.order);
      if (!scenes.length) return toast('This chapter has no text to summarize yet.');
      const out: { scene: Scene; text: string; basis: string[]; use: boolean }[] = [];
      for (const [i, s] of scenes.entries()) {
        const fresh = s.summary.trim() && summaryFreshness(s.plainText, s.summaryBasis) >= STALE_BELOW;
        if (fresh) continue;
        setProgress(`Summarizing scene ${i + 1} of ${scenes.length}…`);
        out.push({ scene: s, text: await summarizeScene(s.plainText, { signal: ctrl.signal }), basis: summaryBasis(s.plainText), use: true });
      }
      setProgress('Summarizing the chapter…');
      const sceneSummaries = scenes.map((s) => out.find((o) => o.scene.id === s.id)?.text ?? s.summary).filter((t) => t.trim());
      const chapterText = await summarizeChapter(sceneSummaries, { signal: ctrl.signal });
      setDrafts({ scenes: out, chapter: chapterText, useChapter: true });
    } catch (e) {
      if (!ctrl.signal.aborted) toast(problem(e), { kind: 'error' });
    } finally {
      setProgress(null);
      setStop(null);
    }
  };
  const save = async () => {
    if (!drafts) return;
    try {
      for (const d of drafts.scenes) if (d.use) await updateRecord('scenes', d.scene.id, { summary: d.text, summaryBasis: d.basis });
      if (drafts.useChapter) await updateRecord('chapters', chapter.id, { summary: drafts.chapter });
      const n = drafts.scenes.filter((d) => d.use).length + (drafts.useChapter ? 1 : 0);
      toast(`Saved ${n} summar${n === 1 ? 'y' : 'ies'}.`);
      setDrafts(null);
    } catch (e) {
      reportError(e, 'Could not save the summaries');
    }
  };

  if (progress)
    return (
      <div className="summary-assist">
        <p className="small muted">{progress}</p>
        <button className="small" onClick={() => stop?.abort()}>
          Stop
        </button>
      </div>
    );
  if (!drafts)
    return (
      <div className="summary-assist">
        <button className="small" onClick={() => void run()}>
          Summarize this chapter’s scenes
        </button>
      </div>
    );
  return (
    <div className="summary-assist ai-draft">
      <p className="small muted">AI Editor’s summaries: untick any you don’t want.</p>
      {drafts.scenes.map((d, i) => (
        <label key={d.scene.id} className="draft-row small">
          <input type="checkbox" checked={d.use} onChange={(e) => setDrafts({ ...drafts, scenes: drafts.scenes.map((x, j) => (j === i ? { ...x, use: e.target.checked } : x)) })} />
          <span>
            <strong>{d.scene.title || `Scene ${i + 1}`}:</strong> {d.text}
          </span>
        </label>
      ))}
      <label className="draft-row small">
        <input type="checkbox" checked={drafts.useChapter} onChange={(e) => setDrafts({ ...drafts, useChapter: e.target.checked })} />
        <span>
          <strong>Chapter:</strong> {drafts.chapter}
        </span>
      </label>
      <div className="row gap">
        <button className="small primary" onClick={() => void save()}>
          Use the ticked ones
        </button>
        <button className="small" onClick={() => setDrafts(null)}>
          Discard
        </button>
      </div>
    </div>
  );
}
