/**
 * The optional add-ons (the private grammar engine and the AI Editor), installed in the background by the AuthorDesk
 * launcher's /setup routes, which run the same scripts as a manual install.
 */

export type AddonId = 'ai' | 'grammar';
export type AddonState = 'idle' | 'queued' | 'installing' | 'done' | 'failed';

export interface AddonStatus {
  installed: boolean;
  /** The install script ships with this copy of AuthorDesk. */
  available: boolean;
  state: AddonState;
  /** What it's doing now ("Downloading the model…"), while installing. */
  step: string;
  /** Progress through the current download, 0–100, or -1 when not measurable. */
  percent: number;
  message: string;
  /** Replacing an older installed version (pinned versions changed in this release). */
  updating: boolean;
  /** Installed, older than this release pins, and not being updated (e.g. not enough space at launch). */
  updateAvailable: boolean;
}

export interface SetupStatus {
  freeGb: number;
  parts: Record<AddonId, AddonStatus>;
}

export const ADDONS: Record<AddonId, { label: string; what: string; download: number; disk: number; needFree: number }> = {
  grammar: {
    label: 'Grammar engine',
    what: 'Full-sentence grammar, verb forms and confused words (affect/effect), with English usage data.',
    download: 9,
    disk: 15,
    needFree: 26, // the 8 GB data archive and its unpacked copy exist together for a few minutes
  },
  ai: {
    label: 'AI Editor',
    what: 'Rewrites and tightens passages, judges adverbs in context, writes lines in a character’s voice.',
    download: 8,
    disk: 8,
    needFree: 10,
  },
};

/** Order shown to the author: the grammar engine underpins everyday checking. */
export const ADDON_ORDER: AddonId[] = ['grammar', 'ai'];

/** Free space (GB) needed to install these: everything installed, plus the largest temporary overhead. */
export function spaceNeeded(ids: AddonId[]): number {
  if (!ids.length) return 0;
  return ids.reduce((n, id) => n + ADDONS[id].disk, 0) + Math.max(...ids.map((id) => ADDONS[id].needFree - ADDONS[id].disk));
}

export async function fetchSetupStatus(fetchImpl: typeof fetch = globalThis.fetch?.bind(globalThis)): Promise<SetupStatus | null> {
  try {
    const res = await fetchImpl('/setup/status', { cache: 'no-store' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
    return (await res.json()) as SetupStatus;
  } catch {
    return null;
  }
}

export async function installAddons(ids: AddonId[], fetchImpl: typeof fetch = globalThis.fetch?.bind(globalThis)): Promise<SetupStatus | null> {
  try {
    const res = await fetchImpl(`/setup/install?parts=${ids.join(',')}`, { method: 'POST' });
    return res.ok ? ((await res.json()) as SetupStatus) : null;
  } catch {
    return null;
  }
}

/** Add-ons not installed yet that this copy of AuthorDesk can install. */
export function missing(st: SetupStatus): AddonId[] {
  return ADDON_ORDER.filter((id) => st.parts[id] && !st.parts[id].installed && st.parts[id].available);
}

export function busy(st: SetupStatus): AddonId[] {
  return ADDON_ORDER.filter((id) => st.parts[id]?.state === 'queued' || st.parts[id]?.state === 'installing');
}
