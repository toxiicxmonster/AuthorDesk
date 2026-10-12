/**
 * Google Drive backup provider (browser OAuth via Google Identity Services).
 *
 * Security model:
 * - Uses the narrow `drive.file` scope: AuthorDesk can only see files it created or that you opened with it.
 * - The OAuth *client ID* is public by design; there is no client secret in the app.
 * - Access tokens are kept in memory only (never written to storage, logs or exports) and expire in ~1 hour.
 * - Backups are uploaded as new, timestamped files; nothing is overwritten.
 *
 * Requires VITE_GOOGLE_CLIENT_ID (see docs/google-drive-setup.md). Until that is configured and tested
 * with a real account, the UI labels Drive as not yet verified.
 */

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GSI_SRC = 'https://accounts.google.com/gsi/client';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
export const DEFAULT_FOLDER = 'AuthorDesk Backups';

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface GoogleOAuth {
  initTokenClient(cfg: { client_id: string; scope: string; callback: (r: TokenResponse) => void; error_callback?: (e: { type: string; message?: string }) => void }): {
    requestAccessToken(o?: { prompt?: string }): void;
  };
  revoke(token: string, done: () => void): void;
}

declare global {
  interface Window {
    google?: { accounts: { oauth2: GoogleOAuth } };
  }
}

let token: { value: string; expires: number } | null = null;

export function driveClientId(): string | null {
  const id = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  return id && id.trim() && !id.includes('YOUR_') ? id.trim() : null;
}

export function isDriveConfigured(): boolean {
  return !!driveClientId();
}

export function isDriveConnected(): boolean {
  return !!token && token.expires > Date.now() + 30_000;
}

function loadGsi(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GSI_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Google sign-in. Check your internet connection.'));
    document.head.appendChild(s);
  });
}

/** Ask the user to authorize Drive access. Must be called from a click handler (popup). */
export async function connectDrive(): Promise<void> {
  const clientId = driveClientId();
  if (!clientId) throw new Error('Google Drive is not configured. See docs/google-drive-setup.md.');
  if (!navigator.onLine) throw new Error('You are offline. Connect to the internet to use Google Drive.');
  await loadGsi();
  await new Promise<void>((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (r) => {
        if (r.error || !r.access_token) return reject(new Error(r.error_description || r.error || 'Google did not grant access.'));
        token = { value: r.access_token, expires: Date.now() + (r.expires_in ?? 3600) * 1000 };
        resolve();
      },
      error_callback: (e) => reject(new Error(e.type === 'popup_closed' ? 'The Google sign-in window was closed.' : e.message || e.type)),
    });
    client.requestAccessToken({ prompt: '' });
  });
}

export async function disconnectDrive(): Promise<void> {
  const t = token?.value;
  token = null;
  if (t && window.google?.accounts?.oauth2) await new Promise<void>((r) => window.google!.accounts.oauth2.revoke(t, r));
}

async function api(path: string, init: RequestInit = {}, base = API): Promise<Response> {
  if (!isDriveConnected()) throw new Error('Not connected to Google Drive (or the session expired). Connect again.');
  const res = await fetch(base + path, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token!.value}` } });
  if (res.status === 401) {
    token = null;
    throw new Error('Google Drive access expired or was revoked. Connect again.');
  }
  if (res.status === 403) throw new Error('Google Drive refused the request (permission or quota). Check your Drive storage and app access.');
  if (res.status === 429 || res.status >= 500) throw new Error(`Google Drive is busy (HTTP ${res.status}). Try again in a minute.`);
  if (!res.ok) throw new Error(`Google Drive error HTTP ${res.status}`);
  return res;
}

export async function ensureFolder(name = DEFAULT_FOLDER): Promise<string> {
  const q = encodeURIComponent(`name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const found = (await (await api(`/files?q=${q}&fields=files(id,name)&spaces=drive`)).json()) as { files: { id: string }[] };
  if (found.files[0]) return found.files[0].id;
  const created = (await (
    await api('/files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' }) })
  ).json()) as { id: string };
  return created.id;
}

export interface DriveFile {
  id: string;
  name: string;
  size?: string;
  modifiedTime: string;
}

/** Upload a new file (never overwrites). */
export async function uploadFile(folderId: string, name: string, blob: Blob): Promise<DriveFile> {
  const meta = { name, parents: [folderId] };
  const body = new FormData();
  body.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  body.append('file', blob);
  const res = await api('/files?uploadType=multipart&fields=id,name,size,modifiedTime', { method: 'POST', body }, UPLOAD);
  return (await res.json()) as DriveFile;
}

export async function listBackups(folderId: string): Promise<DriveFile[]> {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const res = await api(`/files?q=${q}&orderBy=modifiedTime desc&pageSize=100&fields=files(id,name,size,modifiedTime)`);
  return ((await res.json()) as { files: DriveFile[] }).files;
}

export async function downloadFile(fileId: string): Promise<Uint8Array> {
  const res = await api(`/files/${encodeURIComponent(fileId)}?alt=media`);
  return new Uint8Array(await res.arrayBuffer());
}
