import { useEffect, useRef, useState } from 'react';
import { flushAllEdits } from '../../editor/EditorContext';
import { clock, dismissSprint, perMinute, sprintHistory, startSprint, stopSprint, useSprint, type SprintRecord } from '../sprint';
import { Icon } from './Icon';

const LENGTHS = [15, 25, 45];

/**
 * Writing toolbar → Sprint: pick a length and write. While it runs, the button becomes a small clock with the words
 * so far; at the end it shows the result (and your best sprint) until dismissed.
 */
export function SprintButton({ projectId, statusOnly = false }: { projectId: string; statusOnly?: boolean }) {
  const sprint = useSprint();
  const [open, setOpen] = useState(false);
  const [best, setBest] = useState<SprintRecord | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  useEffect(() => {
    if (sprint?.done)
      void sprintHistory(projectId).then((h) => setBest(h.reduce<SprintRecord | null>((b, r) => (!b || perMinute(r.words, r.minutes) > perMinute(b.words, b.minutes) ? r : b), null)));
  }, [sprint?.done, projectId]);

  const mine = sprint && sprint.projectId === projectId ? sprint : null;
  if (mine?.done) {
    const rate = perMinute(mine.done.words, mine.done.minutes);
    const isBest = best && best.words === mine.done.words && best.minutes === mine.done.minutes;
    return (
      <div className="sprint-done" role="status">
        <strong>
          {mine.done.stopped ? 'Sprint stopped' : 'Sprint done'}: {mine.done.words.toLocaleString()} word{mine.done.words === 1 ? '' : 's'}
        </strong>{' '}
        <span className="muted">
          in {mine.done.minutes} min{rate > 0 ? ` · ${rate} a minute` : ''}
          {isBest && mine.done.words > 0 ? ' · your best yet' : best && rate < perMinute(best.words, best.minutes) ? ` · best ${perMinute(best.words, best.minutes)} a minute` : ''}
        </span>
        <button className="link-btn" onClick={dismissSprint} aria-label="Close the sprint result">
          ✕
        </button>
      </div>
    );
  }
  if (mine) {
    return (
      <div className="sprint-running" role="timer" aria-label="Writing sprint">
        <Icon name="timeline" size={15} />
        <SprintClock endsAt={mine.endsAt} /> · {mine.words.toLocaleString()} word{mine.words === 1 ? '' : 's'}
        <button className="link-btn" onClick={stopSprint} title="Stop the sprint now">
          Stop
        </button>
      </div>
    );
  }
  if (statusOnly) return null;
  return (
    <div className="sprint-wrap" ref={box}>
      <button
        type="button"
        className="tb"
        title="Write for a set time and see how many words it comes to"
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="tb-icon" aria-hidden>
          <Icon name="timeline" size={16} />
        </span>
        <span className="tb-label">Sprint</span>
      </button>
      {open && (
        <div className="sprint-menu" role="menu">
          <p className="small muted">Write without stopping for…</p>
          {LENGTHS.map((m) => (
            <button
              key={m}
              role="menuitem"
              onClick={async () => {
                setOpen(false);
                await flushAllEdits();
                await startSprint(projectId, m);
              }}
            >
              {m} minutes
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Re-renders every second on its own, so the rest of the toolbar doesn't. */
function SprintClock({ endsAt }: { endsAt: number }) {
  const [, setNow] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return <span className="sprint-clock">{clock(endsAt - Date.now())}</span>;
}
