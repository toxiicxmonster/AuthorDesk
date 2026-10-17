import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { updateSettings, useSettings } from '../../storage/settings';
import { CATEGORIES, CATEGORY_LABELS } from '../../proofreading/types';
import { useProjectTable } from '../data';
import { createRecord, deleteRecord } from '../../storage/repo';
import { db } from '../../storage/db';
import { useArchiveImport } from '../components/ImportPanel';
import { confirmDialog, promptDialog, toast } from '../store';
import { ARCHIVE_EXTENSION } from '../../importExport/archive';
import { ThemePicker } from '../components/ThemePicker';
import { OnlineCheckSettings } from '../components/OnlineCheck';
import { AiEditorSettings } from '../components/AiEditorSettings';
import { AddonSettings } from '../components/AddonSettings';
import { ruleLabel } from '../../proofreading/rules';
import { isPublicEndpoint } from '../../proofreading/languageTool';
import { isDesktopApp, storagePlace } from '../platform';
import { useSyncUi } from '../../sync/controller';

const SHORTCUTS: [string, string][] = [
  ['Ctrl+K or Ctrl+Shift+F', 'Search everything'],
  ['Ctrl+F', 'Find & replace in the current scene'],
  ['Ctrl+Shift+H', 'Find & replace in the whole book (rename a character everywhere)'],
  ['Ctrl+S', 'Save now (work also autosaves continuously)'],
  ['Alt+PageDown / Alt+PageUp', 'Next / previous chapter'],
  ['Alt+Shift+PageDown / PageUp', 'Next / previous scene'],
  ['Ctrl+Alt+F', 'Focus mode (Esc to exit)'],
  ['Ctrl+\\', 'Show / hide the chapter list'],
  ['Ctrl+B / Ctrl+I / Ctrl+U', 'Bold / italic / underline'],
  ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
];

