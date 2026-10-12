import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { DEFAULT_SETTINGS, type UserSettings } from '../domain/schema';

const KEY = 'user';

export async function getSettings(): Promise<UserSettings> {
  const row = await db.settings.get(KEY);
  return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<UserSettings>) ?? {}) };
}

export async function updateSettings(patch: Partial<UserSettings>): Promise<UserSettings> {
  const next = { ...(await getSettings()), ...patch };
  await db.settings.put({ key: KEY, value: next });
  return next;
}

export function useSettings(): UserSettings {
  return useLiveQuery(getSettings, [], DEFAULT_SETTINGS);
}

/** Ask the browser to keep IndexedDB data even under storage pressure. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
