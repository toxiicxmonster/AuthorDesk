# AuthorDesk: private novel-writing software with a grammar checker and AI editor

**AuthorDesk is a free writing app for novelists that runs entirely on your own computer.** Write your book, keep a series bible of characters and places, plan the plot with story structures, check grammar and style as you type, get rewrites from a private AI editor, and export a print-ready KDP paperback PDF or EPUB, all in one window and without sending your writing anywhere.

**[⬇ Download the latest version for Windows](https://github.com/toxiicxmonster/AuthorDesk/releases/latest)** · [User guide](docs/user-guide.md) · [What's new](https://github.com/toxiicxmonster/AuthorDesk/releases)

- **Your writing stays on your computer.** No account, no cloud, no subscription, no analytics. Nothing leaves your device unless you set up sync or Google Drive yourself.
- **A grammar checker and AI editor that run offline.** LanguageTool and an open-source AI model (llama.cpp) run on your own PC: no limits, no monthly fee, and your manuscript never trains anyone's model.
- **Built for fiction.** It knows your characters' names, catches echo words and continuity slips, reviews pacing chapter by chapter, and keeps the details of every book in a series straight.
- **You own your data.** Automatic backups are ordinary zip files with plain JSON inside; export to Word, Markdown, text, EPUB, PDF and CSV at any time.

## Why AuthorDesk?

Novelists usually piece together a writing app (like Scrivener), a style checker (like ProWritingAid or Grammarly) and a formatting tool (like Vellum or Atticus), with subscriptions and cloud uploads along the way. AuthorDesk does the core of all three in one private app:

| You want to… | AuthorDesk gives you |
| --- | --- |
| Draft and organise a novel | Chapters and scenes, a story board, timeline, plot threads, and a character and world bible |
| Catch mistakes and weak prose | Live grammar, spelling and style underlines, echo words, hard-to-read sentences, adverbs with stronger verbs |
| Improve a passage | A private AI editor: rewrite, tighten, smooth, clearer, show-don't-tell, tone, and a character's voice, with one-click **Use** |
| See the whole book | Readability, pacing, overused words, sticky sentences, continuity, characters who drop out, and edit passes |
| Publish | A KDP paperback interior PDF typeset for you, Kindle EPUB 3, and Word |

> **Version 0.6.** Features are covered by automated tests and checked in the running app; see [Project status](#project-status).

---

## Contents

- [Install (download a release)](#install-download-a-release)
- [What it does](#what-it-does)
- [Building from source and generating AuthorDesk.exe](#building-from-source-and-generating-authordeskexe)
- [How the launcher works](#how-the-launcher-works)
- [Where your data lives and backups](#where-your-data-lives-and-backups)
- [Bringing in an existing book](#bringing-in-an-existing-book)
- [Publishing on Amazon KDP](#publishing-on-amazon-kdp)
- [Optional: sync between PC and phone](#optional-sync-between-pc-and-phone)
- [Optional: Google Drive backups](#optional-google-drive-backups)
- [Development](#development)
- [Project layout](#project-layout)
- [Privacy and security](#privacy-and-security)
- [Project status](#project-status)
- [Known limitations](#known-limitations)
- [Documentation](#documentation)

---

## Install (download a release)

You don't need Node or any developer tools to use AuthorDesk.

1. Open the [**Releases**](../../releases) page and download the latest `AuthorDesk-v<version>-windows.zip`.
2. Unzip it somewhere permanent, such as `C:\Users\<you>\AuthorDesk`. Keep `AuthorDesk.exe` and the `dist` folder together; the exe serves the app from that folder.
3. Double-click **AuthorDesk.exe**. To add a desktop shortcut, right-click it and choose **Send to → Desktop (create shortcut)**.
4. Windows may show "Windows protected your PC" because the exe isn't code-signed. Click **More info → Run anyway**. If you'd rather not, [build it yourself](#building-from-source-and-generating-authordeskexe) from the source code.

**Requirements:** Windows 10 or 11 with Microsoft Edge (installed by default) or Google Chrome. The .NET Framework 4 it needs is part of Windows.

**Updating:** automatic. Each time AuthorDesk starts, it checks this repository's latest release; if it's newer, it downloads it, swaps in the new files (keeping a backup until the update has worked) and restarts, which takes a few seconds. If you're offline or anything goes wrong, it just starts the version you have. Your books are not stored in that folder (see [Where your data lives](#where-your-data-lives-and-backups)), so updates never touch them. To turn updates off, put an empty file named `no-auto-update.txt` next to `AuthorDesk.exe`. A source checkout (with an `app` folder next to the exe) never updates itself; use `git pull` there.

**Add-ons:** on first launch AuthorDesk offers to install the private grammar engine and AI Editor in the background, and keeps them updated when a release pins newer versions (about 17 GB, with a free-space check; *Not now* and *Don't ask again* are there too, and **Settings → Add-ons** installs them later). Or install them by hand:

**Private AI Editor (optional):** run `powershell -ExecutionPolicy Bypass -File scripts\install-ai-editor.ps1` (about 8 GB). It rewrites, tightens and smooths passages in a side panel, judges adverbs in context and keeps character notes up to date, using llama.cpp and an open-source model on your PC. Nothing goes into your book until you click **Use** on a version you like.

**Private grammar engine (recommended):** run `powershell -ExecutionPolicy Bypass -File scripts\install-grammar-engine.ps1` from the AuthorDesk folder once (about 9 GB). AuthorDesk then checks grammar on this PC with no limits and nothing sent anywhere.

---

## What it does

| Area | What you get |
| --- | --- |
| **Getting started** | Welcome screen with a ready-made sample book, a **Ctrl+K** quick switcher to jump to any chapter, character, note or command, click-to-rename titles, a labelled toolbar, one-time tips, a Help panel (**F1**), and a Trash instead of permanent deletes. |
| **Themes** | Paper, Sepia, Pastel Blue, Sage, Cozy Cottage and Night, plus *Match my device*. Make your own from five colours with a live preview and a readability check, and share themes as files. Quick theme menu (◐) in the top bar. |
| **Manuscript editor** | Book → (Part) → Chapter → Scene. Bold, italic, underline, headings, block quotes and scene breaks. Autosave with a visible status, undo/redo, word counts (selection, scene, chapter, book), focus mode, find & replace, clean paste from Word and Google Docs, automatic and manual snapshots with restore, split and merge scenes. |
| **Navigation** | Chapter list with a filter (titles and text), pinned and recent chapters, drag-and-drop or menu-based reordering, moving scenes between chapters, keyboard shortcuts for next and previous scene or chapter, and a collapsible drawer on phones. |
| **Characters and world (series bible)** | Characters, locations, factions, species, items, lore, glossary and research entries with templated and custom fields, aliases, tags, favourites, images and relationships. Duplicate warnings, "Mentioned in" backlinks, a quick-reference side panel while you write, and each character's **arc** across the book (where they appear, and when they drop out). |
| **Series** | Several books sharing one character and world bible, where each entry appears book by book, continuity checked across books, and bringing an existing project into a series. |
| **Maps** | A relationship map you can arrange, a family tree drawn from relationships, and pictures of places with pins and the scenes set there. |
| **Story board and plot structures** | Lanes and cards (drag-and-drop or an accessible move menu), filters, and story structures (three-act, Save the Cat, Hero's Journey, seven-point, blank or your own) whose beats say what they do and where they fall. **Map my draft to the beats** suggests the scene for each beat. Turn cards into scenes or chapters and back; an outline view with inline summaries, and AI scene and chapter summaries. |
| **Timeline and plot threads** | Timeline in story-world order or chapter order, with gentle continuity hints. A plot-thread grid showing which chapters each thread appears in, with reminders for threads that have gone quiet. |
| **Proofreading** | **Live underlines as you write**, like Grammarly or Google Docs. On your device: Hunspell spelling (US or UK), grammar and punctuation rules, commonly confused words and idioms, repeated words, dialogue punctuation, name consistency against your character list (catches swapped letters like "Elsei"), and optional style fixes (cut or replace adverbs and filler words). Every underline offers something to change the text to; notes without a concrete fix are never shown. **Deep grammar check** with [LanguageTool](https://languagetool.org): install the private grammar engine (`scripts\install-grammar-engine.ps1`) and AuthorDesk runs it on this PC with English usage data, with no limits and nothing sent anywhere; or opt in to the free online service or your own server. Accept, Ignore, Add to dictionary or turn a check off, with undo and reviewed bulk fixes. **Echo words**, **continuity** (a character described differently in different chapters), **hard-to-read sentences**, stronger verbs for verb + adverb pairs, and character details your notes are missing. **It never changes your text on its own.** |
| **AI Editor (private)** | Runs an open-source model on your PC with llama.cpp. Rewrite, smoother, tighter, without the adverb, without the echo, clearer, fix grammar, show don't tell, change tone, what's the tone, character voice, and ask. Clicking a flagged word shows its best fix right there. Every version has **Use** (one undoable step); nothing is written into your book otherwise. |
| **Review the whole book** | Reading ease, sentence variety, dialogue share, pacing per chapter, overused words and phrases, crutch words, sticky sentences, slow stretches and continuity. **Edit passes** turn every suggestion into a checklist to work through, and export as a report for a human editor. |
| **Search** | Search everything (Ctrl+K): manuscript, references, board, timeline, threads and notes, with filters and snippets. Opening a result highlights the matches. |
| **Import your existing book** | A folder or zip of chapter files (`.md` or `.txt`) plus spreadsheets for characters, locations, world entries, story board, timeline and plot threads. You see a preview before anything is imported, and entries are linked by name. Exact layout: [**IMPORTING.md**](IMPORTING.md). |
| **Dedication & About the Author** | Write these once on the **Home** page. Each one can apply to all your books, every book in the project, or specific books, and you choose which to include in every export (Word, text, Markdown, KDP). |
| **Publish on Amazon KDP** | Kindle eBook as **EPUB 3** (Amazon's recommended format) or **Word**, and a **paperback/hardcover interior**: a print-ready **PDF typeset by AuthorDesk** (two bundled book fonts, running heads, real page numbers in the contents, no stranded lines) or `.docx`, at KDP trim sizes. Mirrored margins meet KDP's gutter rules, chapters start on right-hand pages, front and back matter are added, and an optional **table of contents** is included. A pre-publish checklist catches common problems. |
| **Backup and export** | **Automatic backups** to a folder you choose (a OneDrive or Google Drive folder works), with sensible retention. A complete `.authorproj` archive (manifest, schema version, SHA-256 checksums), and import with a preview: restore, merge, or import as a copy. Also exports to DOCX, TXT, Markdown, JSON and references CSV. |
| **Sync (optional)** | A self-hosted sync server you run yourself. Independent edits merge automatically. If both devices change the same prose, both versions are kept and you choose between them side by side. |
| **Google Drive (optional)** | Back up to and restore from your own Drive using the narrow `drive.file` permission. |

A full walk-through is in the [**user guide**](docs/user-guide.md).

### Keyboard shortcuts

| Keys | Action |
| --- | --- |
| Ctrl+K / Ctrl+Shift+F | Search or jump to anything |
| Ctrl+F | Find & replace in the scene |
| Ctrl+S | Save now |
| Alt+PageDown / PageUp | Next / previous chapter |
| Alt+Shift+PageDown / PageUp | Next / previous scene |
| Ctrl+Alt+F | Focus mode (Esc exits) |
| Ctrl+\\ | Show or hide the chapter list |
| F1 or ? | Help |

---

## Building from source and generating AuthorDesk.exe

### What you need

| Tool | Why | Get it |
| --- | --- | --- |
| **Windows 10/11** | The launcher is a Windows program. | n/a |
| **Node.js 22.5 or newer** | Builds the web app and runs the tests and the sync server. | [nodejs.org](https://nodejs.org/) (LTS) |
| **Git** | Cloning the repository. | [git-scm.com](https://git-scm.com/) |
| **C# compiler** | Compiles the launcher. | Nothing to install: `csc.exe` ships with Windows as part of .NET Framework 4 (`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`). |

### One-command build

```powershell
git clone https://github.com/toxiicxmonster/AuthorDesk.git
cd AuthorDesk
powershell -ExecutionPolicy Bypass -File scripts\build.ps1
```

`scripts\build.ps1` does four things in order and stops at the first failure:

1. **Installs dependencies:** `npm install` in `app\`, the first time only.
2. **Runs the test suite:** `npm test` (vitest). The build refuses to continue if any test fails.
3. **Builds the web app:** `npm run build` writes the production PWA to `app\dist\`.
4. **Compiles the launcher:** it runs `csc.exe` on `launcher\AuthorDesk.cs` with the icon `launcher\AuthorDesk.ico`, producing **`AuthorDesk.exe` in the repository root**.

Options:

```powershell
scripts\build.ps1 -SkipTests   # build without running the tests
scripts\build.ps1 -SkipApp     # recompile only the launcher (app\dist must already exist)
```

If AuthorDesk is running, the build stops with a message. Quit it from the tray icon first, because Windows can't overwrite a running exe.

### Desktop shortcut

```powershell
powershell -ExecutionPolicy Bypass -File scripts\create-shortcut.ps1
```

This puts an **AuthorDesk** shortcut on your desktop that points at the `AuthorDesk.exe` you just built.

### Compiling the launcher by hand

If you'd rather not use the script, this is all it runs for the exe:

```powershell
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /optimize+ /platform:anycpu `
  /out:AuthorDesk.exe /win32icon:launcher\AuthorDesk.ico `
  /reference:System.Windows.Forms.dll /reference:System.Drawing.dll `
  launcher\AuthorDesk.cs
```

`launcher\AuthorDesk.ico` is committed. To regenerate it (and the PWA icons in `app\public`), run `scripts\make-icons.ps1`.

### Packaging a release zip

Run `scripts\package-release.ps1`. It runs the tests, builds the app and exe, and writes `releases\AuthorDesk-v<version>-windows.zip`, taking the version from `const string Version` in `launcher\AuthorDesk.cs`:

```
AuthorDesk-v0.2-windows.zip
├── AuthorDesk.exe
├── dist\                  ← contents of app\dist
├── scripts\install-grammar-engine.ps1
├── sync-server.example.txt
└── README.txt
```

To publish: bump `Version` (and `AssemblyVersion`, plus `app\package.json`), package, then create a GitHub release tagged `v<version>` with the zip attached. Installed copies pick it up on their next launch; the updater takes the release asset whose name ends in `-windows.zip`.

The launcher looks for the app in `.\app\dist`, then `.\dist`, then `..\app\dist`, relative to the exe, so both the repository layout and this flat release layout work.

---

## How the launcher works

`AuthorDesk.exe` is a small C# program (`launcher/AuthorDesk.cs`) with no dependencies beyond Windows.

- It serves the built app on **`http://localhost:47820`** and answers requests from this computer only (loopback). Nothing on your network can reach it.
- It opens the app in its own window using **Edge** (or Chrome) in app mode, with a dedicated browser profile in `%LOCALAPPDATA%\AuthorDesk\BrowserProfile`. It doesn't touch your everyday browser profile.
- A **tray icon** offers *Open*, *Open data folder* and *Quit*. Closing the AuthorDesk window stops the server.
- Launching it a second time just brings up the existing window.
- If a `sync-server.txt` file is present, it forwards `/api/*` requests to that sync server. Only HTTPS addresses (or loopback) are accepted. See [sync](#optional-sync-between-pc-and-phone).
- If neither Edge nor Chrome is found, it opens your default browser instead (without closing automatically).

---

## Where your data lives and backups

Your books are stored in the browser database (IndexedDB) of the launcher's private profile, `%LOCALAPPDATA%\AuthorDesk\BrowserProfile`, tied to the address `localhost:47820`.

- **Don't change the port.** A different address means a separate, empty workspace.
- Opening `localhost:47820` in your everyday browser also shows a separate, empty workspace.
- **Back up regularly:** go to **Backup & Sync → Save backup** for a complete `.authorproj` archive, and keep copies off this computer (a USB drive or a cloud folder). AuthorDesk reminds you when a backup is overdue.
- **To restore:** go to **Backup & Sync → Import**, choose the archive, review the preview, then choose **Restore**, **Merge** or **Import as a copy**.
- Archives are zip files with plain JSON inside (`data/*.json`), so your work is never locked in.
- Every scene keeps revision snapshots automatically; see the **History** tab in the writing view.

---

## Bringing in an existing book

Go to **Backup & Sync → Import your own files**, or choose **Bring in my existing book** on the welcome screen.

```
My Book/
├── chapters/
│   ├── 01 - The Lamp.md        ← one file per chapter (.md or .txt); "## " starts a new scene
│   └── 02 - Below.txt
├── characters.csv              ← or characters/<Name>.md, one file each
├── locations.csv
├── world.csv                   ← factions, items, lore… with a Type column
├── board.csv
├── timeline.csv
├── plot-threads.csv
└── notes/
```

Every column, accepted file type and naming rule is documented in [**IMPORTING.md**](IMPORTING.md). A filled-in example is in [`docs/import-template/`](docs/import-template/), and you can download it from inside the app.

Word `.docx` files can't be imported directly. Save chapters from Word as `.txt`, or download Google Docs as Markdown.

---

## Publishing on Amazon KDP

Go to **Backup & Sync → Publish on Amazon KDP…**, or press Ctrl+K and type *Publish*.

| Format | Use it for |
| --- | --- |
| **Kindle eBook (EPUB)** | Recommended for Kindle. EPUB 3 with navigation, landmarks, NCX and an optional cover. |
| **Kindle eBook (Word)** | A `.docx` with Heading 1 chapters, as KDP expects. |
| **Paperback / hardcover** | A print-ready interior `.docx` at your chosen KDP trim size. |

The print interior gets:
- mirrored margins sized to KDP's gutter rules for your page count
- page numbers, left off chapter-opening pages
- chapters starting on right-hand pages
- title, copyright, dedication and about-the-author pages
- curly quotes and em dashes (applied to the exported copy only)

The **table of contents** is optional. In eBooks its entries link to each chapter. In print it is either a chapter list or one with dot leaders and page numbers. Page numbers are filled in by Microsoft Word, so open the file in Word, click **Yes** to update fields, and save before uploading.

The pre-publish checklist warns about missing author details, empty chapters, leftover "TK"/"TODO" notes, and books outside KDP's 24–828 print-page limits. Book details (author, ISBN, imprint, dedication…) are saved with the book.

Upload the file as the **manuscript** on KDP's Content page. Check print interiors in KDP's **Print Previewer** (same trim size, *No bleed*) and eBooks in **Kindle Previewer**. Covers are uploaded separately.

---

## Optional: sync between PC and phone

Sync is off unless you set it up, and it uses **your own** server; there is no AuthorDesk cloud.

1. Run the sync server (`server/`, Node 22.5+, no npm dependencies, SQLite built in) somewhere both devices can reach **over HTTPS**. [Tailscale](https://tailscale.com/) on your own PC is the simplest private option.
2. Create an account, open the server's address on your phone and install the app (*Add to Home screen*).
3. On the PC, copy `sync-server.example.txt` to `sync-server.txt` next to `AuthorDesk.exe` and put the server's HTTPS address in it. The launcher forwards sync requests there.

Full instructions: [`docs/sync-server.md`](docs/sync-server.md).

How it behaves:
- Each record is versioned.
- Independent edits on two devices merge automatically.
- If both devices change the same prose, **both versions are kept** and a side-by-side resolver lets you choose.
- An edit wins over a delete, so nothing is silently lost.

---

## Optional: Google Drive backups

Release builds **don't include a Google client ID**, so the Drive buttons say Drive isn't set up. To turn Drive on, build from source:

1. Create an OAuth client ID ("Web application") in Google Cloud by following [`docs/google-drive-setup.md`](docs/google-drive-setup.md).
2. Copy `app/.env.example` to `app/.env.local` and set `VITE_GOOGLE_CLIENT_ID`. A client ID is a public identifier, not a secret, and AuthorDesk has no client secret.
3. Rebuild with `scripts\build.ps1`.

AuthorDesk asks only for the `drive.file` permission, so it can see only the files it creates. The access token is kept in memory and never stored.

Until you've set that up, you can **Save backup** straight into a Google Drive for Desktop folder.

---

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

```bash
cd server
node index.js        # sync server; see server/.env.example and docs/sync-server.md
```

**Stack:**

| Part | Built with |
| --- | --- |
| Web app | React 19, TypeScript, Vite 8, TipTap 3 (ProseMirror), Dexie 4 (IndexedDB), zod 4, vite-plugin-pwa (Workbox), fflate, docx |
| Spell check | nspell with Hunspell en-US and en-GB dictionaries, in a Web Worker |
| Launcher | C# on .NET Framework 4 |
| Sync server | Node with `node:sqlite` |
| Tests | vitest with jsdom and fake-indexeddb |

Design notes are in [`docs/architecture.md`](docs/architecture.md) and the ADRs in [`docs/adr/`](docs/adr/).

---

## Project layout

```
app/                React + TypeScript + Vite PWA
  src/domain/         schemas (zod), text utilities, references, continuity, templates
  src/storage/        IndexedDB (Dexie), repository, search, backlinks, migrations
  src/editor/         TipTap editor, proofreading and find extensions, autosave
  src/proofreading/   provider interface, deterministic rules, Hunspell worker
  src/importExport/   archive, exporters, import, EPUB / KDP Word, Google Drive
  src/sync/           merge rules, sync engine, controller and status
  src/ui/             pages and components
  tests/              vitest suites
server/             self-hostable sync server (Node, no dependencies, SQLite)
launcher/           AuthorDesk.exe source (C#) and icon
scripts/            build.ps1, create-shortcut.ps1, make-icons.ps1
docs/               user guide, architecture, ADRs, setup guides, import template
PROJECT.md          product specification
IMPLEMENTATION_PLAN.md  phase-by-phase status
IMPORTING.md        exact import layout
```

`AuthorDesk.exe`, `app/dist`, `node_modules`, `.env*` files, `sync-server.txt`, databases, backups and exports are git-ignored. Build the exe with `scripts\build.ps1` or download it from Releases.

---

## Privacy and security

- **No analytics, tracking or third-party services.** Proofreading runs entirely on your device.
- **No manuscript text is ever sent anywhere** unless you turn on sync, Drive or the online grammar check. Sync and Drive go only to your own server or your own Drive. The online check sends only the paragraphs of the scene you're editing, and only after you agree to an explanation of exactly what is sent (Settings → Proofreading).
- **AuthorDesk never silently changes your prose.** Every proofreading change is your click, and it can be undone.
- **No secrets** in the app bundle or this repository. `.env`, `sync-server.txt`, databases and backups are git-ignored.
- **The launcher answers only loopback requests.**
- **The sync server** requires a login and uses:
  - HttpOnly, SameSite=Strict session cookies
  - an anti-CSRF header
  - rate-limited login attempts
  - scrypt-hashed passphrases
  - logs that never include request bodies
- **Don't host AuthorDesk with your data on GitHub Pages.** Static hosting is public. This repository is for source code only, so never commit manuscripts or backups to it.

---

## Project status

| Area | Status |
| --- | --- |
| Writing, navigation, references, planning, proofreading, search, archives, import, themes | ✅ Done and tested |
| AI Editor, grammar engine, review and edit passes, series, maps, automatic backups | ✅ Done, tested, and checked in the running app |
| Amazon KDP export | 🟡 Done and tested; needs a real KDP upload and an EPUBCheck run |
| Sync | 🟡 Done and tested with simulated devices and a local phone test; needs an HTTPS deployment and a real phone install |
| Google Drive | 🟡 Built; needs a real account round-trip test |
| Formal screen-reader audit, Android PWA install test, deployed-server security review | ⬜ Not yet done |

Details: [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

---

## Known limitations

- Spell check covers US and UK English. The on-device grammar checks are rule-based hints, not a full parser; turn on the optional LanguageTool check for deeper grammar. The free LanguageTool service allows about 20 checks a minute, so after a large paste the rest of the scene is checked a little later.
- Google Drive is untested with a real account. There's no folder picker: backups go to an "AuthorDesk Backups" folder that AuthorDesk creates.
- Sync: deleting a project on one device doesn't delete it on others; use *Delete cloud copy*. Revision snapshots stay on each device.
- Word `.docx` files can't be imported directly (see [IMPORTING.md](IMPORTING.md)).
- The launcher is Windows-only and needs Edge or Chrome. On other systems you can run `npm run build` and serve `app/dist` yourself.
- `AuthorDesk.exe` isn't code-signed, so Windows SmartScreen warns on first launch.

---

## Documentation

| Document | What's in it |
| --- | --- |
| [docs/user-guide.md](docs/user-guide.md) | How to use every part of the app |
| [IMPORTING.md](IMPORTING.md) | Exact folder and spreadsheet layout for importing a book |
| [docs/sync-server.md](docs/sync-server.md) | Running your own sync server |
| [docs/google-drive-setup.md](docs/google-drive-setup.md) | Setting up Google Drive backups |
| [docs/architecture.md](docs/architecture.md) | How the app is put together |
| [docs/adr/](docs/adr/) | Architecture decision records |
| [PROJECT.md](PROJECT.md) | Product specification |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Phase-by-phase status |