export function SettingsPage({ projectId }: { projectId: string | null }) {
  const s = useSettings();
  const sync = useSyncUi();
  const importer = useArchiveImport();
  return (
    <div className="page narrow settings-page">
      <h1>Settings</h1>
      <section className="card">
        <h2>Theme</h2>
        <ThemePicker />
      </section>

      <section className="card">
        <h2>Writing page</h2>
        <div className="page-settings">
          <div className="page-controls">
            <label className="field">
              <span>Font</span>
              <select value={s.fontFamily} onChange={(e) => void updateSettings({ fontFamily: e.target.value as typeof s.fontFamily })}>
                <option value="serif">Book (serif)</option>
                <option value="sans">Clean (sans-serif)</option>
              </select>
            </label>
            <label className="field">
              <span>Text size: {s.fontSize}px</span>
              <input type="range" min={14} max={28} value={s.fontSize} onChange={(e) => void updateSettings({ fontSize: Number(e.target.value) })} aria-valuetext={`${s.fontSize} pixels`} />
            </label>
            <label className="field">
              <span>Line spacing: {s.lineHeight.toFixed(1)}</span>
              <input type="range" min={1.2} max={2.4} step={0.1} value={s.lineHeight} onChange={(e) => void updateSettings({ lineHeight: Number(e.target.value) })} />
            </label>
            <label className="field">
              <span>Page width</span>
              <select value={s.pageWidth} onChange={(e) => void updateSettings({ pageWidth: e.target.value as typeof s.pageWidth })}>
                <option value="narrow">Narrow (like a paperback)</option>
                <option value="medium">Medium</option>
                <option value="wide">Wide</option>
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={s.pacingStrip} onChange={(e) => void updateSettings({ pacingStrip: e.target.checked })} /> Pacing strip beside the page
              (each sentence’s length, dialogue and narration; click it to jump)
            </label>
          </div>
          <div
            className="page-preview"
            style={{
              fontFamily: s.fontFamily === 'sans' ? 'var(--sans)' : 'var(--serif)',
              fontSize: s.fontSize,
              lineHeight: s.lineHeight,
            }}
            aria-label="Preview of the writing page"
          >
            <p>The lamp ticked like a patient clock. She trimmed the wick, wiped the salt from the glass, and that was when she saw the letters scratched into the lens.</p>
            <p>Not here. Look below.</p>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Proofreading</h2>
        <label className="check">
          <input type="checkbox" checked={s.proofreadEnabled} onChange={(e) => void updateSettings({ proofreadEnabled: e.target.checked })} /> Show writing suggestions
        </label>
        <label className="field inline">
          <span>English</span>
          <select value={s.dialect} onChange={(e) => void updateSettings({ dialect: e.target.value as typeof s.dialect })}>
            <option value="en-US">US English</option>
            <option value="en-GB">UK English</option>
          </select>
        </label>
        <fieldset className="field">
          <legend>Check for</legend>
          <div className="check-grid">
            {CATEGORIES.map((c) => (
              <label key={c} className="check">
                <input
                  type="checkbox"
                  checked={!s.disabledCategories.includes(c)}
                  onChange={(e) =>
                    void updateSettings({ disabledCategories: e.target.checked ? s.disabledCategories.filter((x) => x !== c) : [...s.disabledCategories, c] })
                  }
                />{' '}
                {CATEGORY_LABELS[c]}
              </label>
            ))}
          </div>
        </fieldset>
        {s.disabledRules.length > 0 && (
          <div className="field">
            <span>Checks you turned off</span>
            <ul className="turned-off">
              {s.disabledRules.map((id) => (
                <li key={id}>
                  {ruleLabel(id)}{' '}
                  <button className="small" onClick={() => void updateSettings({ disabledRules: s.disabledRules.filter((x) => x !== id) })}>
                    Turn back on
                  </button>
                </li>
              ))}
            </ul>
            {s.disabledRules.length > 1 && (
              <button className="small" onClick={() => void updateSettings({ disabledRules: [] })}>
                Turn all back on
              </button>
            )}
          </div>
        )}
        {/* The desktop app has its own engine with the browser's spell check switched off (it would download dictionaries). */}
        {!isDesktopApp && (
          <label className="check">
            <input type="checkbox" checked={s.browserSpellcheck} onChange={(e) => void updateSettings({ browserSpellcheck: e.target.checked })} /> Also use the
            browser’s built-in spell check (red squiggles from Chrome/Edge)
          </label>
        )}
        <p className="muted small">
          Underlines appear as you write, a moment after you pause. The standard checks run on this device with a bundled dictionary and never send text anywhere.
        </p>
        <OnlineCheckSettings />
        <AiEditorSettings />
        {projectId && <DictionaryEditor projectId={projectId} />}
      </section>

      <section className="card">
        <h2>Add-ons</h2>
        <AddonSettings />
      </section>

      <section className="card">
        <h2>Keyboard shortcuts</h2>
        <dl className="shortcuts">
          {SHORTCUTS.map(([k, d]) => (
            <div key={k}>
              <dt>
                <kbd>{k}</kbd>
              </dt>
              <dd>{d}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="card">
        <h2>Restore a backup</h2>
        <label className="button">
          Choose archive ({ARCHIVE_EXTENSION})…
          <input type="file" accept={`${ARCHIVE_EXTENSION},.zip`} hidden onChange={(e) => e.target.files?.[0] && void importer.loadFile(e.target.files[0]).finally(() => (e.target.value = ''))} />
        </label>
      </section>

      <section className="card">
        <h2>Privacy</h2>
        <ul className="small">
          <li>
            <strong>Stored on this device:</strong> all projects, manuscript text, references, planning data, history snapshots and settings, in{' '}
            {isDesktopApp ? 'AuthorDesk’s own storage on this computer' : 'this browser’s private storage (IndexedDB)'}. Nothing is uploaded automatically.
          </li>
          <li>
            <strong>Sent to sync storage:</strong>{' '}
            {sync.server === 'signed-in'
              ? `your projects, to your own sync server (signed in as ${sync.username ?? 'you'}).`
              : 'nothing — you are not signed in to a sync server.'}
          </li>
          <li>
            <strong>Sent to Google Drive:</strong> only backups you explicitly create after connecting, using access limited to files AuthorDesk creates.
          </li>
          <li>
            <strong>Online grammar check:</strong>{' '}
            {s.onlineCheck.enabled && s.onlineCheck.consentedAt
              ? `on — paragraphs of the scene you are editing are sent to ${isPublicEndpoint(s.onlineCheck.endpoint) ? 'LanguageTool (api.languagetool.org)' : 'your LanguageTool server'} for checking.`
              : 'off — proofreading runs entirely on this device.'}
          </li>
          <li>
            <strong>Third parties:</strong> {s.onlineCheck.enabled && s.onlineCheck.consentedAt && isPublicEndpoint(s.onlineCheck.endpoint) ? 'LanguageTool only, as above.' : 'none.'} No
            analytics, no tracking, and your writing is never used for training.
          </li>
          <li>Backups and exports you save are ordinary files that you control; deleting data here doesn’t delete them.</li>
        </ul>
        <DangerZone />
      </section>
      <p className="muted small">AuthorDesk v{__APP_VERSION__}</p>
      {importer.modal}
    </div>
  );
}

function DictionaryEditor({ projectId }: { projectId: string }) {
  const dict = useProjectTable('dictionary', projectId);
  const ignoredCount = useLiveQuery(() => db.ignored.where('projectId').equals(projectId).count(), [projectId]) ?? 0;
  const [word, setWord] = useState('');
  return (
    <div className="dictionary">
      <h3>Custom dictionary (this project)</h3>
      <p className="muted small">Invented names and terms. Names in your References are recognized automatically.</p>
      <form
        className="row gap"
        onSubmit={async (e) => {
          e.preventDefault();
          const w = word.trim();
          if (!w) return;
          if (dict.some((d) => d.word.toLowerCase() === w.toLowerCase())) return toast('Already in the dictionary');
          await createRecord('dictionary', projectId, { word: w });
          setWord('');
        }}
      >
        <input value={word} onChange={(e) => setWord(e.target.value)} placeholder="Add a word" aria-label="Add a word to the dictionary" />
        <button type="submit">Add</button>
      </form>
      <div className="chips">
        {dict
          .slice()
          .sort((a, b) => a.word.localeCompare(b.word))
          .map((d) => (
            <span key={d.id} className="chip">
              {d.word}
              <button className="chip-x" aria-label={`Remove ${d.word}`} onClick={() => void deleteRecord('dictionary', d.id)}>
                ✕
              </button>
            </span>
          ))}
      </div>
      {ignoredCount > 0 && (
        <p className="small">
          {ignoredCount} individually ignored suggestion{ignoredCount === 1 ? '' : 's'}.{' '}
          <button className="small" onClick={() => void db.ignored.where('projectId').equals(projectId).delete()}>
            Show them again
          </button>
        </p>
      )}
    </div>
  );
}

function DangerZone() {
  return (
    <div className="danger-zone">
      <h3>Clear all local data</h3>
      <p className="small">Removes every project from {storagePlace}. Make sure you have backups first.</p>
      <button
        className="danger"
        onClick={async () => {
          const ok = await confirmDialog('Erase everything on this device?', `All projects, history and settings in ${storagePlace} will be permanently deleted. Exported backups are not affected.`, {
            confirmLabel: 'Continue',
            danger: true,
          });
          if (!ok) return;
          const typed = await promptDialog('Type ERASE to confirm', 'Confirmation', '', 'Erase all data');
          if (typed !== 'ERASE') {
            if (typed !== null) toast('Nothing was deleted.');
            return;
          }
          await db.delete();
          try {
            localStorage.clear();
          } catch {
            /* ignore */
          }
          location.href = location.pathname;
        }}
      >
        Erase all local data…
      </button>
    </div>
  );
}
