import { useEffect, useState } from 'react';
import { ADDONS, ADDON_ORDER, busy, fetchSetupStatus, installAddons, spaceNeeded, type AddonId, type SetupStatus } from '../../setup/addons';
import { updateSettings, useSettings } from '../../storage/settings';
import { toast } from '../store';
import { SETUP_STARTED } from './AddonSetup';

/** Settings → Add-ons: what's installed, and an Install button for what isn't. */
export function AddonSettings() {
  const s = useSettings();
  const [st, setSt] = useState<SetupStatus | null | undefined>(undefined);

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
  if (st === null) return <p className="small muted">Add-ons can be installed when AuthorDesk runs from AuthorDesk.exe.</p>;

  const install = async (id: AddonId) => {
    if (st.freeGb >= 0 && st.freeGb < spaceNeeded([id])) return toast(`${ADDONS[id].label} needs about ${spaceNeeded([id])} GB free; this PC has ${st.freeGb} GB.`);
    const next = await installAddons([id]);
    if (!next) return toast('Couldn’t start the installer.');
    setSt(next);
    window.dispatchEvent(new Event(SETUP_STARTED));
  };

  return (
    <div className="addon-settings">
      <p className="small">Optional, open-source and private: both run on this PC, with no account or subscription.</p>
      <ul className="addon-list">
        {ADDON_ORDER.map((id) => {
          const p = st.parts[id];
          if (!p) return null;
          return (
            <li key={id}>
              <div className="row gap">
                <strong>{ADDONS[id].label}</strong>
                <span className="grow" />
                {p.installed && p.state !== 'installing' ? (
                  <span className="small ok-text">Installed ✓</span>
                ) : p.state === 'installing' || p.state === 'queued' ? (
                  <span className="small muted">
                    {p.state === 'queued' ? 'Waiting…' : p.step || 'Starting…'}
                    {p.percent >= 0 ? ` ${p.percent}%` : ''}
                  </span>
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
            </li>
          );
        })}
      </ul>
      <label className="check small">
        <input type="checkbox" checked={s.addonPrompt === 'ask'} onChange={(e) => void updateSettings({ addonPrompt: e.target.checked ? 'ask' : 'never' })} /> Offer
        to install missing add-ons when AuthorDesk starts
      </label>
    </div>
  );
}
