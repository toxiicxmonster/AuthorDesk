import { useLiveQuery } from 'dexie-react-hooks';
import type { Chapter, Scene } from '../../domain/schema';
import { looksWritten, planItems, setPlanItem } from '../../domain/planChecklist';
import { db } from '../../storage/db';
import { updateRecord } from '../../storage/repo';

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
