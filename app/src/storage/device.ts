import { newId } from '../domain/ids';

const KEY = 'authordesk.deviceId';
let cached: string | null = null;

/** A random per-browser id used to attribute changes during sync. Not personally identifying. */
export function getDeviceId(): string {
  if (cached) return cached;
  try {
    cached = localStorage.getItem(KEY);
    if (!cached) {
      cached = newId();
      localStorage.setItem(KEY, cached);
    }
  } catch {
    cached = newId();
  }
  return cached;
}
