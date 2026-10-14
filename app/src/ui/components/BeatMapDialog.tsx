import { useEffect, useMemo, useState } from 'react';
import type { BoardCard } from '../../domain/schema';
import { beatPositions, scenePositions, suggestByPosition } from '../../domain/beatMap';
import { BUILTIN_TEMPLATES } from '../../domain/boardTemplates';
import { mapBeatsWithAi, sceneGist } from '../../ai/beatMap';
import { fetchAiStatus } from '../../ai/aiEditor';
import { updateRecord } from '../../storage/repo';
import { useManuscript } from '../data';
import { reportError, toast } from '../store';
import { Modal } from './common';

const templateSummary = (title: string) => {
  const t = title.trim().toLowerCase();
  for (const tpl of BUILTIN_TEMPLATES) for (const l of tpl.lanes) for (const c of l.cards) if (c.title.toLowerCase() === t && c.summary) return c.summary;
  return '';
};

/**
 * "Map my draft to the beats": for each beat card, a suggested scene (where that beat usually falls; with the AI
 * Editor, the scene that does that job). Linking is the author's click; nothing is linked otherwise.
 */
export function BeatMapDialog({ bookId, beats, onClose }: { bookId: string; beats: BoardCard[]; onClose: () => void }) {
  const tree = useManuscript(bookId);
  const scenes = useMemo(() => tree?.sceneOrder.filter((s) => s.wordCount > 0 || s.summary.trim()) ?? [], [tree]);
  const chapterTitle = useMemo(() => new Map((tree?.chapters ?? []).map((c, i) => [c.id, c.title || `Chapter ${i + 1}`])), [tree]);
  const draft = useMemo(() => scenes.map((s) => ({ sceneId: s.id, chapterId: s.chapterId, words: s.wordCount })), [scenes]);
  const byPosition = useMemo(() => suggestByPosition(beats, draft), [beats, draft]);
  const [picks, setPicks] = useState<Map<string, string>>(new Map());
  const [why, setWhy] = useState<Map<string, string>>(new Map());
  const [ai, setAi] = useState<'none' | 'available' | 'busy' | 'done'>('none');
  useEffect(() => {
    void fetchAiStatus().then((s) => s?.installed && setAi('available'));
  }, []);
  const chosen = (beatId: string) => picks.get(beatId) ?? byPosition.find((b) => b.beatId === beatId)?.sceneId ?? '';
  const label = (sceneId: string) => {
    const s = scenes.find((x) => x.id === sceneId);
    return s ? `${chapterTitle.get(s.chapterId) ?? ''}: ${s.title || 'Scene'}` : '';
  };

  const askAi = async () => {
    setAi('busy');
    try {
      const pos = beatPositions(beats);
      const starts = scenePositions(draft);
      const matches = await mapBeatsWithAi(
        beats.map((b) => ({ id: b.id, title: b.title, summary: b.summary || templateSummary(b.title), at: pos.get(b.id)! })),
        scenes.map((s) => ({ sceneId: s.id, label: label(s.id), gist: sceneGist(s.summary, s.plainText), at: starts.get(s.id) ?? 0 })),
      );
      setPicks(new Map([...picks, ...matches.map((m): [string, string] => [m.beatId, m.sceneId])]));
      setWhy(new Map(matches.map((m) => [m.beatId, m.why])));
      setAi('done');
      if (!matches.length) toast('The AI Editor couldn’t match the beats this time. The suggestions by position are still there.');
    } catch (e) {
      setAi('available');
      reportError(e, 'The AI Editor couldn’t read the scenes');
    }
  };

  const link = async (b: BoardCard, sceneId: string) => {
    const s = scenes.find((x) => x.id === sceneId);
    if (!s) return;
    await updateRecord('boardCards', b.id, { sceneId: s.id, chapterId: s.chapterId });
  };
  const linkAll = async () => {
    try {
      let n = 0;
      for (const b of beats) {
        const id = chosen(b.id);
        if (id && b.sceneId !== id) {
          await link(b, id);
          n++;
        }
      }
      toast(n ? `Linked ${n} beat${n === 1 ? '' : 's'} to scenes.` : 'Every beat is already linked to its scene.');
      onClose();
    } catch (e) {
      reportError(e, 'Could not link the beats');
    }
  };

  return (
    <Modal title="Map my draft to the beats" onClose={onClose} wide>
      {!tree ? (
        <p className="muted">Reading the book…</p>
      ) : !scenes.length ? (
        <p className="muted">There are no scenes with text yet. Write a little first, then map it.</p>
      ) : (
        <>
          <p className="small muted">
            Each beat starts with the scene where that beat usually falls in a book of this length.
            {ai === 'available' || ai === 'busy' ? ' The AI Editor can read your scenes and suggest the scene that does each job; it matches best when your scenes have summaries (Scene notes → Summarize).' : ''} Change any of them, then link.
            Linking only connects the card to the scene; your writing isn’t touched.
          </p>
          {(ai === 'available' || ai === 'busy') && (
            <button onClick={() => void askAi()} disabled={ai === 'busy'}>
              {ai === 'busy' ? 'Reading your scenes…' : 'Ask the AI Editor to match them'}
            </button>
          )}
          <table className="beat-map">
            <thead>
              <tr>
                <th>Beat</th>
                <th>Scene</th>
              </tr>
            </thead>
            <tbody>
              {beats.map((b) => {
                const at = byPosition.find((x) => x.beatId === b.id)?.at ?? 0;
                return (
                  <tr key={b.id}>
                    <td>
                      <strong>{b.title}</strong>
                      <div className="small muted">usually around {Math.round(at * 100)}%</div>
                    </td>
                    <td>
                      <select value={chosen(b.id)} onChange={(e) => setPicks(new Map(picks).set(b.id, e.target.value))} aria-label={`Scene for ${b.title}`}>
                        <option value="">Not yet</option>
                        {scenes.map((s) => (
                          <option key={s.id} value={s.id}>
                            {label(s.id)}
                          </option>
                        ))}
                      </select>
                      {why.get(b.id) && <div className="small">AI Editor: {why.get(b.id)}</div>}
                      {b.sceneId && <div className="small muted">Linked now: {label(b.sceneId) || 'another scene'}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="row gap">
            <button className="primary" onClick={() => void linkAll()}>
              Link these
            </button>
            <button onClick={onClose}>Cancel</button>
          </div>
        </>
      )}
    </Modal>
  );
}
