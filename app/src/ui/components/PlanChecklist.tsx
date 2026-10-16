import type { Scene } from '../../domain/schema';
import { looksWritten, planItems, setPlanItem } from '../../domain/planChecklist';
import { updateRecord } from '../../storage/repo';

/**
 * Scene notes → the plan's bullet lines as a checklist to tick off while drafting. Points the scene's text already
 * seems to cover say so, but only the author ticks them.
 */
export function PlanChecklist({ scene }: { scene: Scene }) {
  const items = planItems(scene.notes);
  if (!items.length) return null;
  const done = items.filter((i) => i.done).length;
  const toggle = (line: number, on: boolean) =>
    void updateRecord('scenes', scene.id, { notes: setPlanItem(scene.notes, line, on) });

  return (
    <fieldset className="field plan-checklist">
      <legend>
        Plan · {done} of {items.length} done
      </legend>
      {items.map((it) => (
        <label key={it.line} className={`check${it.done ? ' done' : ''}`}>
          <input type="checkbox" checked={it.done} onChange={(e) => toggle(it.line, e.target.checked)} />{' '}
          <span>
            {it.text}
            {!it.done && looksWritten(it.text, scene.plainText) && (
              <span className="muted small plan-hint"> · looks written</span>
            )}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
