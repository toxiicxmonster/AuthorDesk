import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../storage/db';
import { createSnapshot, restoreSnapshot, saveSceneContent, updateRecord } from '../../storage/repo';
import { flushAllEdits } from '../../editor/EditorContext';
import { findInDoc, replaceInDoc, caseLike, matcher, type DocMatch } from '../../domain/replace';
import type { ReferenceEntry, Scene } from '../../domain/schema';
import { navigate, useRoute } from '../router';
import { reportError, setUi, toast, useUi } from '../store';
import { Modal } from './common';

interface SceneHits {
  scene: Scene;
  chapterTitle: string;
  bookTitle: string;
  matches: DocMatch[];
}

const key = (sceneId: string, i: number) => `${sceneId}:${i}`;

/** The scenes of a project (or one book) in reading order, with their chapter and book titles. */
async function projectScenes(projectId: string, bookId: string | null) {
  const live = <T extends { archivedAt?: string | null }>(x: T) => !x.archivedAt;
  const byOrder = <T extends { order: number }>(a: T, b: T) => a.order - b.order;
  const books = (await db.books.where('projectId').equals(projectId).toArray()).filter(live).sort(byOrder);
  const out: { scene: Scene; chapterTitle: string; bookTitle: string }[] = [];
  for (const b of books) {
    if (bookId && b.id !== bookId) continue;
    const chapters = (await db.chapters.where('bookId').equals(b.id).toArray()).filter(live).sort(byOrder);
    for (const [ci, c] of chapters.entries()) {
      const scenes = (await db.scenes.where('chapterId').equals(c.id).toArray()).filter(live).sort(byOrder);
      for (const s of scenes) out.push({ scene: s, chapterTitle: c.title || `Chapter ${ci + 1}`, bookTitle: b.title });
    }
  }
  return { books, scenes: out };
}

/** A match in its paragraph, cut to a readable length, with the match itself marked. */
function Snippet({ m, replacement, showReplacement }: { m: DocMatch; replacement: string; showReplacement: boolean }) {
  const from = Math.max(0, m.start - 50);
  const to = Math.min(m.blockText.length, m.end + 50);
  return (
    <span className="replace-snippet">
      {from > 0 && '…'}
      {m.blockText.slice(from, m.start)}
      <mark className={showReplacement ? 'old' : undefined}>{m.text}</mark>
      {showReplacement && <ins>{replacement}</ins>}
      {m.blockText.slice(m.end, to)}
      {to < m.blockText.length && '…'}
    </span>
  );
}

/**
 * Find and replace across the whole book (or every book in a series): every match listed with its sentence, each
 * one can be left out, and the whole change can be undone. Renaming a character also offers to rename their entry.
 */
export function BookReplace() {
  const open = useUi((s) => s.replaceOpen);
  const route = useRoute();
  const projectId = route.projectId;
  if (!open || !projectId) return null;
  return <BookReplaceDialog projectId={projectId} initial={open.query} onClose={() => setUi({ replaceOpen: null })} />;
}

