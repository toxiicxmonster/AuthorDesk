# AuthorDesk

A private, local-first writing studio for novelists: manuscript editor, chapter/scene navigation, character & world reference, story board, timeline, plot threads, on-device proofreading, full-project backups, and optional self-hosted sync between PC and phone.

Your writing lives on your device (browser IndexedDB). Nothing is uploaded unless you set up sync or Google Drive yourself. See [`PROJECT.md`](PROJECT.md) for the product spec and [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) for status.

## Quick start (Windows)

1. Build once (needs Node 22.5+):

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\build.ps1
   ```

   This installs dependencies, runs the tests, builds the web app into `app\dist`, and compiles `AuthorDesk.exe` with the C# compiler that ships with Windows.

2. Create a desktop shortcut:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\create-shortcut.ps1
   ```

3. Double-click **AuthorDesk**. The launcher serves the app on `http://localhost:47820` (this computer only) and opens it in its own window using Edge or Chrome with a dedicated profile in `%LOCALAPPDATA%\AuthorDesk\BrowserProfile`. Closing the window stops the server; a tray icon offers *Open*, *Open data folder* and *Quit*.

> **Your data lives in that browser profile**, tied to the address `localhost:47820`. Don’t change the port, and back up regularly (Backup & Sync → Save backup). Opening `localhost:47820` in your everyday browser shows a *separate*, empty workspace.

## Features

| Area | What you get |
| --- | --- |
| Ease of use | First-run welcome with a ready-made sample book; Ctrl+K quick switcher to jump to any chapter, character, note or command; click-to-rename titles; selection pop-up (bold, italic, link to character); labelled toolbar; one-time tips; Help panel (F1); Trash instead of hard deletes. |
| Themes | Paper, Sepia, Pastel Blue, Sage, Cozy Cottage and Night, plus Match my device. Create your own from five colours with a live preview and readability check; share themes as files. Quick theme menu (◐) in the top bar. |
| Manuscript | Book → (Part) → Chapter → Scene. Rich-text editor (bold, italic, underline, headings, block quotes, scene breaks), autosave with visible status, undo/redo, word & character counts for selection/scene/chapter/book, focus mode, find & replace, paste cleanup from Word/Google Docs, periodic + manual snapshots with restore, split/merge scenes, archive with undo. |
| Navigation | Chapter navigator with filter (titles and text), pinned and recent chapters, drag-and-drop plus menu-based move up/down, move scenes between chapters, prev/next scene & chapter shortcuts, collapsible drawer on phones. |
| References | Characters, locations, factions, species, items, lore, glossary, research — templated fields, custom fields, aliases, tags, favourites, image, relationships/connections, duplicate warnings, backlinks (“Mentioned in”), quick-reference side panel while writing, link selected prose to an entry, unlinked-mention detection (suggestions only). |
| Planning | Story board with lanes and cards (drag-and-drop or accessible move menu), filters, templates (three-act, fifteen-beat sheet, Hero’s Journey, blank, your own), card ↔ scene/chapter conversion, outline view with inline summaries, timeline (in-world and chapter order, continuity hints), plot threads grid with “quiet thread” review flags. |
| Proofreading | On-device only: Hunspell spelling (US/UK), grammar & punctuation rules, commonly confused words, repeated words, dialogue punctuation, name consistency against your references, optional style hints (adverbs, passive, filler, clichés, long sentences). Accept / Ignore / Add to dictionary / Turn off check, undo, reviewed bulk apply, stale-suggestion protection. Never changes text on its own. |
| Search | Global search (Ctrl+K) across manuscript, references, board, timeline, threads and notes with filters and snippets; opens scenes with matches highlighted. |
| Import your existing book | Folder (or zip) of chapter files plus spreadsheets for characters, locations, world entries, story board, timeline and plot threads; preview before import; links made by name; downloadable starter template. Exact layout: [**IMPORTING.md**](IMPORTING.md). |
| Publish on Amazon KDP | Kindle eBook as **EPUB 3** (Amazon’s recommended format, with navigation, NCX, optional cover) or **Word**; **paperback/hardcover interior** .docx at KDP trim sizes with mirrored margins that meet KDP’s gutter rules for the page count, page numbers (none on chapter openings), chapters on right-hand pages, title/copyright/dedication/about-the-author pages, and an optional **table of contents** (linked entries in eBooks; chapter list or dot-leader page numbers in print). Chapter heading styles, curly quotes/em dashes, and a pre-publish checklist (missing author, empty chapters, leftover TK/TODO notes, 24–828 page limits). Book details (author, ISBN, imprint…) are saved with the book. |
| Backup & export | Complete `.authorproj` archive (manifest, schema version, SHA-256 checksums), import with preview, restore / merge / import-as-copy, duplicate policies. Exports: DOCX, TXT, Markdown folder, JSON, references CSV. Import chapters from .txt/.md. Backup reminders. |
| Sync | Optional self-hosted sync server (`server/`): login with HttpOnly session cookie, per-record versioned sync, automatic merge of independent edits, prose conflicts always keep both versions with a side-by-side resolver. |
| Google Drive | Optional backup/restore to Drive with the narrow `drive.file` scope (needs your own OAuth client ID; see below). |

