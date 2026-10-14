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
  registerSW({ immediate: true });
  void detectServer();
  void adoptLocalEngine();
  startAutoBackup();
}

start().catch((e) => {
  document.getElementById('root')!.innerHTML = `<div style="padding:2rem;font-family:sans-serif"><h1>AuthorDesk could not start</h1><p>${String(
    e instanceof Error ? e.message : e,
  ).replace(/</g, '&lt;')}</p><p>Your data has not been changed. Try reloading. If this keeps happening, use a different browser profile to export a backup.</p></div>`;
});
