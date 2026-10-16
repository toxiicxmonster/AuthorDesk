import { useEffect, useState } from 'react';
import { db } from '../../storage/db';
import { updateRecord } from '../../storage/repo';
import { fetchAiStatus } from '../../ai/aiEditor';
import { relationSource, suggestRelationships, type RelationSuggestion } from '../../ai/relationships';
import { reportError, toast } from '../store';

/**
 * Maps → Relationships: the AI Editor proposes how characters are related, from their entries, the notes and the
 * chapter summaries, each with the words it's based on. Nothing is added until the author clicks Add.
 */
export function SuggestRelations({ projectId }: { projectId: string }) {
  const [installed, setInstalled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState<RelationSuggestion[] | null>(null);

  useEffect(() => {
    void fetchAiStatus().then((s) => setInstalled(!!s?.installed));
  }, []);
  if (!installed) return null;

  const run = async () => {
    setBusy(true);
    try {
      const [refs, notes, chapters] = await Promise.all([
        db.references.where('projectId').equals(projectId).toArray(),
        db.notes.where('projectId').equals(projectId).toArray(),
        db.chapters.where('projectId').equals(projectId).toArray(),
      ]);
      const chars = refs.filter((r) => !r.archivedAt && r.type === 'character');
      if (chars.length < 2) return toast('Add at least two characters first.');
      const source = relationSource(
        chars,
        notes.filter((n) => !n.archivedAt),
        chapters.filter((c) => !c.archivedAt).sort((a, b) => a.order - b.order).map((c) => c.summary ?? ''),
      );
      const found = await suggestRelationships(chars, source);
      setList(found);
      if (!found.length) toast('Nothing new that your notes clearly say. Add relationships by hand from a character’s entry.');
    } catch (e) {
      reportError(e, 'The AI Editor couldn’t suggest relationships');
    } finally {
      setBusy(false);
    }
  };

  const add = async (s: RelationSuggestion) => {
    try {
      const [a, b] = await Promise.all([db.references.get(s.aId), db.references.get(s.bId)]);
      if (!a || !b) return;
      // "B is A's bToA" lives on A's entry (pointing at B), and the reverse on B's.
      const put = (links: typeof a.links, targetId: string, label: string) =>
        links.some((l) => l.targetId === targetId) ? links.map((l) => (l.targetId === targetId && !l.label.trim() ? { ...l, label } : l)) : [...links, { targetId, label }];
      await updateRecord('references', a.id, { links: put(a.links, b.id, s.bToA) });
      await updateRecord('references', b.id, { links: put(b.links, a.id, s.aToB) });
      setList((l) => l?.filter((x) => x !== s) ?? null);
      toast(`Added: ${s.bName} is ${s.aName}’s ${s.bToA}.`);
    } catch (e) {
      reportError(e, 'Couldn’t add the relationship');
    }
  };

  return (
    <section className="card suggest-relations">
      <div className="row gap wrap">
        <strong className="grow">Suggest relationships</strong>
        <button disabled={busy} onClick={() => void run()}>
          {busy ? 'Reading your notes…' : list ? 'Ask again' : 'Read my notes'}
        </button>
      </div>
      <p className="small muted">
        The AI Editor reads your characters’ entries, your notes and your chapter summaries, and suggests how characters are related, quoting the words each
        suggestion comes from. It only suggests what your notes clearly say; nothing is added until you click Add.
      </p>
      {list && list.length > 0 && (
        <ul className="suggest-list">
          {list.map((s) => (
            <li key={`${s.aId}-${s.bId}`}>
              <div className="grow">
                <strong>
                  {s.bName} is {s.aName}’s {s.bToA}
                </strong>
                <span className="small muted"> · {s.aName} is {s.bName}’s {s.aToB}</span>
                <span className="block small muted">“{s.evidence}”</span>
              </div>
              <button className="small" onClick={() => void add(s)}>
                Add
              </button>
              <button className="small" onClick={() => setList((l) => l?.filter((x) => x !== s) ?? null)}>
                Skip
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
