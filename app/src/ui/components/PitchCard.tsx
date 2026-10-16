import { useEffect, useRef, useState } from 'react';
import type { Book } from '../../domain/schema';
import { updateRecord } from '../../storage/repo';
import { fetchAiStatus } from '../../ai/aiEditor';
import { draftPitch, pitchSource, unknownNames, type PitchKind } from '../../ai/pitch';
import { summarizeChapter, summarizeScene, summaryBasis } from '../../ai/summaries';
import { db } from '../../storage/db';
import type { ManuscriptTree } from '../data';
import { useReferences } from '../data';
import { flushAllEdits } from '../../editor/EditorContext';
import { confirmDialog, reportError, toast } from '../store';

const KINDS: { id: PitchKind; label: string; hint: string; rows: number }[] = [
  { id: 'logline', label: 'Logline', hint: 'One sentence: who, what they want, what stands in the way, what’s at stake.', rows: 2 },
  { id: 'blurb', label: 'Blurb', hint: 'The back-cover copy (and your Amazon description): 120–180 words, no spoilers.', rows: 7 },
  { id: 'synopsis', label: 'Synopsis', hint: 'For agents and publishers: the whole plot, ending included, in a page or so.', rows: 12 },
];

const words = (s: string) => (s.match(/[\p{L}\p{N}'’-]+/gu) ?? []).length;

/**
 * Home → Pitch: the book's logline, blurb and synopsis, written by the author, with an optional first draft from the
 * AI Editor built from the chapter summaries and outline notes. The blurb can become the eBook's description.
 */
export function PitchCard({ projectId, book, tree }: { projectId: string; book: Book; tree: ManuscriptTree }) {
  const refs = useReferences(projectId);
  const [kind, setKind] = useState<PitchKind>('logline');
  const [aiInstalled, setAiInstalled] = useState(false);
  const [busy, setBusy] = useState<PitchKind | null>(null);
  const saved = book.pitch?.[kind] ?? '';
  const [draft, setDraft] = useState(saved);
  const abort = useRef<AbortController | null>(null);
  // The material the last AI draft was written from, to point out names it made up.
  const [basis, setBasis] = useState<{ kind: PitchKind; text: string } | null>(null);

  useEffect(() => {
    void fetchAiStatus().then((s) => setAiInstalled(!!s?.installed));
    return () => abort.current?.abort();
  }, []);
  // Switching tabs (or the book changing elsewhere) shows the saved text, unless a draft is being written.
  useEffect(() => {
    if (busy !== kind) setDraft(book.pitch?.[kind] ?? '');
  }, [kind, book.pitch, busy]);

  const save = async (k: PitchKind, text: string) => {
    if ((book.pitch?.[k] ?? '') === text) return;
    try {
      const pitch = { logline: '', blurb: '', synopsis: '', ...book.pitch, [k]: text };
      await updateRecord('books', book.id, { pitch } as Partial<Book>);
    } catch (e) {
      reportError(e, 'Couldn’t save the pitch');
    }
  };

  const source = () =>
    pitchSource(
      tree.chapters.map((c) => {
        const scenes = tree.scenesByChapter.get(c.id) ?? [];
        return { title: c.title, summary: c.summary ?? '', sceneSummaries: scenes.map((s) => s.summary ?? ''), text: scenes.map((s) => s.plainText).join('\n') };
      }),
      refs
        .filter((r) => !r.archivedAt && r.type === 'character')
        .map((r) => ({ name: r.name, role: r.fields.role ?? '', summary: r.summary ?? '', goals: r.fields.goals ?? '', personality: r.fields.personality ?? '' })),
    );

  const write = async () => {
    const k = kind;
    if (saved.trim() && !(await confirmDialog(`Replace your ${k}?`, `The AI Editor writes a new draft in its place. Copy yours first if you want to keep it.`, { confirmLabel: 'Write a new draft' }))) return;
    await flushAllEdits();
    const src = source();
    if (src.counts.summary + src.counts.notes + src.counts.opening === 0) return toast('There’s nothing to build it from yet: add chapter summaries, outline notes or some writing first.');
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy(k);
    setDraft('');
    try {
      const text = await draftPitch(k, book.title, src.text, { signal: ctrl.signal, onText: (t) => setDraft(t) });
      setDraft(text);
      setBasis({ kind: k, text: src.text });
      await save(k, text);
      const thin = src.counts.notes + src.counts.opening + src.counts.empty > src.counts.summary;
      toast(thin ? 'Drafted. Most chapters have no summary yet, so this is built from outline notes and openings: check it closely.' : 'Drafted. Make it yours.');
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) reportError(e, 'The AI Editor couldn’t write it');
      setDraft(book.pitch?.[k] ?? '');
    } finally {
      setBusy(null);
    }
  };

  // Chapters with text but no summary: the drafts are much better with one for each.
  const unsummarized = tree.chapters.filter((c) => !c.summary?.trim() && (tree.scenesByChapter.get(c.id) ?? []).some((s) => s.plainText.trim().split(/\s+/).length >= 30));
  const [summarizing, setSummarizing] = useState<string | null>(null);
  const summarizeAll = async () => {
    const ctrl = new AbortController();
    abort.current?.abort();
    abort.current = ctrl;
    try {
      await flushAllEdits();
      for (const [i, c] of unsummarized.entries()) {
        setSummarizing(`Summarizing chapter ${i + 1} of ${unsummarized.length}…`);
        const scenes = (await db.scenes.where('chapterId').equals(c.id).toArray()).filter((s) => !s.archivedAt && s.plainText.trim()).sort((a, b) => a.order - b.order);
        const sums: string[] = [];
        for (const s of scenes) {
          if (s.summary.trim()) {
            sums.push(s.summary);
            continue;
          }
          const text = await summarizeScene(s.plainText, { signal: ctrl.signal });
          // Scene summaries are only filled in where there were none; nothing the author wrote is replaced.
          await updateRecord('scenes', s.id, { summary: text, summaryBasis: summaryBasis(s.plainText) });
          sums.push(text);
        }
        const fresh = await db.chapters.get(c.id);
        if (fresh && !fresh.summary?.trim()) await updateRecord('chapters', c.id, { summary: await summarizeChapter(sums, { signal: ctrl.signal }) });
      }
      toast(`Summarized ${unsummarized.length} chapter${unsummarized.length === 1 ? '' : 's'}. Read or change them in Scene notes.`);
    } catch (e) {
      if (!ctrl.signal.aborted) reportError(e, 'The AI Editor couldn’t summarize the chapters');
    } finally {
      setSummarizing(null);
    }
  };

  const info = KINDS.find((x) => x.id === kind)!;
  const n = words(draft);
  const invented = basis?.kind === kind && busy !== kind ? unknownNames(draft, basis.text, book.title) : [];
  return (
    <section className="card pitch-card">
      <h2>Pitch</h2>
      <div className="seg" role="tablist" aria-label="Pitch">
        {KINDS.map((x) => (
          <button key={x.id} role="tab" aria-selected={kind === x.id} className={kind === x.id ? 'on' : ''} onClick={() => setKind(x.id)}>
            {x.label}
            {book.pitch?.[x.id]?.trim() ? ' ✓' : ''}
          </button>
        ))}
      </div>
      <p className="muted small">{info.hint}</p>
      {aiInstalled && unsummarized.length > 0 && (
        <p className="small pitch-summaries">
          {unsummarized.length} chapter{unsummarized.length === 1 ? ' has' : 's have'} text but no summary, so a draft has less to go on.{' '}
          {summarizing ? (
            <>
              <span className="muted">{summarizing}</span>{' '}
              <button className="link-btn" onClick={() => abort.current?.abort()}>
                Stop
              </button>
            </>
          ) : (
            <button className="link-btn" disabled={!!busy} onClick={() => void summarizeAll()}>
              Summarize {unsummarized.length === 1 ? 'it' : 'them'} with the AI Editor
            </button>
          )}
        </p>
      )}
      <textarea
        aria-label={info.label}
        rows={info.rows}
        value={draft}
        readOnly={busy === kind}
        placeholder={aiInstalled ? 'Write it here, or let the AI Editor draft it from your chapter summaries and outline notes.' : 'Write it here.'}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void save(kind, draft)}
      />
      {invented.length > 0 && (
        <p className="small pitch-warning">
          Not in your book: <strong>{invented.join(', ')}</strong>. The AI Editor may have made {invented.length === 1 ? 'it' : 'these'} up; check before using it.
        </p>
      )}
      <div className="row gap wrap pitch-actions">
        <span className="muted small grow">{n ? `${n} word${n === 1 ? '' : 's'}` : ''}</span>
        {aiInstalled &&
          (busy === kind ? (
            <button onClick={() => abort.current?.abort()}>Stop</button>
          ) : (
            <button disabled={!!busy} onClick={() => void write()}>
              {draft.trim() ? 'New AI draft' : 'Draft with the AI Editor'}
            </button>
          ))}
        <button
          disabled={!draft.trim()}
          onClick={() => {
            void navigator.clipboard.writeText(draft).then(() => toast('Copied.'));
          }}
        >
          Copy
        </button>
        {kind === 'blurb' && (
          <button
            disabled={!draft.trim() || draft.trim() === (book.publishing?.description ?? '').trim()}
            title="Used as the description in the Kindle eBook and as a starting point for the Amazon page"
            onClick={() =>
              void updateRecord('books', book.id, { publishing: { ...(book.publishing ?? {}), description: draft.trim() } } as Partial<Book>)
                .then(() => toast('Saved as the eBook description.'))
                .catch((e) => reportError(e, 'Couldn’t save the description'))
            }
          >
            Use as the eBook description
          </button>
        )}
      </div>
    </section>
  );
}
