import { useSyncExternalStore } from 'react';

export type View =
  | 'home'
  | 'write'
  | 'board'
  | 'refs'
  | 'timeline'
  | 'threads'
  | 'notes'
  | 'search'
  | 'review'
  | 'data'
  | 'settings';

export interface Route {
  projectId: string | null;
  view: View;
  /** Selected item id: scene for write, reference for refs, etc. */
  itemId: string | null;
  params: URLSearchParams;
}

const VIEWS: View[] = ['home', 'write', 'board', 'refs', 'timeline', 'threads', 'notes', 'search', 'review', 'data', 'settings'];

export function parseHash(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const params = new URLSearchParams(query);
  if (parts[0] === 'p' && parts[1]) {
    const view = (VIEWS.includes(parts[2] as View) ? parts[2] : 'home') as View;
    return { projectId: parts[1], view, itemId: parts[3] ?? null, params };
  }
  if (parts[0] === 'settings') return { projectId: null, view: 'settings', itemId: null, params };
  return { projectId: null, view: 'home', itemId: null, params };
}

export function href(projectId: string | null, view: View = 'home', itemId?: string | null, params?: Record<string, string>): string {
  let h = projectId ? `#/p/${encodeURIComponent(projectId)}/${view}` : view === 'settings' ? '#/settings' : '#/';
  if (projectId && itemId) h += `/${encodeURIComponent(itemId)}`;
  if (params && Object.keys(params).length) h += `?${new URLSearchParams(params)}`;
  return h;
}

export function navigate(projectId: string | null, view: View = 'home', itemId?: string | null, params?: Record<string, string>) {
  const next = href(projectId, view, itemId, params);
  if (location.hash !== next) location.hash = next;
}

let cachedHash = '';
let cachedRoute: Route = parseHash('');

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

function snapshot(): Route {
  if (location.hash !== cachedHash) {
    cachedHash = location.hash;
    cachedRoute = parseHash(cachedHash);
  }
  return cachedRoute;
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
