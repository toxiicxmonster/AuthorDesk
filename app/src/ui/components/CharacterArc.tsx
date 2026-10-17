import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { ReferenceEntry } from '../../domain/schema';
import { db } from '../../storage/db';
import { updateRecord } from '../../storage/repo';
import { bookScenes, seriesScenes } from '../../proofreading/continuityData';
import { arcChapters, chapterWritten, characterArcs } from '../../review/arcs';
import { navigate } from '../router';
import { reportError, toast } from '../store';

/** The scenes of a project in reading order: every book in a series, otherwise the (first) book. */
export function useStoryScenes(projectId: string) {
  return useLiveQuery(async () => {
    const series = await seriesScenes(projectId);
    if (series) return series;
    const book = (await db.books.where('projectId').equals(projectId).toArray()).filter((b) => !b.archivedAt).sort((a, b) => a.order - b.order)[0];
    return book ? bookScenes(book.id) : [];
  }, [projectId]);
}

/** A character's presence across the book: a strip with a cell per chapter, first and last seen, and gaps. */
export function CharacterArc({ r, all }: { r: ReferenceEntry; all: ReferenceEntry[] }) {
  const scenes = useStoryScenes(r.projectId);
  const names = useMemo(() => all.filter((x) => !x.archivedAt).flatMap((x) => [x.name, ...x.aliases]), [all]);
  const chapters = useMemo(() => arcChapters(scenes ?? []), [scenes]);
  const arc = useMemo(() => (chapters.length ? characterArcs(chapters, [r], names)[0] : null), [chapters, r, names]);
  if (!scenes) return null;
  if (!arc || !chapters.length) return null;
  const most = Math.max(1, ...arc.perChapter.map((p) => p.mentions + p.lines));
  const firstTitle = arc.first >= 0 ? chapters[arc.first].title : null;
  const lastGap = arc.gaps.find((g) => g.toEnd);
  const lineCount = arc.perChapter.reduce((n, p) => n + p.lines, 0);
  const writtenCount = chapters.filter(chapterWritten).length;
  const fillFirst = async () => {
    try {
      await updateRecord('references', r.id, { fields: { ...r.fields, firstAppearance: firstTitle! } });
      toast(`First appearance: ${firstTitle}`);
    } catch (e) {
      reportError(e, 'Could not update the entry');
    }
  };
  return (
    <section className="arc">
      <h3>In the story</h3>
      {arc.first < 0 ? (
        <p className="small muted">{r.name} doesn’t appear in the manuscript yet.</p>
      ) : (
        <>
          <div className="arc-strip" role="list" aria-label={`${r.name} by chapter`}>
            {arc.perChapter.map((p, i) => {
              const n = p.mentions + p.lines;
              return (
                <button
                  key={chapters[i].key}
                  role="listitem"
                  className={`arc-cell${n ? ' on' : chapterWritten(chapters[i]) ? '' : ' unwritten'}`}
                  style={n ? { opacity: 0.35 + (0.65 * n) / most } : undefined}
                  title={`${chapters[i].title}: ${n ? `${p.mentions} mention${p.mentions === 1 ? '' : 's'}${p.lines ? `, ${p.lines} line${p.lines === 1 ? '' : 's'} of dialogue` : ''}` : chapterWritten(chapters[i]) ? 'not here' : 'not written yet'}`}
                  disabled={!p.sceneId}
                  onClick={() => p.sceneId && navigate(r.projectId, 'write', p.sceneId, { find: r.name.split(/\s+/)[0] })}
                />
              );
            })}
          </div>
          <p className="small">
            First seen in {firstTitle}
            {arc.last !== arc.first ? `, last in ${chapters[arc.last].title}` : ''}. In {arc.perChapter.filter((p) => p.mentions + p.lines > 0).length} of {writtenCount < chapters.length ? `${writtenCount} written` : chapters.length} chapters,{' '}
            {lineCount} line{lineCount === 1 ? '' : 's'} of dialogue.
          </p>
          {lastGap && <p className="small warn-text">Not seen in the last {lastGap.missed} written chapters.</p>}
          {arc.gaps
            .filter((g) => !g.toEnd)
            .map((g) => (
              <p key={g.from} className="small muted">
                Missing for {g.missed} chapters ({chapters[g.from].title} to {chapters[g.to].title}).
              </p>
            ))}
          {!r.fields.firstAppearance?.trim() && firstTitle && (
            <button className="small" onClick={() => void fillFirst()}>
              Set first appearance to “{firstTitle}”
            </button>
          )}
        </>
      )}
    </section>
  );
}