function BookReplaceDialog({ projectId, initial, onClose }: { projectId: string; initial: string; onClose: () => void }) {
  const [find, setFind] = useState(initial);
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCase] = useState(false);
  const [wholeWord, setWhole] = useState(true);
  const [bookId, setBookId] = useState<string>('');
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [renameEntry, setRenameEntry] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(initial);

  // Search a moment after typing stops.
  useEffect(() => {
    const t = setTimeout(() => setQuery(find), 250);
    return () => clearTimeout(t);
  }, [find]);
  useEffect(() => setSkipped(new Set()), [query, caseSensitive, wholeWord, bookId]);

  const data = useLiveQuery(() => projectScenes(projectId, bookId || null), [projectId, bookId]);
  const refs = useLiveQuery(() => db.references.where('projectId').equals(projectId).toArray(), [projectId]);
  const opts = useMemo(() => ({ caseSensitive, wholeWord }), [caseSensitive, wholeWord]);
  const hits = useMemo<SceneHits[]>(() => {
    if (!data || query.trim().length < 1) return [];
    return data.scenes.map((s) => ({ ...s, matches: findInDoc(s.scene.content, query, opts) })).filter((h) => h.matches.length);
  }, [data, query, opts]);
  const total = hits.reduce((n, h) => n + h.matches.length, 0);
  const chosen = total - hits.reduce((n, h) => n + h.matches.filter((_, i) => skipped.has(key(h.scene.id, i))).length, 0);

  // Renaming a character or place: its entry (name or nickname) can follow.
  const entry = useMemo<{ ref: ReferenceEntry; field: 'name' | 'alias' | 'part'; index: number } | null>(() => {
    const q = query.trim().toLowerCase();
    if (!q || !refs) return null;
    for (const r of refs) {
      if (r.archivedAt) continue;
      if (r.name.trim().toLowerCase() === q) return { ref: r, field: 'name', index: -1 };
      const i = r.aliases.findIndex((a) => a.trim().toLowerCase() === q);
      if (i >= 0) return { ref: r, field: 'alias', index: i };
    }
    // A first or last name on its own ("Jace" in "Jace Kensington").
    const re = matcher(query.trim(), { caseSensitive: false, wholeWord: true });
    const part = refs.find((r) => !r.archivedAt && re && r.name.match(re)?.length === 1);
    return part ? { ref: part, field: 'part', index: -1 } : null;
  }, [query, refs]);

  const toggle = (k: string) =>
    setSkipped((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const replaceAll = async () => {
    if (!chosen) return;
    setBusy(true);
    const snapshots: string[] = [];
    let entryBefore: ReferenceEntry | null = null;
    try {
      await flushAllEdits();
      let count = 0;
      for (const h of hits) {
        const fresh = await db.scenes.get(h.scene.id);
        if (!fresh) continue;
        const r = replaceInDoc(fresh.content, query, replacement, opts, (i) => !skipped.has(key(h.scene.id, i)));
        if (!r.count) continue;
        snapshots.push((await createSnapshot(fresh, 'before replace')).id);
        await saveSceneContent(fresh.id, r.doc);
        count += r.count;
      }
      if (entry && renameEntry && replacement.trim()) {
        entryBefore = entry.ref;
        if (entry.field === 'alias') {
          const newAlias = caseLike(entry.ref.aliases[entry.index], replacement.trim(), caseSensitive);
          await updateRecord('references', entry.ref.id, { aliases: entry.ref.aliases.map((a, i) => (i === entry.index ? newAlias : a)) });
        } else {
          // The whole name, or just the matching word of it ("Jace Kensington" → "Jase Kensington").
          const re = matcher(query.trim(), { caseSensitive: false, wholeWord: true })!;
          await updateRecord('references', entry.ref.id, { name: entry.ref.name.replace(re, (m) => caseLike(m, replacement.trim(), caseSensitive)) });
        }
      }
      onClose();
      toast(`Replaced ${count} in ${snapshots.length} scene${snapshots.length === 1 ? '' : 's'}${entryBefore ? ', and renamed the entry' : ''}.`, {
        ms: 15000,
        action: {
          label: 'Undo',
          run: () =>
            void (async () => {
              await flushAllEdits();
              for (const id of snapshots) await restoreSnapshot(id);
              if (entryBefore) await updateRecord('references', entryBefore.id, { name: entryBefore.name, aliases: entryBefore.aliases });
              toast('Put back as it was.');
            })().catch((e) => reportError(e, 'Couldn’t undo the replace')),
        },
      });
    } catch (e) {
      reportError(e, snapshots.length ? `Replaced in ${snapshots.length} scenes, then stopped. Each changed scene has a “before replace” version under Versions` : 'Couldn’t replace');
    } finally {
      setBusy(false);
    }
  };

  const multipleBooks = (data?.books.length ?? 0) > 1;
  return (
    <Modal title="Find & replace in the book" onClose={onClose} wide>
      <div className="replace-form">
        <label className="field">
          <span>Find</span>
          <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="A word, a name or a phrase" />
        </label>
        <label className="field">
          <span>Replace with</span>
          <input value={replacement} onChange={(e) => setReplacement(e.target.value)} placeholder="Leave empty to delete" />
        </label>
        <div className="row gap wrap">
          <label className="check">
            <input type="checkbox" checked={wholeWord} onChange={(e) => setWhole(e.target.checked)} /> Whole words only
          </label>
          <label className="check">
            <input type="checkbox" checked={caseSensitive} onChange={(e) => setCase(e.target.checked)} /> Match case
          </label>
          {multipleBooks && (
            <select value={bookId} onChange={(e) => setBookId(e.target.value)} aria-label="Where to look">
              <option value="">Every book in the series</option>
              {data!.books.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
          )}
        </div>
        {!caseSensitive && <p className="muted small">Capitals follow each match: at the start of a sentence, “Jace” becomes “Finn” even if you type “finn”.</p>}
      </div>

      {query.trim() && (
        <p className="small">
          {total ? (
            <>
              <strong>{total}</strong> match{total === 1 ? '' : 'es'} in {hits.length} scene{hits.length === 1 ? '' : 's'}
              {chosen !== total && <> · {chosen} chosen</>}. Untick any to leave them as they are.
            </>
          ) : (
            'No matches.'
          )}
        </p>
      )}
      <div className="replace-results">
        {hits.map((h) => (
          <section key={h.scene.id}>
            <h3 className="small">
              {multipleBooks && !bookId ? `${h.bookTitle} · ` : ''}
              {h.chapterTitle}
              {h.scene.title && h.scene.title !== h.chapterTitle ? ` · ${h.scene.title}` : ''}{' '}
              <button
                className="link-btn"
                onClick={() => {
                  onClose();
                  navigate(projectId, 'write', h.scene.id, { find: query });
                }}
              >
                Go to
              </button>
            </h3>
            <ul>
              {h.matches.map((m, i) => (
                <li key={i}>
                  <label className="check">
                    <input type="checkbox" checked={!skipped.has(key(h.scene.id, i))} onChange={() => toggle(key(h.scene.id, i))} />
                    <Snippet m={m} replacement={caseLike(m.text, replacement, caseSensitive)} showReplacement={!skipped.has(key(h.scene.id, i))} />
                  </label>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {entry && replacement.trim() && (
        <label className="check small">
          <input type="checkbox" checked={renameEntry} onChange={(e) => setRenameEntry(e.target.checked)} /> Also rename{' '}
          {entry.field === 'name'
            ? `the entry “${entry.ref.name}”`
            : entry.field === 'part'
              ? `“${entry.ref.name}” to “${entry.ref.name.replace(matcher(query.trim(), { caseSensitive: false, wholeWord: true })!, (m) => caseLike(m, replacement.trim(), caseSensitive))}”`
              : `“${entry.ref.aliases[entry.index]}” in ${entry.ref.name}’s nicknames`}{' '}
          in Characters & world
        </label>
      )}
      <div className="row gap modal-actions">
        <span className="grow muted small">Each changed scene keeps a “before replace” version under Versions, and Undo puts everything back.</span>
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!chosen || busy} onClick={() => void replaceAll()}>
          {busy ? 'Replacing…' : `Replace ${chosen || ''}`.trim()}
        </button>
      </div>
    </Modal>
  );
}
