import { useLiveQuery } from 'dexie-react-hooks';
import type { Chapter, Scene } from '../../domain/schema';
import { inlinePoints, looksWritten, planItems, setPlanItem, splitPlanItem } from '../../domain/planChecklist';
import { db } from '../../storage/db';
import { updateRecord } from '../../storage/repo';
import { setUi } from '../store';

/**
 * A plan's bullet lines (in the scene's notes or the chapter's summary) as a checklist to tick off while drafting.
 * Points the text already seems to cover say so, but only the author ticks them.
 */
function Checklist({ label, plan, written, narrator, onChange }: { label: string; plan: string; written: string; narrator: string[]; onChange: (plan: string) => void }) {
  const items = planItems(plan);
  if (!items.length) return null;
  const done = items.filter((i) => i.done).length;
  return (
    <fieldset className="field plan-checklist">
      <legend>
        {label} · {done} of {items.length} done
      </legend>
      {items.map((it) => (
        <label key={it.line} className={`check${it.done ? ' done' : ''}`}>
          <input type="checkbox" checked={it.done} onChange={(e) => onChange(setPlanItem(plan, it.line, e.target.checked))} />{' '}
          <span>
            {it.text}
            {!it.done && looksWritten(it.text, written, narrator) && <span className="muted small plan-hint"> · looks written</span>}
            {inlinePoints(it.text).length > 1 && (
              <>
                {' '}
                <button
                  className="link-btn"
                  title="These look like several points typed on one line. Put each on its own line so you can tick them off one by one."
                  onClick={(e) => {
                    e.preventDefault(); // inside the label: don't tick the box
                    onChange(splitPlanItem(plan, it.line));
                  }}
                >
                  Split into {inlinePoints(it.text).length} points
                </button>
              </>
            )}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** The point-of-view characters' names and aliases. */
function useNarrators(ids: readonly (string | null | undefined)[]): string[] {
  const key = [...new Set(ids.filter((x): x is string => !!x))].sort().join(',');
  const names = useLiveQuery(async () => (key ? (await db.references.bulkGet(key.split(','))).flatMap((r) => (r ? [r.name, ...r.aliases] : [])) : []), [key]);
  return names ?? [];
}

export function PlanChecklist({ scene }: { scene: Scene }) {
  const narrator = useNarrators([scene.povCharacterId]);
  return <Checklist label="Scene plan" plan={scene.notes} written={scene.plainText} narrator={narrator} onChange={(notes) => void updateRecord('scenes', scene.id, { notes })} />;
}

/** The chapter summary's bullet lines, checked against every scene of the chapter. */
export function ChapterPlanChecklist({ chapter }: { chapter: Chapter }) {
  const hasPlan = planItems(chapter.summary).length > 0;
  const scenes = useLiveQuery(async () => (hasPlan ? (await db.scenes.where('chapterId').equals(chapter.id).toArray()).filter((s) => !s.archivedAt) : []), [chapter.id, hasPlan]);
  const narrator = useNarrators((scenes ?? []).map((s) => s.povCharacterId));
  if (!hasPlan) return null;
  const written = (scenes ?? []).map((s) => s.plainText).join('\n');
  return <Checklist label="Chapter plan" plan={chapter.summary} written={written} narrator={narrator} onChange={(summary) => void updateRecord('chapters', chapter.id, { summary })} />;
}

/**
 * Write view footer: the next point of the plan that isn't ticked off yet (the scene's plan first, then the
 * chapter's), so it's in sight while drafting. Clicking it opens the checklist.
 */
export function NextPlanPoint({ scene }: { scene: Scene }) {
  const chapterSummary = useLiveQuery(async () => (await db.chapters.get(scene.chapterId))?.summary ?? '', [scene.chapterId]) ?? '';
  const items = [...planItems(scene.notes), ...planItems(chapterSummary)];
  if (!items.length) return null;
  const next = items.find((i) => !i.done);
  return (
    <button
      className="link-btn plan-next"
      title={next ? `Next in your plan: ${next.text}. Click to open the checklist.` : 'Every point of the plan is ticked off. Click to open the checklist.'}
      onClick={() => setUi({ rightOpen: true, rightTab: 'scene' })}
    >
      <span>{next ? `Next: ${next.text}` : 'Plan done ✓'}</span>
    </button>
  );
}
