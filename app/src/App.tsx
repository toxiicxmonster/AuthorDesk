import { lazy, Suspense, useEffect } from 'react';
import { href, navigate, useRoute, type View } from './ui/router';
import { getUi, setUi, useUi } from './ui/store';
import { useProject } from './ui/data';
import { DialogHost, ToastHost } from './ui/components/common';
import { HomePage } from './ui/pages/HomePage';
import { WritePage } from './ui/pages/WritePage';

// Home and Write load with the app; other pages (and their export/import code) load the first time they are opened.
const BoardPage = lazy(() => import('./ui/pages/BoardPage').then((m) => ({ default: m.BoardPage })));
const ReferencesPage = lazy(() => import('./ui/pages/ReferencesPage').then((m) => ({ default: m.ReferencesPage })));
const TimelinePage = lazy(() => import('./ui/pages/TimelinePage').then((m) => ({ default: m.TimelinePage })));
const ThreadsPage = lazy(() => import('./ui/pages/ThreadsPage').then((m) => ({ default: m.ThreadsPage })));
const NotesPage = lazy(() => import('./ui/pages/NotesPage').then((m) => ({ default: m.NotesPage })));
const SearchPage = lazy(() => import('./ui/pages/SearchPage').then((m) => ({ default: m.SearchPage })));
const DataPage = lazy(() => import('./ui/pages/DataPage').then((m) => ({ default: m.DataPage })));
const SettingsPage = lazy(() => import('./ui/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
import { useSettings, updateSettings } from './storage/settings';
import { flushAllEdits } from './editor/EditorContext';
import { useSyncStatus } from './sync/useSyncStatus';
import { applyTheme, resolveTheme } from './ui/theme';
import { QuickSwitcher } from './ui/components/QuickSwitcher';
import { HelpDialog } from './ui/components/HelpDialog';
import { ThemeQuickButton } from './ui/components/ThemeQuickButton';
import { Icon, type IconName } from './ui/components/Icon';

const NAV: [View, string, IconName, string][] = [
  ['home', 'Home', 'home', 'Your book at a glance'],
  ['write', 'Write', 'write', 'Write your manuscript'],
  ['board', 'Board', 'board', 'Story board: plan with cards'],
  ['refs', 'World', 'people', 'Characters, places & world notes'],
  ['timeline', 'Timeline', 'timeline', 'When things happen in your story'],
  ['threads', 'Threads', 'threads', 'Plot threads across chapters'],
  ['notes', 'Notes', 'notes', 'Research & notes'],
  ['data', 'Backup', 'backup', 'Backup, export & sync'],
];

const MOBILE_NAV: [View | 'jump', string, IconName][] = [
  ['write', 'Write', 'write'],
  ['board', 'Board', 'board'],
  ['refs', 'World', 'people'],
  ['jump', 'Jump to', 'search'],
  ['home', 'More', 'menu'],
];

export function App() {
  const route = useRoute();
  const project = useProject(route.projectId);
  const settings = useSettings();
  const saveStatus = useUi((s) => s.saveStatus);
  const saveError = useUi((s) => s.saveError);
  const focusMode = useUi((s) => s.focusMode);
  const online = useUi((s) => s.online);
  const sync = useSyncStatus(route.projectId);

  // Theme (re-applied when the OS switches light/dark while on 'Match system')
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => applyTheme(resolveTheme(settings.theme, settings.customThemes, mq.matches));
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [settings.theme, settings.customThemes]);

  // Remember last project
  useEffect(() => {
    if (route.projectId && project && settings.lastProjectId !== route.projectId) void updateSettings({ lastProjectId: route.projectId });
  }, [route.projectId, project, settings.lastProjectId]);

  // Online/offline + unsaved-change protection
  useEffect(() => {
    const on = () => setUi({ online: true });
    const off = () => setUi({ online: false });
    const beforeUnload = (e: BeforeUnloadEvent) => {
      const st = getUi().saveStatus;
      if (st === 'unsaved' || st === 'saving' || st === 'error') {
        void flushAllEdits();
        e.preventDefault();
      }
    };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, []);

  // Global shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setUi((s) => ({ searchOpen: !s.searchOpen }));
      } else if (route.projectId && mod && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        void flushAllEdits().then(() => navigate(route.projectId, 'search'));
      } else if (e.key === 'F1' || (mod && e.key === '/')) {
        e.preventDefault();
        setUi((s) => ({ helpOpen: !s.helpOpen }));
      } else if (e.key === 'Escape' && getUi().focusMode && !getUi().dialog) {
        setUi({ focusMode: false });
      } else if (mod && e.key === '\\') {
        e.preventDefault();
        setUi((s) => ({ leftOpen: !s.leftOpen }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [route.projectId]);

  // Missing project (deleted or bad link)
  useEffect(() => {
    if (route.projectId && project === null) navigate(null);
  }, [route.projectId, project]);

  const pid = route.projectId;
  const view = route.view;

  let page: React.ReactNode;
  if (!pid) page = view === 'settings' ? <SettingsPage projectId={null} /> : <HomePage projectId={null} />;
  else if (!project) page = <p className="pad muted">Loading…</p>;
  else {
    switch (view) {
      case 'write':
        page = <WritePage projectId={pid} sceneId={route.itemId} initialFind={route.params.get('find')} />;
        break;
      case 'board':
        page = <BoardPage projectId={pid} focusId={route.itemId} />;
        break;
      case 'refs':
        page = <ReferencesPage projectId={pid} selectedId={route.itemId} newType={route.params.get('new')} />;
        break;
      case 'timeline':
        page = <TimelinePage projectId={pid} selectedId={route.itemId} />;
        break;
      case 'threads':
        page = <ThreadsPage projectId={pid} selectedId={route.itemId} />;
        break;
      case 'notes':
        page = <NotesPage projectId={pid} selectedId={route.itemId} />;
        break;
      case 'search':
        page = <SearchPage projectId={pid} initialQuery={route.params.get('q') ?? ''} />;
        break;
      case 'data':
        page = <DataPage projectId={pid} autoImportHelp={route.params.get('import') === '1'} autoKdp={route.params.get('kdp') === '1'} />;
        break;
      case 'settings':
        page = <SettingsPage projectId={pid} />;
        break;
      default:
        page = <HomePage projectId={pid} />;
    }
  }

  const saveLabel =
    saveStatus === 'saved' ? 'All changes saved' : saveStatus === 'saving' ? 'Saving…' : saveStatus === 'unsaved' ? 'Saving soon…' : 'Not saved — retrying';

  return (
    <div className={`app view-${view}${focusMode ? ' focus' : ''}`}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      {!focusMode && (
        <header className="topbar">
          {pid && view === 'write' && (
            <button className="icon-btn" aria-label="Show or hide the chapter list (Ctrl+\)" title="Chapters (Ctrl+\)" onClick={() => setUi((s) => ({ leftOpen: !s.leftOpen }))}>
              <Icon name="menu" />
            </button>
          )}
          <a className="brand" href={href(pid, 'home')} title="Home">
            <img src="./icon.svg" alt="" width={22} height={22} />
            <span className="brand-name">{project?.name ?? 'AuthorDesk'}</span>
          </a>
          {pid && (
            <nav className="topnav" aria-label="Sections">
              {NAV.map(([v, label, icon, hint]) => (
                <a
                  key={v}
                  href={href(pid, v)}
                  className={view === v ? 'on' : ''}
                  aria-current={view === v ? 'page' : undefined}
                  aria-label={hint}
                  title={hint}
                  onClick={() => void flushAllEdits()}
                >
                  <Icon name={icon} size={17} /> <span className="nav-label">{label}</span>
                </a>
              ))}
            </nav>
          )}
          <div className="top-right">
            <button className="jump-btn" onClick={() => setUi({ searchOpen: true })} aria-label="Jump to anything (Ctrl+K)" title="Jump to a chapter, character, note or command">
              <Icon name="search" size={16} /> <span className="jump-label">Jump to…</span> <kbd>Ctrl K</kbd>
            </button>
            {pid && (
              <>
                <span className={`save-badge s-${saveStatus}`} role="status" title={saveError ?? (saveStatus === 'saved' ? 'All changes are saved on this computer' : saveLabel)}>
                  {saveStatus === 'error' ? '⚠ ' : saveStatus === 'saved' ? '✓ ' : ''}
                  {saveStatus === 'saved' ? 'Saved' : saveLabel}
                </span>
                <a className={`sync-badge sy-${online ? sync.state : 'offline'}`} href={href(pid, 'data')} title={sync.detail}>
                  {online ? sync.label : 'Offline'}
                </a>
              </>
            )}
            {pid && view === 'write' && (
              <button className="icon-btn" aria-label="Show or hide the side panel" title="Look up, scene notes, suggestions & versions" onClick={() => setUi((s) => ({ rightOpen: !s.rightOpen }))}>
                <Icon name="panel" />
              </button>
            )}
            <ThemeQuickButton />
            <button className="icon-btn" aria-label="Help" title="Help & shortcuts (F1)" onClick={() => setUi({ helpOpen: true })}>
              <Icon name="help" />
            </button>
            <a className="icon-btn" href={pid ? href(pid, 'settings') : '#/settings'} aria-label="Settings" title="Settings">
              <Icon name="settings" />
            </a>
          </div>
        </header>
      )}
      {saveStatus === 'error' && (
        <div className="banner error" role="alert">
          Your latest changes could not be saved on this device: {saveError}. AuthorDesk will keep retrying. Don’t close this window; consider
          copying the text as a precaution.
        </div>
      )}
      <div className="page-wrap">
        <Suspense fallback={<p className="muted page-loading">Loading…</p>}>{page}</Suspense>
      </div>
      {focusMode && (
        <button className="exit-focus" onClick={() => setUi({ focusMode: false })}>
          Exit focus (Esc)
        </button>
      )}
      {pid && !focusMode && (
        <nav className="bottomnav" aria-label="Sections">
          {MOBILE_NAV.map(([v, label, icon]) =>
            v === 'jump' ? (
              <button key={v} onClick={() => setUi({ searchOpen: true })}>
                <Icon name={icon} size={20} />
                <span>{label}</span>
              </button>
            ) : (
              <a key={v} href={href(pid, v)} className={view === v ? 'on' : ''} aria-current={view === v ? 'page' : undefined} onClick={() => void flushAllEdits()}>
                <Icon name={icon} size={20} />
                <span>{label}</span>
              </a>
            ),
          )}
        </nav>
      )}
      <QuickSwitcher projectId={pid && project ? pid : null} />
      <HelpDialog />
      <DialogHost />
      <ToastHost />
    </div>
  );
}
