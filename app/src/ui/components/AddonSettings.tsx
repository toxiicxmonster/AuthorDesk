import { useEffect, useState } from 'react';
import { ADDONS, ADDON_ORDER, busy, fetchSetupStatus, installAddons, spaceNeeded, type AddonId, type SetupStatus } from '../../setup/addons';
import { updateSettings, useSettings } from '../../storage/settings';
import { confirmDialog, toast } from '../store';
import { checkAddon, fetchAddonLogs, repairAddon, type HealthResult } from '../../setup/health';
import { SETUP_STARTED } from './AddonSetup';

/** Settings → Add-ons: what's installed, and an Install button for what isn't. */
export function AddonSettings() {
  const s = useSettings();
  const [st, setSt] = useState<SetupStatus | null | undefined>(undefined);
  const [health, setHealth] = useState<Partial<Record<AddonId, HealthResult | 'checking'>>>({});
  const [log, setLog] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let timer = 0;
    const tick = async () => {
      const next = await fetchSetupStatus();
      if (!alive) return;
      setSt(next);
      if (next && busy(next).length) timer = window.setTimeout(() => void tick(), 2000);
    };
    void tick();
    const onStart = () => {
      window.clearTimeout(timer);
      void tick();
    };
    window.addEventListener(SETUP_STARTED, onStart);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      window.removeEventListener(SETUP_STARTED, onStart);
    };
  }, []);

  if (st === undefined) return null;
  if (st === null) return <p className="small muted">Add-ons can be installed in the AuthorDesk desktop app (not in a web browser).</p>;

  const install = async (id: AddonId) => {
    if (st.freeGb >= 0 && st.freeGb < spaceNeeded([id])) return toast(`${ADDONS[id].label} needs about ${spaceNeeded([id])} GB free; this computer has ${st.freeGb} GB.`);
    const next = await installAddons([id]);
    if (!next) return toast('Couldn’t start the installer.');
    setSt(next);
    window.dispatchEvent(new Event(SETUP_STARTED));
  };

  const check = async (id: AddonId) => {
    setHealth((h) => ({ ...h, [id]: 'checking' }));
    const r = await checkAddon(id);
    setHealth((h) => ({ ...h, [id]: r }));
  };
  const repair = async (id: AddonId) => {
    const ok = await confirmDialog(
      `Repair the ${ADDONS[id].label}?`,
      'AuthorDesk checks its files and replaces anything damaged, in the background. It’s paused for a few minutes meanwhile. Large files that check out fine aren’t downloaded again.',
      { confirmLabel: 'Repair' },
    );
    if (!ok) return;
    const next = await repairAddon(id);
    if (!next) return toast('Couldn’t start the repair.');
    setHealth((h) => ({ ...h, [id]: undefined }));
    setSt(next);
    window.dispatchEvent(new Event(SETUP_STARTED));
  };

  return (
    <div className="addon-settings">
      <p className="small">Optional, open-source and private: both run on this computer, with no account or subscription.</p>
      <ul className="addon-list">
        {ADDON_ORDER.map((id) => {
          const p = st.parts[id];
          if (!p) return null;
          return (
            <li key={id}>
              <div className="row gap">
                <strong>{ADDONS[id].label}</strong>
                <span className="grow" />
                {p.state === 'installing' || p.state === 'queued' ? (
                  <span className="small muted">
                    {p.updating ? 'Updating: ' : ''}
                    {p.state === 'queued' ? 'Waiting…' : p.step || 'Starting…'}
                    {p.percent >= 0 ? ` ${p.percent}%` : ''}
                  </span>
                ) : p.installed && p.updateAvailable && p.available ? (
                  <button className="small" onClick={() => void install(id)}>
                    Update
                  </button>
                ) : p.installed ? (
                  <span className="small ok-text">Installed ✓ · up to date</span>
                ) : p.available ? (
                  <button className="small" onClick={() => void install(id)}>
                    {p.state === 'failed' ? 'Try again' : `Install (${ADDONS[id].download} GB)`}
                  </button>
                ) : (
                  <span className="small muted">Installer not found in this copy</span>
                )}
              </div>
              <span className="block small muted">{ADDONS[id].what}</span>
              {p.state === 'failed' && p.message && <span className="block small danger-text">{p.message}</span>}
              {p.installed && p.state !== 'installing' && p.state !== 'queued' && (
                <div className="row gap small addon-health">
                  <button className="small" onClick={() => void check(id)} disabled={health[id] === 'checking'}>
                    {health[id] === 'checking' ? 'Checking…' : 'Check'}
                  </button>
                  <button className="small" onClick={() => void repair(id)}>
                    Repair
                  </button>
                  {health[id] && health[id] !== 'checking' && (
                    <span className={(health[id] as HealthResult).ok ? 'ok-text' : 'danger-text'}>
                      {(health[id] as HealthResult).ok ? '✓ ' : ''}
                      {(health[id] as HealthResult).message}
                    </span>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <details className="addon-log" onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && void fetchAddonLogs().then(setLog)}>
        <summary className="small">Show the add-on log (for troubleshooting)</summary>
        <pre className="small">{log ?? 'Loading…'}</pre>
        <button className="small" onClick={() => void navigator.clipboard.writeText(log ?? '').then(() => toast('Log copied.'))}>
          Copy
        </button>
      </details>
      <label className="check small">
        <input type="checkbox" checked={s.addonPrompt === 'ask'} onChange={(e) => void updateSettings({ addonPrompt: e.target.checked ? 'ask' : 'never' })} /> Offer
        to install missing add-ons when AuthorDesk starts
      </label>
    </div>
  );
}
