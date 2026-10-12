# Google Drive setup

AuthorDesk can back up projects to, and restore them from, your Google Drive. You need a free OAuth **client ID** (a public identifier — there is no secret in the app). This is a one-time, ~10-minute setup in the Google Cloud console. No billing account is needed.

## Steps

1. Go to <https://console.cloud.google.com/> and sign in with the Google account whose Drive you want to use. Top bar → project picker → **New project** → name it “AuthorDesk” → **Create**, then make sure it is selected.
2. **Enable the Drive API:** ☰ menu → **APIs & Services → Library** → search “Google Drive API” → **Enable**.
3. **Set up the sign-in screen:** ☰ menu → **Google Auth Platform** (older consoles: *APIs & Services → OAuth consent screen*) → **Get started**.
   - App name: `AuthorDesk`; user support email: your email.
   - Audience: **External**.
   - Contact information: your email. Agree to the policy → **Create**.
4. **Add yourself as a tester:** Google Auth Platform → **Audience** → *Test users* → **Add users** → your Gmail address → **Save**. Leave the publishing status on **Testing** — that is fine for personal use and means only the people you list can sign in.
5. **Limit the permission:** Google Auth Platform → **Data Access** → **Add or remove scopes** → tick `.../auth/drive.file` (“See, edit, create, and delete only the specific Google Drive files you use with this app”) → **Update** → **Save**.
6. **Create the client ID:** Google Auth Platform → **Clients** (older: *Credentials → Create credentials → OAuth client ID*) → **Create client**:
   - Application type: **Web application**, name: `AuthorDesk desktop`.
   - **Authorized JavaScript origins** → **Add URI** → `http://localhost:47820` (exactly; no trailing slash). Add `https://<your-sync-server>` too if you open AuthorDesk on your phone from there.
   - **Authorized redirect URIs:** leave empty.
   - **Create**, then copy the **Client ID** (ends in `.apps.googleusercontent.com`). You do *not* need the client secret — don’t download or store it.
7. Put the client ID in `app/.env.local` (copy `app/.env.example`; this file is git-ignored):
   ```
   VITE_GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
   ```
8. Quit AuthorDesk from the tray icon and rebuild: `powershell -ExecutionPolicy Bypass -File scripts\build.ps1`.

New client IDs can take a few minutes (occasionally longer) to start working; an “invalid_client” or “origin not allowed” error right after creating one usually goes away on its own.

## Using it

Backup & Sync → **Connect Google Drive** opens Google’s own sign-in window (AuthorDesk never sees your password). Because the app is in *Testing*, Google shows **“Google hasn’t verified this app”** — that is expected for your own client; choose **Continue**. Then:

- **Back up to Drive now** uploads a new, timestamped `.authorproj` file to the “AuthorDesk Backups” folder. Existing backups are never overwritten.
- The list shows backups in that folder; **Restore…** downloads one and shows the normal import preview before anything changes.
- **Disconnect** revokes the access token. To remove the app’s access completely, also visit Google Account → Security → Third-party access.

The access token lasts about an hour; after that, Connect again.

## Troubleshooting

| Message | Fix |
| --- | --- |
| `Error 400: origin_mismatch` / “not a valid origin” | The address in the window (e.g. `http://localhost:47820`) must be listed exactly under *Authorized JavaScript origins*. |
| `Error 403: access_denied` | Your account isn’t a test user — add it under Google Auth Platform → Audience. |
| `invalid_client` | Client ID copied wrong, or it was created moments ago — wait a few minutes. |
| Drive buttons say “Not set up yet” | `app/.env.local` is missing or the app wasn’t rebuilt after adding it. |
| Popup closes with nothing happening | Allow pop-ups for `localhost:47820`. |

## Permissions in plain language

AuthorDesk requests `drive.file`: it can create files and see only the files it created (or that you open with it). It cannot read the rest of your Drive. The access token is kept in memory only and expires after about an hour.

## About release builds

The client ID is compiled into the app, and an app in *Testing* only works for the test users you list. That is why public release zips ship **without** one: each person who wants Drive sets up their own client ID and builds from source.

## Status

Implemented and type-checked, **not yet tested against a real Google account**. After setup, verify a full round trip: back up to Drive, then restore that backup as a copy and check chapters, references and links.
