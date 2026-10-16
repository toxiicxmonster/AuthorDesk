import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useBooks, useManuscript, useProject, useProjects, getRecent } from '../data';
import { href, navigate } from '../router';
import { DEFAULT_BOOK_TITLE, createProject, createChapter, createRecord, deleteProjectCascade, renameProject, updateRecord, localDateKey } from '../../storage/repo';
import { createReference } from '../../domain/references';
import { db } from '../../storage/db';
import { confirmDialog, promptDialog, toast } from '../store';
import { StatusDot, relativeTime } from '../components/common';
import { useSettings } from '../../storage/settings';
import { WRITING_STATUSES } from '../../domain/schema';
import { useSyncStatus } from '../../sync/useSyncStatus';
import { useSyncUi } from '../../sync/controller';
import { SyncPanel } from '../components/SyncPanel';
import { useArchiveImport } from '../components/ImportPanel';
import { createSampleProject } from '../../storage/sample';
import { BookPagesCard } from '../components/BookPages';
import { BookProgress } from '../components/BookProgress';
import { BackupRecovery } from '../components/BackupRecovery';
import { PitchCard } from '../components/PitchCard';
import type { SprintRecord } from '../sprint';

export function HomePage({ projectId }: { projectId: string | null }) {
  return projectId ? <Dashboard projectId={projectId} /> : <ProjectList />;
}

function ProjectList() {
  const projects = useProjects();
  const syncUi = useSyncUi();
  const settings = useSettings();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const importer = useArchiveImport();
  const counts = useLiveQuery(async () => {
    const m = new Map<string, number>();
    for (const s of await db.scenes.toArray()) if (!s.archivedAt) m.set(s.projectId, (m.get(s.projectId) ?? 0) + s.wordCount);
    return m;
  }, []);
  const create = async () => {
    const n = name.trim() || DEFAULT_BOOK_TITLE;
    const { project } = await createProject(n);
    setName('');
    navigate(project.id, 'write');
  };
  const sample = async () => {
    setBusy(true);
    try {
      const { projectId, firstSceneId } = await createSampleProject();
      navigate(projectId, 'write', firstSceneId);
      toast('This is a sample book — explore freely, and delete it from its Home page when you’re done.');
    } finally {
      setBusy(false);
    }
  };
  const restoreInput = (
    <input type="file" accept=".authorproj,.zip" hidden onChange={(e) => e.target.files?.[0] && void importer.loadFile(e.target.files[0]).finally(() => (e.target.value = ''))} />
  );

  if (projects && projects.length === 0) {
    return (
      <div className="page narrow welcome">
        <div className="welcome-hero">
          <img src="./icon.svg" alt="" width={64} height={64} />
          <h1>Welcome to AuthorDesk</h1>
          <p>A quiet place to write your book — with your characters, plans and notes close at hand. Everything stays private on this computer.</p>
        </div>
        <form
          className="welcome-start card"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <label htmlFor="new-book">
            <strong>Start a new book</strong>
          </label>
          <div className="row gap">
            <input id="new-book" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Your book’s title (you can change it later)" />
            <button className="primary big" type="submit">
              Start writing →
            </button>
          </div>
        </form>
        <div className="welcome-options">
          <button className="card welcome-option" disabled={busy} onClick={() => void sample()}>
            <span className="type-icon" aria-hidden>
              📖
            </span>
            <strong>Look around with a sample book</strong>
            <span className="muted small">A short story with characters, a plan and notes already filled in.</span>
          </button>
          <button
            className="card welcome-option"
            onClick={async () => {
              const title = name.trim() || (await promptDialog('Bring in my existing book', 'Book title', '', 'Continue'));
              if (!title) return;
              const { project } = await createProject(title);
              navigate(project.id, 'data', null, { import: '1' });
            }}
          >
            <span className="type-icon" aria-hidden>
              📂
            </span>
            <strong>Bring in my existing book</strong>
            <span className="muted small">Import chapters, characters, places and plans from your own files.</span>
          </button>
          <label className="card welcome-option">
            <span className="type-icon" aria-hidden>
              ⇪
            </span>
            <strong>Restore a backup</strong>
            <span className="muted small">Open an .authorproj file you saved before.</span>
            {restoreInput}
          </label>
        </div>
        <BackupRecovery />
        {(syncUi.server === 'signed-out' || syncUi.server === 'signed-in') && <SyncPanel projectId={null} />}
        {importer.modal}
      </div>
    );
  }

  return (
    <div className="page narrow">
      <h1>Your books</h1>
      <ul className="project-list">
        {projects?.map((p) => (
          <li key={p.id} className={p.id === settings.lastProjectId ? 'last' : ''}>
            <a href={href(p.id, 'home')}>
              <strong>{p.name}</strong>
              <span className="muted small">
                {(counts?.get(p.id) ?? 0).toLocaleString()} words · edited {relativeTime(p.updatedAt)}
              </span>
            </a>
            <a className="button primary" href={href(p.id, 'write')}>
              Continue writing
            </a>
          </li>
        ))}
      </ul>
      <form
        className="row gap create-project"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Title of a new book" aria-label="Title of a new book" />
        <button type="submit">+ Start a new book</button>
      </form>
      <div className="row gap wrap">
        <label className="button small">
          Restore a backup…
          {restoreInput}
        </label>
        <button className="small" disabled={busy} onClick={() => void sample()}>
          Add the sample book
        </button>
        <a className="button small" href="#/settings">
          Settings & privacy
        </a>
      </div>
      {(syncUi.server === 'signed-out' || syncUi.server === 'signed-in') && <SyncPanel projectId={null} />}
      {importer.modal}
    </div>
  );
}

