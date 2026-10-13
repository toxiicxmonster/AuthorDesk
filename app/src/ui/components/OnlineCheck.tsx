import { useEffect, useState } from 'react';
import { updateSettings, useSettings } from '../../storage/settings';
import { LT_PUBLIC_ENDPOINT, endpointProblem, isPublicEndpoint } from '../../proofreading/languageTool';
import { Modal } from './common';
import { toast } from '../store';
import { fetchEngineStatus, isLocalEngine, switchToLocalEngine, type EngineStatus } from '../../proofreading/grammarEngine';

/** Settings → Proofreading: the optional online grammar check, with an explicit, informed opt-in. */
export function OnlineCheckSettings() {
  const s = useSettings();
  const oc = s.onlineCheck;
  const on = oc.enabled && !!oc.consentedAt;
  const [asking, setAsking] = useState(false);
  const [endpoint, setEndpoint] = useState(oc.endpoint);
  const [ownServer, setOwnServer] = useState(!isPublicEndpoint(oc.endpoint));
  const problem = ownServer ? endpointProblem(endpoint) : null;
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const local = on && isLocalEngine(oc.endpoint);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const st = await fetchEngineStatus();
      if (!alive) return;
      setEngine(st);
      // While it warms up, keep the status current.
      if (st?.starting) window.setTimeout(() => void poll(), 3000);
    };
    void poll();
    return () => {
      alive = false;
    };
  }, []);

  const turnOn = async () => {
    const chosen = ownServer ? endpoint.trim() : LT_PUBLIC_ENDPOINT;
    if (endpointProblem(chosen)) return;
    await updateSettings({ onlineCheck: { ...oc, enabled: true, endpoint: chosen, consentedAt: new Date().toISOString() } });
    setAsking(false);
    toast('Online grammar check is on. Underlines from it appear a moment after you pause typing.');
  };
  const turnOff = async () => {
    await updateSettings({ onlineCheck: { ...oc, enabled: false, consentedAt: null, localEngineOptOut: local || oc.localEngineOptOut } });
    toast(local ? 'Grammar engine is off. On-device checks still run.' : 'Online grammar check is off. Nothing more will be sent.');
  };
  const pickEngine = async () => {
    await switchToLocalEngine();
    toast('Using the grammar engine on this computer. Nothing leaves this PC.');
  };

  return (
    <fieldset className="field online-check">
      <legend>Deep grammar check</legend>
      <p className="small">
        Adds full-sentence grammar, punctuation, word-choice and style checks from <strong>LanguageTool</strong>. On-device checks keep working either way.
      </p>
      <p className="small">
        Status:{' '}
        <strong>
          {on
            ? `On — ${local ? 'grammar engine on this computer (private)' : isPublicEndpoint(oc.endpoint) ? 'LanguageTool’s free online service' : `your server (${hostOf(oc.endpoint)})`}`
            : 'Off — nothing is sent'}
        </strong>
      </p>
      <EngineCard engine={engine} active={local} onUse={() => void pickEngine()} />
      {on ? (
        <>
          <label className="check">
            <input type="checkbox" checked={oc.picky} onChange={(e) => void updateSettings({ onlineCheck: { ...oc, picky: e.target.checked } })} /> Picky mode (more
            style and typography suggestions)
          </label>
          <button onClick={() => void turnOff()}>{local ? 'Turn off grammar engine' : 'Turn off online check'}</button>
        </>
      ) : (
        <button onClick={() => setAsking(true)}>Use LanguageTool online instead…</button>
      )}

      {asking && (
        <Modal title="Send text for an online grammar check?" onClose={() => setAsking(false)}>
          <p>When this is on, AuthorDesk sends text from the scene you are writing to a LanguageTool server so it can suggest corrections.</p>
          <ul className="small">
            <li>
              <strong>What is sent:</strong> the paragraphs of the scene open in the editor, a moment after you pause typing. Only paragraphs that changed are sent
              again.
            </li>
            <li>
              <strong>Never sent:</strong> other scenes, titles, notes, character and world entries, your dictionary, or anything about you.
            </li>
            <li>
              <strong>Where it goes:</strong>{' '}
              {ownServer ? (
                'the LanguageTool server address you enter below.'
              ) : (
                <>
                  LanguageTool’s free public service (api.languagetool.org, run by LanguageTool GmbH). Their privacy policy says checked text isn’t stored, but it
                  does leave this computer.
                </>
              )}
            </li>
            <li>
              <strong>Free limits:</strong> about 20 checks a minute. AuthorDesk stays under that; if you paste a lot at once, the rest is checked a little later.
            </li>
            <li>Suggestions are only suggestions. Nothing in your text changes unless you click a fix. You can turn this off at any time.</li>
          </ul>
          <label className="check">
            <input type="checkbox" checked={ownServer} onChange={(e) => setOwnServer(e.target.checked)} /> Use my own LanguageTool server instead (keeps text on
            machines you control)
          </label>
          {ownServer && (
            <label className="field">
              <span>Server address</span>
              <input value={endpoint === LT_PUBLIC_ENDPOINT ? '' : endpoint} placeholder="http://localhost:8081/v2/check" onChange={(e) => setEndpoint(e.target.value)} />
              {problem && endpoint !== LT_PUBLIC_ENDPOINT && <span className="danger-text small">{problem}</span>}
              <span className="muted small">
                For example, LanguageTool running on this PC with Docker: <code>docker run -p 8081:8010 erikvl87/languagetool</code>
              </span>
            </label>
          )}
          <div className="dialog-actions">
            <button onClick={() => setAsking(false)}>Cancel</button>
            <button className="primary" disabled={ownServer && (!!problem || endpoint === LT_PUBLIC_ENDPOINT)} onClick={() => void turnOn()}>
              Turn on and send text
            </button>
          </div>
        </Modal>
      )}
    </fieldset>
  );
}

/** The private engine: what state it's in, and how to get it. */
function EngineCard({ engine, active, onUse }: { engine: EngineStatus | null; active: boolean; onUse: () => void }) {
  if (!engine) return null; // not running under the AuthorDesk launcher
  if (!engine.installed) {
    return (
      <div className="card small">
        <strong>Grammar engine on this computer: not installed.</strong> For the most thorough checking, with nothing leaving this PC, run{' '}
        <code>scripts\install-grammar-engine.ps1</code> from the AuthorDesk folder (about 9 GB), then restart AuthorDesk.
      </div>
    );
  }
  const state = engine.ready ? 'ready' : engine.starting ? 'starting up (this takes up to a minute)…' : 'not running — restart AuthorDesk';
  return (
    <div className="card small">
      <strong>Grammar engine on this computer:</strong> {state}
      {engine.ngrams ? ' · with English usage data' : ' · without usage data (re-run the installer to add it)'}
      {!active && (
        <div>
          <button className="primary" onClick={onUse}>
            Use it (private, no limits)
          </button>
        </div>
      )}
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