## Development

```bash
cd app
npm install
npm run dev          # http://localhost:5173 (a separate data origin from the launcher)
npm test             # unit + integration tests (vitest, fake IndexedDB, in-memory sync server)
npm run typecheck
npm run lint
npm run build        # production build into app/dist
```

Launcher only: `scripts\build.ps1 -SkipApp`. Icons: `scripts\make-icons.ps1`.

Project layout:

```
app/            React + TypeScript + Vite PWA
  src/domain/       schemas (zod), text utils, references, continuity, templates
  src/storage/      IndexedDB (Dexie), repository, search, backlinks, migrations
  src/editor/       TipTap editor, proofreading/find extensions, autosave
  src/proofreading/ provider interface, deterministic rules, Hunspell worker
  src/importExport/ archive, exporters, text import, Google Drive
  src/sync/         merge rules, sync engine, controller/status
  src/ui/           pages and components
  tests/            vitest suites
server/         self-hostable sync server (Node, no dependencies, SQLite)
launcher/       AuthorDesk.exe source (C#, .NET Framework 4)
scripts/        build, icons, desktop shortcut
docs/           architecture, ADRs, setup guides, user guide
```

## Sync between PC and phone (optional)

Read [`docs/sync-server.md`](docs/sync-server.md). In short: run `server/index.js` somewhere both devices can reach **over HTTPS** (Tailscale on your own PC is the simplest private option), create an account, open that address on your phone and install it, and put the address in `sync-server.txt` next to `AuthorDesk.exe` so the PC launcher forwards sync requests there.

## Google Drive (optional)

Follow [`docs/google-drive-setup.md`](docs/google-drive-setup.md) to create an OAuth client ID, put it in `app/.env.local` as `VITE_GOOGLE_CLIENT_ID`, and rebuild. **Status: implemented but not yet verified with a real Google account** — do a backup-and-restore round trip before relying on it. Until then, “Save backup” can write directly into a Google Drive for Desktop folder.

## Bringing in an existing book

See [**IMPORTING.md**](IMPORTING.md) for the exact folder layout and every spreadsheet column. In the app: **Backup & Sync → Import your own files**, or **Bring in my existing book** on the welcome screen. A filled-in example lives in [`docs/import-template/`](docs/import-template/) and can be downloaded from the app.

## Backups

- **Backup & Sync → Save backup** writes a complete `.authorproj` archive. Keep copies off this computer.
- To restore: Backup & Sync (or Settings) → Import → choose the archive → review the preview → Restore / Merge / Import as copy.
- Archives are zip files with plain JSON inside (`data/*.json`), so your work is never locked in.
- Revision snapshots are kept automatically per scene (History tab in the writing view).

## Privacy & security

- No analytics, tracking, or third-party services. Proofreading runs on-device.
- No secrets in the client bundle or repository; `.env`, `sync-server.txt`, databases and backups are git-ignored.
- The launcher’s server answers only loopback requests. The sync server requires login, uses HttpOnly + SameSite=Strict cookies, an anti-CSRF header, rate-limited login, scrypt-hashed passphrases, and never logs request bodies.
- Do **not** host AuthorDesk with your data on GitHub Pages: static hosting is public. The private GitHub repository is for source code only.

## Known limitations

- Spell check: Hunspell US/UK dictionaries; grammar checks are rule-based heuristics, not a full parser. No AI/remote grammar provider is connected (the interface exists).
- Google Drive: untested against a real account (needs your client ID). No folder picker — backups go to an “AuthorDesk Backups” folder AuthorDesk creates.
- Sync: deleting a project on one device doesn’t delete it elsewhere; use “Delete cloud copy”. Revision snapshots stay per-device.
- DOCX files can’t be imported directly: save chapters from Word as .txt (or download Google Docs as .md) — see IMPORTING.md.
- The launcher needs Edge or Chrome (falls back to the default browser without window tracking).
