import { useEffect, useRef, useState } from 'react';
import { ADDONS, ADDON_ORDER, busy, fetchSetupStatus, installAddons, missing, spaceNeeded, type AddonId, type SetupStatus } from '../../setup/addons';
import { adoptLocalEngine } from '../../proofreading/grammarEngine';
import { updateSettings, useSettings } from '../../storage/settings';
import { toast } from '../store';
import { Modal } from './common';

/** Fired when an install is started elsewhere (Settings), so the progress card picks it up straight away. */
export const SETUP_STARTED = 'authordesk:setup-started';

let offeredThisSession = false;

/** For tests: forget that the setup was already offered this session. */
export function resetAddonOffer() {
  offeredThisSession = false;
}

/**
 * First launch (and later launches, until installed or declined): offers the private add-ons, then installs them in
 * the background with a small progress card. Each switches on as soon as its part finishes.
 */
export function AddonSetup() {
  const settings = useSettings();
  const [st, setSt] = useState<SetupStatus | null>(null);
  const [offer, setOffer] = useState(false);
  const [chosen, setChosen] = useState<AddonId[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const prev = useRef<SetupStatus | null>(null);

  useEffect(() => {
    let alive = true;
    let timer = 0;
    const tick = async () => {
      window.clearTimeout(timer);
      const s = await fetchSetupStatus();
      if (!alive) return;
      if (s) announce(prev.current, s);
      prev.current = s;
      setSt(s);
      if (s && busy(s).length) timer = window.setTimeout(() => void tick(), 1500);
    };
    void tick();
    const onStart = () => void tick();
    window.addEventListener(SETUP_STARTED, onStart);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      window.removeEventListener(SETUP_STARTED, onStart);
    };
  }, []);

  // Offer once per launch, while something is missing and nothing is installing.
  useEffect(() => {
    if (!st || offeredThisSession || settings.addonPrompt !== 'ask') return;
    const todo = missing(st);
    if (!todo.length || busy(st).length) return;
    offeredThisSession = true;
    setChosen(todo);
    setOffer(true);
  }, [st, settings.addonPrompt]);

  if (!st) return null;
  const installing = busy(st);

  const start = async (ids: AddonId[]) => {
    setOffer(false);
    if (!ids.length) return;
    const s = await installAddons(ids);
    if (s) {
      prev.current = s;
      setSt(s);
      window.dispatchEvent(new Event(SETUP_STARTED));
    } else toast('Couldn’t start the installer. Try again from Settings → Add-ons.');
  };

  const need = spaceNeeded(chosen);
  const tooFull = st.freeGb >= 0 && st.freeGb < need;

  return (
    <>
      {offer && (
        <Modal title="Set up AuthorDesk’s private add-ons?" onClose={() => setOffer(false)}>
          <p>
            {missing(st).length > 1 ? 'AuthorDesk can install two add-ons that run' : 'AuthorDesk can install an add-on that runs'} entirely on this PC: open-source, no
            account or subscription, and nothing you write is sent anywhere. {missing(st).length > 1 ? 'They download' : 'It downloads'} in the background while you
            write and {missing(st).length > 1 ? 'switch on as soon as each is ready' : 'switches on as soon as it’s ready'}.
          </p>
          <ul className="addon-list">
            {missing(st).map((id) => (
              <li key={id}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={chosen.includes(id)}
                    onChange={(e) => {
                      const on = e.target.checked; // read now: React resets a controlled checkbox before the update runs
                      setChosen((c) => (on ? ADDON_ORDER.filter((x) => x === id || c.includes(x)) : c.filter((x) => x !== id)));
                    }}
                  />{' '}
                  <strong>{ADDONS[id].label}</strong> <span className="muted small">· about {ADDONS[id].download} GB download</span>
                </label>
                <span className="block small muted">{ADDONS[id].what}</span>
              </li>
            ))}
          </ul>
          <p className={`small${tooFull ? ' danger-text' : ' muted'}`}>
            {chosen.length
              ? `Needs about ${need} GB of free space while installing (${chosen.reduce((n, id) => n + ADDONS[id].disk, 0)} GB once installed). `
              : ''}
            {st.freeGb >= 0 && `This PC has ${st.freeGb} GB free.`}
            {tooFull && ' Free up some space, or untick an add-on.'}
          </p>
          <div className="dialog-actions">
            <button
              className="link-btn"
              onClick={() => {
                setOffer(false);
                void updateSettings({ addonPrompt: 'never' });
                toast('Got it. You can install the add-ons any time from Settings → Add-ons.');
              }}
            >
              Don’t ask again
            </button>
            <span className="grow" />
            <button onClick={() => setOffer(false)}>Not now</button>
            <button className="primary" disabled={!chosen.length || tooFull} onClick={() => void start(chosen)}>
              Install
            </button>
          </div>
        </Modal>
      )}

      {installing.length > 0 && (
        <aside className={`setup-progress${collapsed ? ' collapsed' : ''}`} aria-live="polite">
          <button className="link-btn setup-toggle" onClick={() => setCollapsed((c) => !c)}>
            {collapsed ? 'Show' : 'Hide'}
          </button>
          {installing.map((id) => {
            const p = st.parts[id];
            return (
              <div key={id} className="setup-item">
                <div className="small">
                  <strong>{ADDONS[id].label}</strong>
                  <span className="muted">
                    {' '}
                    · {p.state === 'queued' ? 'waiting its turn' : p.step || 'starting…'}
                    {p.percent >= 0 ? ` ${p.percent}%` : ''}
                  </span>
                </div>
                {!collapsed && (
                  <div className={`setup-bar${p.percent < 0 ? ' indeterminate' : ''}`}>
                    <span style={{ width: `${p.percent < 0 ? 100 : p.percent}%` }} />
                  </div>
                )}
              </div>
            );
          })}
          {!collapsed && <p className="small muted">Keep writing: AuthorDesk only needs to stay open. If you close it, the download picks up where it left off next time.</p>}
        </aside>
      )}
    </>
  );
}

/** Tells the author when an add-on finishes (and switches the grammar engine on), or why it didn't. */
function announce(before: SetupStatus | null, now: SetupStatus) {
  if (!before) return;
  for (const id of ADDON_ORDER) {
    const was = before.parts[id]?.state;
    const is = now.parts[id]?.state;
    if (was === is || (was !== 'installing' && was !== 'queued')) continue;
    if (is === 'done') {
      if (id === 'grammar') {
        void adoptLocalEngine();
        toast('The grammar engine is ready. Deeper grammar checks are on, all on this PC.');
      } else toast('The AI Editor is ready. Open it from the side panel, or click a flagged adverb.');
    } else if (is === 'failed') {
      toast(`${ADDONS[id].label} couldn’t finish installing: ${now.parts[id].message} It will be offered again next time, or install it from Settings → Add-ons.`);
    }
  }
}
