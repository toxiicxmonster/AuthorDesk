import { useEffect, useMemo, useRef, useState } from 'react';
import { useBooks, useManuscript, useReferences } from '../data';
import { navigate } from '../router';
import { runReview } from '../../review/runReview';
import type { Finding, PaceKind, ReviewReport } from '../../review/metrics';
import { flushAllEdits } from '../../editor/EditorContext';
import { reportError, setUi, toast } from '../store';
import { startEditPass } from '../../storage/revisions';
import { ContinuityReport } from '../components/ContinuityReport';
import { useLiveQuery } from 'dexie-react-hooks';
import type { ReferenceEntry } from '../../domain/schema';
import { bookScenes } from '../../proofreading/continuityData';
import { ARC_GAP, arcChapters, arcWarnings, characterArcs } from '../../review/arcs';

/**
 * Review: the whole book at once. Statistics and lists a scene-by-scene check can't show, each item one click from
 * the text. Nothing here changes the manuscript.
 */
export function ReviewPage({ projectId }: { projectId: string }) {
  const books = useBooks(projectId);
  const [bookId, setBookId] = useState<string | null>(null);
  const book = books.find((b) => b.id === bookId) ?? books[0] ?? null;
  const tree = useManuscript(book?.id ?? null);
  const refs = useReferences(projectId);
  const names = useMemo(() => refs.filter((r) => !r.archivedAt).flatMap((r) => [r.name, ...r.aliases]), [refs]);
  const [report, setReport] = useState<ReviewReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [ranAt, setRanAt] = useState<Date | null>(null);
  const runs = useRef(0);

  const run = async () => {
    if (!tree || !book) return;
    const mine = ++runs.current; // only the latest run may update the page
    setBusy(true);
    try {
      await flushAllEdits();
      const titles = new Map(tree.chapters.map((c, i) => [c.id, c.title || `Chapter ${i + 1}`]));
      const scenes = tree.sceneOrder.map((s) => ({ sceneId: s.id, chapterId: s.chapterId, chapterTitle: titles.get(s.chapterId) ?? '', text: s.plainText }));
      const next = await runReview(scenes, names);
      if (mine !== runs.current) return;
      setReport(next);
      setRanAt(new Date());
    } catch (e) {
      if (mine === runs.current) reportError(e, 'The review couldn’t run');
    } finally {
      if (mine === runs.current) setBusy(false);
    }
  };

  // Run once the chosen book's manuscript has loaded (and again when switching books).
  const loadedKey = book && tree ? `${book.id}:${tree.sceneOrder.length}` : null;
  useEffect(() => {
    if (loadedKey) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedKey]);

  const go = (f: Finding) => navigate(projectId, 'write', f.sceneId, { find: f.find });

  return (
    <div className="page review-page">
      <div className="row gap wrap review-head">
        <h1>Review</h1>
        {books.length > 1 && (
          <select value={book?.id ?? ''} onChange={(e) => setBookId(e.target.value)} aria-label="Book">
            {books.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
        )}
        <span className="grow" />
        {ranAt && <span className="muted small">Checked {ranAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>}
        <button onClick={() => void run()} disabled={busy || !tree}>
          {busy ? 'Reading the book…' : 'Check again'}
        </button>
      </div>
      <p className="muted small">The whole book at once: patterns that only show across chapters. Click anything to jump to it. Nothing here changes your text.</p>
      {book && tree && <StartEditPass projectId={projectId} bookId={book.id} bookTitle={book.title} chapters={tree.chapters} firstScene={(chapterId) => tree.scenesByChapter.get(chapterId)?.[0]?.id ?? tree.sceneOrder[0]?.id ?? null} />}

      {!report ? (
        <p className="muted">{busy ? 'Reading the book…' : 'Nothing to review yet.'}</p>
      ) : report.words === 0 ? (
        <p className="muted">This book has no text yet.</p>
      ) : (
        <>
          <ReviewBody report={report} go={go} projectId={projectId} firstScene={(chapterId) => tree?.scenesByChapter.get(chapterId)?.[0]?.id ?? null} />
          {book && <ContinuityReport projectId={projectId} bookId={book.id} refs={refs} runKey={String(ranAt?.getTime() ?? 0)} />}
          {book && <ArcGaps projectId={projectId} bookId={book.id} refs={refs} names={names} runKey={String(ranAt?.getTime() ?? 0)} />}
        </>
      )}
    </div>
  );
}

/** Collects a chapter's or the book's suggestions and findings into an edit-pass checklist, then opens it. */
function StartEditPass({
  projectId,
  bookId,
  bookTitle,
  chapters,
  firstScene,
}: {
  projectId: string;
  bookId: string;
  bookTitle: string;
  chapters: { id: string; title: string }[];
  firstScene: (chapterId: string) => string | null;
}) {
  const [scope, setScope] = useState('');
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    try {
      await flushAllEdits();
      const i = chapters.findIndex((c) => c.id === scope);
      const where = scope ? chapters[i].title || `Chapter ${i + 1}` : bookTitle || 'Whole book';
      const name = `Edit pass: ${where}, ${new Date().toLocaleDateString([], { day: 'numeric', month: 'short' })}`;
      const { count } = await startEditPass(projectId, bookId, scope || null, name);
      if (!count) return toast('Nothing to work through there. Clean copy!');
      toast(`Edit pass ready: ${count} item${count === 1 ? '' : 's'}.`);
      const sceneId = firstScene(scope || chapters[0]?.id || '');
      if (sceneId) navigate(projectId, 'write', sceneId);
      setUi({ rightOpen: true, rightTab: 'pass' });
    } catch (e) {
      reportError(e, 'Could not start the edit pass');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="row gap wrap start-pass">
      <span className="small">Work through it like an editor’s notes:</span>
      <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Edit pass scope">
        <option value="">Whole book</option>
        {chapters.map((c, i) => (
          <option key={c.id} value={c.id}>
            {c.title || `Chapter ${i + 1}`}
          </option>
        ))}
      </select>
      <button onClick={() => void start()} disabled={busy}>
        {busy ? 'Collecting…' : 'Start an edit pass'}
      </button>
    </div>
  );
}

/** Characters who drop out of the story for a long stretch (from their mentions and dialogue, chapter by chapter). */
function ArcGaps({ projectId, bookId, refs, names, runKey }: { projectId: string; bookId: string; refs: ReferenceEntry[]; names: string[]; runKey: string }) {
  const scenes = useLiveQuery(() => bookScenes(bookId), [bookId, runKey]);
  const warnings = useMemo(() => {
    if (!scenes) return null;
    const chapters = arcChapters(scenes);
    return arcWarnings(characterArcs(chapters, refs, names), chapters);
  }, [scenes, refs, names]);
  if (!warnings) return null;
  return (
    <section className="card">
      <h2>Characters who drop out</h2>
      {!warnings.length ? (
        <p className="muted small">Nobody you’re following disappears for {ARC_GAP} or more chapters.</p>
      ) : (
        <ul className="review-list">
          {warnings.map((w, i) => (
            <li key={i}>
              <button className="link-btn" onClick={() => (w.sceneId ? navigate(projectId, 'write', w.sceneId) : navigate(projectId, 'refs', w.referenceId))}>
                {w.message}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const easeLabel = (e: number) => (e >= 80 ? 'very easy' : e >= 70 ? 'easy' : e >= 60 ? 'plain English' : e >= 50 ? 'fairly hard' : 'hard');
/** Rates of typical published fiction, roughly; above them is worth a look. */
const TYPICAL: Record<string, number> = { adverbs: 12, crutch: 15, passive: 5, filler: 10, tags: 25, echoes: 8 };
const PER1K_LABELS: Record<string, string> = { adverbs: 'Adverbs', crutch: 'Crutch words', passive: 'Passive voice', filler: 'Filler words', tags: 'Speech tags', echoes: 'Echo words' };
const PACE_LABEL: Record<PaceKind, string> = { dialogue: 'Dialogue', fast: 'Fast (short sentences)', medium: 'Medium', slow: 'Slow (long sentences)' };

function ReviewBody({ report: r, go, projectId, firstScene }: { report: ReviewReport; go: (f: Finding) => void; projectId: string; firstScene: (chapterId: string) => string | null }) {
  const o = r.overall;
  return (
    <>
      <section className="card review-overview">
        <div className="stat">
          <strong>{r.words.toLocaleString()}</strong>
          <span>words</span>
        </div>
        <div className="stat">
          <strong>{o.readingEase}</strong>
          <span>reading ease · {easeLabel(o.readingEase)}</span>
        </div>
        <div className="stat">
          <strong>{o.avgSentence}</strong>
          <span>words per sentence · {o.sentenceSpread < 6 ? 'little variety' : 'varied'}</span>
        </div>
        <div className="stat">
          <strong>{Math.round(o.dialogueShare * 100)}%</strong>
          <span>dialogue</span>
        </div>
        {Object.entries(o.per1k).map(([k, v]) => (
          <div key={k} className={`stat${v > TYPICAL[k] ? ' high' : ''}`} title={`Per 1,000 words. Typical published fiction: under about ${TYPICAL[k]}.`}>
            <strong>{v}</strong>
            <span>
              {PER1K_LABELS[k]} per 1,000{v > TYPICAL[k] ? ' · higher than most' : ''}
            </span>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>Chapters</h2>
        <div className="pace-legend small">
          {(Object.keys(PACE_LABEL) as PaceKind[]).map((k) => (
            <span key={k}>
              <i className={`pace-${k}`} /> {PACE_LABEL[k]}
            </span>
          ))}
        </div>
        <table className="review-table">
          <thead>
            <tr>
              <th>Chapter</th>
              <th>Words</th>
              <th title="Average words per sentence">Sentence</th>
              <th title="Flesch reading ease (higher is easier)">Ease</th>
              <th>Dialogue</th>
              <th title="Adverbs per 1,000 words">Adverbs</th>
              <th title="Crutch words per 1,000 words">Crutch</th>
              <th title="Echo words per 1,000 words">Echoes</th>
              <th>Pacing</th>
            </tr>
          </thead>
          <tbody>
            {r.chapters.map((c) => {
              const first = firstScene(c.chapterId);
              return (
                <tr key={c.chapterId} onClick={() => first && navigate(projectId, 'write', first)} className={first ? 'clickable' : ''}>
                  <td>{c.title}</td>
                  <td>{c.words.toLocaleString()}</td>
                  <td>{c.avgSentence}</td>
                  <td>{c.readingEase}</td>
                  <td>{Math.round(c.dialogueShare * 100)}%</td>
                  <td className={c.per1k.adverbs > TYPICAL.adverbs ? 'high' : ''}>{c.per1k.adverbs}</td>
                  <td className={c.per1k.crutch > TYPICAL.crutch ? 'high' : ''}>{c.per1k.crutch}</td>
                  <td className={c.per1k.echoes > TYPICAL.echoes ? 'high' : ''}>{c.per1k.echoes}</td>
                  <td>
                    <div className="pace-bar" title="Dialogue, fast, medium and slow stretches, in reading order">
                      {c.pacing.map((p, i) => (
                        <i key={i} className={`pace-${p.kind}`} style={{ flexGrow: p.words }} />
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <div className="review-grid">
        <section className="card">
          <h2>Most-used words</h2>
          <p className="muted small">Your book’s most frequent words (names and common little words left out). Worth a look when one stands out.</p>
          {!r.topWords.length && <p className="small">Nothing stands out yet. This fills in as the book grows.</p>}
          <ul className="review-list">
            {r.topWords.map((w) => (
              <li key={w.word}>
                <button className="link-btn" onClick={() => go(w.first)}>
                  {w.word}
                </button>{' '}
                <span className="muted small">
                  ×{w.count} · {w.per10k} per 10,000
                </span>
                <Spark values={w.byChapter} />
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2>Repeated phrases</h2>
          <p className="muted small">Three- and four-word phrases you’ve used three or more times.</p>
          {r.topPhrases.length ? (
            <ul className="review-list">
              {r.topPhrases.map((p) => (
                <li key={p.phrase}>
                  <button className="link-btn" onClick={() => go(p.first)}>
                    “{p.phrase}”
                  </button>{' '}
                  <span className="muted small">×{p.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small">None. Nicely varied.</p>
          )}
        </section>

        <section className="card">
          <h2>Crutch words</h2>
          <p className="muted small">Words that often weaken prose when used a lot. Some are fine; watch the high ones.</p>
          <ul className="review-list">
            {r.crutch.map((c) => (
              <li key={c.word}>
                <strong>{c.word}</strong>{' '}
                <span className="muted small">
                  ×{c.count} · {c.per1k} per 1,000
                </span>
                <Spark values={c.byChapter} />
              </li>
            ))}
          </ul>
        </section>
      </div>

      <FindingList title="Sticky sentences" hint="Longer sentences made mostly of little “glue” words (it, was, that, there…). Tightening them makes prose crisper." items={r.sticky} go={go} />
      <FindingList title="Slow stretches" hint="Several long-sentence paragraphs in a row with little dialogue or action. Fine for reflection; check they’re where you want the pace to drop." items={r.slowStretches} go={go} />
      <FindingList title="Longest sentences" hint="Thirty words or more. Long sentences can be powerful; make sure each one reads clearly." items={r.longest} go={go} />
    </>
  );
}

function FindingList({ title, hint, items, go }: { title: string; hint: string; items: Finding[]; go: (f: Finding) => void }) {
  return (
    <section className="card">
      <h2>
        {title} <span className="muted small">({items.length})</span>
      </h2>
      <p className="muted small">{hint}</p>
      {items.length ? (
        <ul className="sugg-list">
          {items.map((f, i) => (
            <li key={i} className="sugg">
              <button className="sugg-main" onClick={() => go(f)}>
                <span className="muted small">
                  {f.chapterTitle} · {f.detail}
                </span>
                <span className="block small">{f.snippet}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="small">None found.</p>
      )}
    </section>
  );
}

/** A tiny per-chapter bar chart. */
function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  return (
    <span className="spark" aria-hidden title="By chapter">
      {values.map((v, i) => (
        <i key={i} style={{ height: `${Math.max(8, (v / max) * 100)}%` }} />
      ))}
    </span>
  );
}
