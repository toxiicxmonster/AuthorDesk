# Google Drive setup

AuthorDesk can back up projects to, and restore them from, your Google Drive. You need a free OAuth **client ID** (a public identifier — there is no secret in the app). This is a one-time setup in the Google Cloud console.

## Steps

1. Go to <https://console.cloud.google.com/>, create a project (e.g. “AuthorDesk”).
2. **APIs & Services → Library →** enable **Google Drive API**.
3. **APIs & Services → OAuth consent screen:** User type *External*, app name “AuthorDesk”, your email as support/developer contact. Scopes: add `.../auth/drive.file` only. Add yourself under **Test users**. (Leaving the app in *Testing* is fine for personal use.)
4. **APIs & Services → Credentials → Create credentials → OAuth client ID:** type **Web application**. Under **Authorized JavaScript origins** add every address you open AuthorDesk from, for example:
   - `http://localhost:47820` (the desktop launcher)
   - `https://<your-sync-server>` (if you use one, for the phone)
   No redirect URIs are needed.
5. Copy the client ID into `app/.env.local`:
   ```
   VITE_GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
   ```
6. Rebuild: `powershell -ExecutionPolicy Bypass -File scripts\build.ps1` (or `npm run build` in `app/`).

## Using it

Backup & Sync → **Connect Google Drive** opens Google’s own sign-in window (AuthorDesk never sees your password). Then:

- **Back up to Drive now** uploads a new, timestamped `.authorproj` file to the “AuthorDesk Backups” folder. Existing backups are never overwritten.
- The list shows backups in that folder; **Restore…** downloads one and shows the normal import preview before anything changes.
- **Disconnect** revokes the access token. To remove the app’s access completely, also visit Google Account → Security → Third-party access.

## Permissions in plain language

AuthorDesk requests `drive.file`: it can create files and see only the files it created (or that you open with it). It cannot read the rest of your Drive. The access token is kept in memory only and expires after about an hour.

## Status

Implemented and type-checked, **not yet tested against a real Google account** (requires your client ID). After setup, verify a full round trip: back up to Drive, then restore that backup as a copy and check chapters, references and links.
