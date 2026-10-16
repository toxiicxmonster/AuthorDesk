import { useSyncExternalStore } from 'react';
import { db } from '../storage/db';
import { localDateKey } from '../storage/repo';

/**
 * Writing sprints: write for a set time and see how many words it came to. Words are the book's net words written
 * today (the same count as Home's "Today"), so they add up across scenes and chapters. One sprint at a time; it keeps
 * running while you move around the app.
 */

export interface Sprint {
  projectId: string;
  minutes: number;
  startedAt: number;
  endsAt: number;
  /** Today's net words when the sprint started. */
  startWords: number;
  /** Net words written so far. */
  words: number;
  /** Set when time is up (or it was stopped): the result stays on screen until dismissed. */
  done: null | { words: number; minutes: number; stopped: boolean };
}

export interface SprintRecord {
  at: string;
  minutes: number;
  words: number;
}

let current: Sprint | null = null;
const listeners = new Set<() => void>();
let ticker: number | undefined;

const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

async function todayWords(projectId: string): Promise<number> {
  const log = ((await db.settings.get(`wordlog:${projectId}`))?.value as Record<string, number>) ?? {};
  return log[localDateKey()] ?? 0;
}

async function tick() {
  if (!current || current.done) return;
  const now = Date.now();
  const words = (await todayWords(current.projectId)) - current.startWords;
  if (!current) return;
  if (now >= current.endsAt) return finish(false, words);
  current = { ...current, words };
  emit();
}

async function finish(stopped: boolean, words?: number) {
  if (!current || current.done) return;
  window.clearInterval(ticker);
  const w = words ?? (await todayWords(current.projectId)) - current.startWords;
  const minutes = stopped ? Math.max(1, Math.round((Date.now() - current.startedAt) / 60_000)) : current.minutes;
  current = { ...current, words: w, done: { words: w, minutes, stopped } };
  emit();
  if (minutes >= 1) {
    const key = `sprints:${current.projectId}`;
    const list = ((await db.settings.get(key))?.value as SprintRecord[]) ?? [];
    await db.settings.put({ key, value: [...list, { at: new Date().toISOString(), minutes, words: w }].slice(-50) });
  }
}

export async function startSprint(projectId: string, minutes: number): Promise<void> {
  window.clearInterval(ticker);
  const now = Date.now();
  current = { projectId, minutes, startedAt: now, endsAt: now + minutes * 60_000, startWords: await todayWords(projectId), words: 0, done: null };
  emit();
  ticker = window.setInterval(() => void tick(), 1000);
}

export const stopSprint = () => void finish(true);

export function dismissSprint() {
  window.clearInterval(ticker);
  current = null;
  emit();
}

export function useSprint(): Sprint | null {
  return useSyncExternalStore(subscribe, () => current);
}

/** Best and latest sprints, for the summary. */
export async function sprintHistory(projectId: string): Promise<SprintRecord[]> {
  return ((await db.settings.get(`sprints:${projectId}`))?.value as SprintRecord[]) ?? [];
}

export const perMinute = (words: number, minutes: number) => (minutes > 0 ? Math.round(words / minutes) : 0);

export const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
