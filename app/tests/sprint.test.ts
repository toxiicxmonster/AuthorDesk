import { describe, expect, it, vi } from 'vitest';
import { db } from '../src/storage/db';
import { localDateKey } from '../src/storage/repo';
import { clock, dismissSprint, perMinute, sprintHistory, startSprint, stopSprint } from '../src/ui/sprint';

describe('writing sprints', () => {
  it('counts the words written during the sprint and keeps a record', async () => {
    const key = 'wordlog:p-sprint';
    await db.settings.put({ key, value: { [localDateKey()]: 300 } });
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    await startSprint('p-sprint', 15);
    await db.settings.put({ key, value: { [localDateKey()]: 420 } });
    vi.advanceTimersByTime(60_000);
    stopSprint();
    vi.useRealTimers();
    await new Promise((r) => setTimeout(r, 20));
    const h = await sprintHistory('p-sprint');
    expect(h.at(-1)).toMatchObject({ minutes: 1, words: 120 });
    dismissSprint();
  });

  it('formats the clock and the rate', () => {
    expect(clock(61_000)).toBe('1:01');
    expect(clock(-5)).toBe('0:00');
    expect(perMinute(400, 25)).toBe(16);
  });
});
