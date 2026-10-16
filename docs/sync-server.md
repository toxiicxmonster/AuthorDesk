# AuthorDesk sync server

`server/index.js` is a small, dependency-free Node server (Node 22.5+, uses built-in `node:sqlite`). It serves the built app **and** a private sync API, so a phone can open the app from it, install it, and sync with your PC.

## What it stores

A single SQLite file (`DATA_DIR/authordesk-sync.db`) containing accounts (scrypt-hashed passphrases), sessions (only SHA-256 hashes of tokens), and your project records. **It contains your manuscripts**: keep it private, back it up, never commit it.

## Run it

```bash
cd server
node index.js add-user yourname        # prompts for a passphrase (10+ characters)
node index.js                          # listens on 127.0.0.1:8787 by default
```

Environment: `PORT`, `HOST`, `DATA_DIR`, `APP_DIR` (see `.env.example`; use `node --env-file=.env index.js`). Build the app first (`cd app && npm run build`) so there is something to serve.

Other commands: `set-password <name>` (signs out all devices), `list-users`.

## Make it reachable over HTTPS (required)

Never expose the server over plain HTTP on the internet. Options, from most private to least effort:

1. **Tailscale on your PC (recommended for one person).** Install Tailscale on the PC and phone, then:
   ```bash
   tailscale serve --bg https / http://127.0.0.1:8787
   ```
   You get `https://<pc-name>.<tailnet>.ts.net`, reachable only by your own devices. Downside: the PC must be on for the phone to sync (the phone keeps working offline meanwhile).
2. **A small always-on host** (home server, NAS, VPS) behind Caddy/nginx with a real certificate. Keep `HOST=127.0.0.1` and let the proxy terminate TLS; it must pass `X-Forwarded-Proto: https`.
3. **A managed host** (Fly.io, Render, Railway…) with a persistent volume for `DATA_DIR`.

## Connect your devices

- **Phone:** open the HTTPS address in Chrome, sign in on the project list (or Backup & Sync), then *Add to Home screen* to install the PWA. Your projects download automatically.
- **Computer (desktop app):** copy `sync-server.example.txt` to `sync-server.txt` in the AuthorDesk data folder (**File → Open data folder**: `%LOCALAPPDATA%\AuthorDesk\` on Windows, `~/.local/share/AuthorDesk/` on Linux), put your HTTPS address in it, and restart AuthorDesk. It forwards `/api/*` to the server, so your local data stays where it is and the session cookie stays HttpOnly. Then sign in under Backup & Sync; existing local projects upload on the first sync.

## How sync behaves

- Local-first: you always write to the device’s own database; sync runs in the background (every ~15 s when there are changes, on reconnect, and when the app becomes visible) and via **Sync now**.
- Every record carries a revision; the server assigns increasing versions. A push is accepted only if it is based on the server’s latest version, so a device can never overwrite newer work it hasn’t seen. Device clocks are not used to decide anything.
- Independent edits (different records, or different fields of the same record) merge automatically.
- If the same scene’s prose was changed on two devices, **both versions are kept**: the device keeps its own text, saves the other version to History, and lists a conflict under Backup & Sync with a side-by-side view (Keep this device’s / Use other device’s / Keep both as two scenes).
- An edit always wins over a delete made on another device.
- Revision snapshots, ignored suggestions and preferences stay on each device.
- Status badge: Local only · Not signed in · Syncing · N to sync · Synced · Offline · Conflict · Sync error.

## Revoking access

- Sign out (one device) or **Sign out on all devices** in Backup & Sync, or `node index.js set-password <name>` on the server.
- **Delete cloud copy** removes a project from the server; device copies and exported backups remain.
- To stop syncing entirely: sign out, delete `sync-server.txt`, and delete the server’s `DATA_DIR`.

## Threat model (summary)

| Threat | Mitigation |
| --- | --- |
| Someone on the internet reads your manuscript | Login required for every sync call; HTTPS required; no public static hosting of data. |
| Stolen browser storage reveals a token | Session token lives only in an HttpOnly cookie; scripts can’t read it; nothing secret is in localStorage/IndexedDB. |
| Cross-site request forgery | SameSite=Strict cookie + mandatory `X-AuthorDesk` header (no CORS is ever enabled). |
| Password guessing | scrypt hashing, 10+ character passphrases, 10 attempts / 15 min per IP. |
| Lost edits from racing devices | Version-checked writes, three-way merge, prose conflicts preserve both versions, snapshots before remote overwrites. |
| Server logs leak text | Request bodies are never logged. |
