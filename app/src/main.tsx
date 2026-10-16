import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/app.css';
import { getSettings, requestPersistentStorage } from './storage/settings';
import { applyTheme, resolveTheme } from './ui/theme';
import { runMigrations } from './storage/migrations';
import { repairUntitledBooks } from './storage/repo';
import { adoptLocalEngine } from './proofreading/grammarEngine';
import { startAutoBackup } from './backup/autoBackup';
import { registerSW } from 'virtual:pwa-register';
import { detectServer } from './sync/controller';
import { toast } from './ui/store';

async function start() {
  await runMigrations();
  await repairUntitledBooks().catch((e) => console.warn('Could not repair book titles', e));
  // Apply the theme before the first paint so there is no flash of the wrong colours.
  const s = await getSettings();
  applyTheme(resolveTheme(s.theme, s.customThemes, window.matchMedia('(prefers-color-scheme: dark)').matches));
  void requestPersistentStorage();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  // After an update the new build takes over on its own. Straight away if nothing has been typed yet; otherwise the
  // author chooses when, so a reload never lands mid-sentence. A copy left open for days still hears about updates.
  let typed = false;
  window.addEventListener('keydown', () => (typed = true), { once: true, capture: true });
  registerSW({
    immediate: true,
    onNeedReload() {
      if (!typed) return window.location.reload();
      toast('A new version of AuthorDesk is ready.', { action: { label: 'Reload', run: () => window.location.reload() }, ms: 30 * 60_000 });
    },
    onRegisteredSW(_url, reg) {
      if (reg) setInterval(() => void reg.update().catch(() => undefined), 60 * 60_000);
    },
  });
  void detectServer();
  void adoptLocalEngine();
  startAutoBackup();
}

start().catch((e) => {
  document.getElementById('root')!.innerHTML = `<div style="padding:2rem;font-family:sans-serif"><h1>AuthorDesk could not start</h1><p>${String(
    e instanceof Error ? e.message : e,
  ).replace(/</g, '&lt;')}</p><p>Your data has not been changed. Try reloading. If this keeps happening, use a different browser profile to export a backup.</p></div>`;
});