function Dashboard({ projectId }: { projectId: string }) {
  const project = useProject(projectId);
  const books = useBooks(projectId);
  const [bookId, setBookId] = useState<string | null>(null);
  const book = books.find((b) => b.id === bookId) ?? books[0] ?? null;
  const tree = useManuscript(book?.id ?? null);
  const settings = useSettings();
  const sync = useSyncStatus(projectId);
  const wordlog = useLiveQuery(async () => ((await db.settings.get(`wordlog:${projectId}`))?.value as Record<string, number>) ?? {}, [projectId]) ?? {};
  const today = wordlog[localDateKey()] ?? 0;
  const sprintsToday = useLiveQuery(
    async () => (((await db.settings.get(`sprints:${projectId}`))?.value as SprintRecord[]) ?? []).filter((r) => localDateKey(new Date(r.at)) === localDateKey()),
    [projectId],
  );
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return { key: localDateKey(d), label: d.toLocaleDateString(undefined, { weekday: 'short' }), n: wordlog[localDateKey(d)] ?? 0 };
  });
  const max7 = Math.max(1, ...last7.map((d) => Math.abs(d.n)));
  if (!project || !tree) return <p className="pad muted">Loading…</p>;

  const recentIds = getRecent(projectId);
  const recentScenes = recentIds.map((id) => tree.sceneOrder.find((s) => s.id === id)).filter(Boolean).slice(0, 5);
  const continueId = recentScenes[0]?.id ?? tree.sceneOrder[0]?.id;
  const continueLabel = tree.chapters.find((c) => c.id === tree.sceneOrder.find((s) => s.id === continueId)?.chapterId)?.title ?? '';
  const statusCounts = WRITING_STATUSES.map((s) => [s, tree.chapters.filter((c) => c.status === s).length] as const).filter(([, n]) => n);
  const goal = project.dailyGoal;
  const backupAge = settings.lastBackupAt ? (Date.now() - Date.parse(settings.lastBackupAt)) / 86_400_000 : Infinity;

  const quick = async (kind: 'chapter' | 'character' | 'location' | 'thread' | 'note') => {
    const label = { chapter: 'Chapter title', character: 'Character name', location: 'Location name', thread: 'Plot thread name', note: 'Note title' }[kind];
    const name = await promptDialog(`New ${kind === 'thread' ? 'plot thread' : kind}`, label, '', 'Create');
    if (!name) return;
    if (kind === 'chapter' && book) {
      const ch = await createChapter(projectId, book.id, name);
      const s = await db.scenes.where('chapterId').equals(ch.id).first();
      navigate(projectId, 'write', s?.id);
    } else if (kind === 'character' || kind === 'location') {
      const r = await createReference(projectId, kind, name);
      navigate(projectId, 'refs', r.id);
    } else if (kind === 'thread') {
      const t = await createRecord('plotThreads', projectId, { name, description: '', stakes: '', keyCharacterIds: [], status: 'open', resolution: '' });
      navigate(projectId, 'threads', t.id);
    } else if (kind === 'note') {
      const n = await createRecord('notes', projectId, { title: name, body: '', url: '', tags: [], referenceIds: [] });
      navigate(projectId, 'notes', n.id);
    }
  };

  return (
    <div className="page dashboard">
      <div className="dash-head">
        <div>
          <h1>{project.name}</h1>
          {books.length > 1 && (
            <select value={book?.id} onChange={(e) => setBookId(e.target.value)} aria-label="Book">
              {books.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
          )}
        </div>
        {continueId && (
          <a className="button primary big" href={href(projectId, 'write', continueId)}>
            Continue writing{continueLabel ? `: ${continueLabel}` : ''} →
          </a>
        )}
      </div>
      {backupAge > settings.backupReminderDays && (
        <div className="banner info">
          {settings.lastBackupAt ? `Your last backup was ${relativeTime(settings.lastBackupAt)}.` : 'You haven’t made a backup yet.'} Your work lives only in this
          browser until you back it up. <a href={href(projectId, 'data')}>Back up now</a>
        </div>
      )}
      <div className="cards">
        <section className="card">
          <h2>{book?.title}</h2>
          <div className="big-num">{tree.wordCount.toLocaleString()}</div>
          <div className="muted">words in {tree.chapters.length} chapters</div>
          <div className="status-row">
            {statusCounts.map(([s, n]) => (
              <span key={s}>
                <StatusDot status={s} /> {n} {s}
              </span>
            ))}
          </div>
        </section>
        <section className="card">
          <h2>Today</h2>
          <div className="big-num">{today.toLocaleString()}</div>
          <div className="muted">net words written{goal ? ` of ${goal.toLocaleString()} goal` : ''}</div>
          {!!sprintsToday?.length && (
            <div className="small muted">
              {sprintsToday.length} sprint{sprintsToday.length === 1 ? '' : 's'}: {sprintsToday.reduce((n, r) => n + r.words, 0).toLocaleString()} words in{' '}
              {sprintsToday.reduce((n, r) => n + r.minutes, 0)} min
            </div>
          )}
          {goal > 0 && (
            <div className="progress" role="progressbar" aria-valuenow={today} aria-valuemin={0} aria-valuemax={goal}>
              <div style={{ width: `${Math.min(100, Math.max(0, (today / goal) * 100))}%` }} />
            </div>
          )}
          <div className="week" aria-label="Words per day, last 7 days">
            {last7.map((d) => (
              <div key={d.key} className="day" title={`${d.label}: ${d.n} words`}>
                <div className="bar" style={{ height: `${Math.max(2, (Math.max(0, d.n) / max7) * 40)}px` }} />
                <span>{d.label[0]}</span>
              </div>
            ))}
          </div>
          <label className="field inline">
            <span>Daily goal</span>
            <select
              value={String(goal)}
              onChange={async (e) => {
                let v = parseInt(e.target.value, 10);
                if (e.target.value === 'custom') {
                  const t = await promptDialog('Daily word goal', 'Words per day', String(goal || 750), 'Set goal');
                  if (t === null) return;
                  v = Math.max(0, parseInt(t, 10) || 0);
                }
                void updateRecord('projects', projectId, { dailyGoal: v });
              }}
            >
              <option value="0">No goal</option>
              {[250, 500, 750, 1000, 1500, 2000, 3000].map((n) => (
                <option key={n} value={n}>
                  {n.toLocaleString()} words
                </option>
              ))}
              {goal > 0 && ![250, 500, 750, 1000, 1500, 2000, 3000].includes(goal) && <option value={goal}>{goal.toLocaleString()} words</option>}
              <option value="custom">Other…</option>
            </select>
          </label>
        </section>
        <section className="card">
          <h2>Recently edited</h2>
          <ul className="plain">
            {recentScenes.map((s) => (
              <li key={s!.id}>
                <a href={href(projectId, 'write', s!.id)}>
                  {tree.chapters.find((c) => c.id === s!.chapterId)?.title} › {s!.title}
                </a>
                <span className="muted small"> {relativeTime(s!.updatedAt)}</span>
              </li>
            ))}
            {!recentScenes.length && <li className="muted">Nothing yet.</li>}
          </ul>
        </section>
        <section className="card">
          <h2>Quick create</h2>
          <div className="quick-grid">
            <button onClick={() => quick('chapter')}>+ Chapter</button>
            <button onClick={() => quick('character')}>+ Character</button>
            <button onClick={() => quick('location')}>+ Location</button>
            <button onClick={() => quick('thread')}>+ Plot thread</button>
            <button onClick={() => quick('note')}>+ Note</button>
          </div>
          <h2>Sync & backup</h2>
          <p className="small">
            <strong>{sync.label}</strong> — {sync.detail}
            <br />
            Last backup: {relativeTime(settings.lastBackupAt)}
          </p>
        </section>
        {book && <BookProgress projectId={projectId} book={book} tree={tree} wordlog={wordlog} />}
        <BookPagesCard projectId={projectId} />
        {book && tree && <PitchCard projectId={projectId} book={book} tree={tree} />}
      </div>
      <div className="dash-foot">
        <a href="#/">← All books</a>
        <button
          onClick={async () => {
            const n = await promptDialog('Rename this book', 'Title', project.name);
            if (n?.trim()) await renameProject(projectId, n.trim());
          }}
        >
          Rename
        </button>
        <button
          className="danger-text"
          onClick={async () => {
            const ok = await confirmDialog(
              'Delete this project from this device?',
              `This permanently removes “${project.name}”, including all chapters, references and history, from this browser. Export a backup first if you might want it back.`,
              { confirmLabel: 'Delete permanently', danger: true, choices: [{ label: 'Export backup first', value: 'backup' }] },
            );
            if (ok === 'backup') navigate(projectId, 'data');
            else if (ok) {
              const typed = await promptDialog('Confirm deletion', `Type the project name (${project.name}) to confirm`, '', 'Delete');
              if (typed?.trim() !== project.name.trim()) {
                if (typed !== null) toast('Name did not match; nothing was deleted.');
                return;
              }
              await deleteProjectCascade(projectId);
              navigate(null);
              toast('Project deleted');
            }
          }}
        >
          Delete this book…
        </button>
      </div>
    </div>
  );
}
