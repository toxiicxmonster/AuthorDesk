# Implementation plan & status

Last updated: 2026-10-11. Legend: ✅ done & tested · 🟡 done, needs real-world verification · ⬜ not started.

## Phase 0 — Repository & technical design ✅
- Stack: React 19, TypeScript, Vite 8, TipTap 3, Dexie 4, zod 4, vite-plugin-pwa, vitest; launcher in C# (.NET Framework 4 csc); sync server Node + node:sqlite.
- Lint (eslint), formatting (prettier), type check, tests, `.gitignore`, `.env.example` files.
- Architecture notes (`docs/architecture.md`), ADRs 0001 (local-first PWA + launcher) and 0002 (sync).
- Privacy check: no secrets in bundle/repo; data, backups, configs ignored by git.

## Phase 1 — Local writing MVP ✅
- Projects/books/parts/chapters/scenes; editor with autosave, counts, undo/redo, snapshots; chapter navigator (filter, pinned, recent, drag & drop + menu moves); prev/next; focus mode; find & replace; paste cleanup; responsive desktop/phone layouts; global search; status indicators.
- **Acceptance:** write locally, reload, find and edit any chapter — verified in browser and tests.

## Phase 2 — Reference library ✅
- Typed templates, custom fields, aliases, tags, favourites, images, connections (bidirectional), duplicate warnings, backlinks, quick-reference panel, link prose to entries, unlinked-mention detection, archive vs delete-with-unlink.

## Phase 3 — Story planning ✅
- Board (lanes, cards, drag & drop, accessible move menus, filters, archive, duplicate), templates (built-in + custom), card → scene/chapter, scene → card, outline view, timeline (in-world/chapter order, undated events, continuity hints, per-book), plot threads grid + quiet-thread flags with configurable threshold.

## Phase 4 — Proofreading ✅
- Provider interface; local rules; Hunspell spelling (US/UK) in a worker; custom dictionary; reference names as known words; suggestion popover (accept / ignore / add to dictionary / turn off check); undo; reviewed bulk apply (errors only, preview + confirm); stale protection; category toggles; privacy statement. Remote provider: interface only (intentionally not wired).

### Proofreading review (2026-10-11) ✅
- Live checking: on-device underlines refresh 0.6 s after a pause; unchanged paragraphs come from a per-paragraph cache; the editor moves existing underlines on each keystroke instead of rebuilding them.
- Accuracy fixes: "its true name"/"its time" no longer flagged; "to loose an arrow" allowed; a/an handles acronyms ("an FBI agent") and "a utopia"; repeated-word check works with accented letters; US/UK check covers inflections (coloured, realising, centres…) and no longer flags grey or meter; swapped letters in names ("Elsei") are caught (transposition-aware edit distance); dictionary words no longer reported as misspelled names ("Hidden" vs "Halden"); common contractions without apostrophes (dont, didnt…) fixed; new idioms (bated breath, toe the line, wreak havoc…).
- Confused-word checks have stable named ids (old numbered ids in settings are mapped).
- Spell worker: verdict and suggestion caches per dialect (switching US/UK no longer reuses the other dialect's suggestions); web/email addresses skipped.
- Optional **LanguageTool** online check (`proofreading/languageTool.ts`): explicit consent dialog, off by default, paragraph-level cache so only edited paragraphs are re-sent, stays under the free API limits (20 requests / 75 KB a minute), never runs offline, no API key, self-hosted server supported (https or localhost). Character names and the custom dictionary filter its spelling results; its context-aware spelling fix wins over the dictionary's on the same word. Consent is per device and never stored in backups.
- Settings privacy section now reflects real sync and online-check state.
- Tested: 23 new unit tests (rules, cache, LanguageTool batching/offsets/cache/limits/errors/offline/address validation) and a live check in a test browser against the real LanguageTool API with sample text.

## Phase 5 — Archive import/export ✅
- `.authorproj` with manifest, schema version, checksums; validation (paths, sizes, schema, integrity); preview; restore / merge (keep existing / use imported / keep both) / import as copy (id remap); DOCX, TXT, Markdown, JSON, CSV; text/Markdown chapter import; round-trip tests.

## Phase 6 — Cross-device sync 🟡
- Server, auth, versioned push/pull, client engine, merge, conflict preservation + resolver UI, diagnostics, background sync, launcher proxy, sign-out everywhere, delete cloud copy.
- Tested: two simulated devices against the real server store (merge, prose conflict, delete-vs-edit, interrupted upload), HTTP auth/CSRF tests, real browser PC→phone sync, launcher proxy round trip.
- **Needs:** deploying with HTTPS where the phone can reach it (owner’s choice; see `docs/sync-server.md`), then a real phone test.

## Phase 7 — Google Drive 🟡
- drive.file OAuth (GIS token client, memory-only token), folder creation, versioned upload, list, download → import preview, disconnect/revoke, error handling.
- Setup guide brought up to date with the current Google Cloud console (Google Auth Platform: Branding / Audience / Data Access / Clients), with a troubleshooting table. No CSP/COOP headers in the app or launcher block Google sign-in.
- No folder picker: backups go to an app-created “AuthorDesk Backups” folder.
- Release zips ship without a client ID (a *Testing* OAuth app only works for its listed test users).
- **Needs:** owner’s OAuth client ID in `app/.env.local`, a rebuild, and a real round-trip test (`docs/google-drive-setup.md`).

## Usability & themes ✅
- Welcome screen + sample book; Ctrl+K quick switcher (chapters, scenes, entries, notes, cards, commands, themes); Help panel; labelled toolbar; selection bubble menu; click-to-rename titles (scene header, chapter list via double-click/F2, board columns); one-time editor tips; Trash wording everywhere; type chooser for new entries with duplicate warning; progressive profile fields with “add detail” chips; board quick-add.
- Themes: Paper, Sepia, Pastel Blue, Sage, Cozy Cottage, Night, Match my device; custom themes from five colours with live preview, WCAG readability check, share/import as files; quick theme menu. Built-in themes tested for ≥7:1 text contrast on the page.

## Import your own files ✅
- Folder/zip import of chapters (.md/.txt, ## scenes, single manuscript file), characters/locations (CSV or one Markdown file each), world.csv with Type, board.csv, timeline.csv, plot-threads.csv, notes/. Tolerant CSV reader (quotes, BOM, ; and tab separators), header synonyms, unknown columns → custom fields, name/alias linking, unmatched-name report, duplicate policy, preview. Documented in IMPORTING.md; docs/import-template is both the documented example and the in-app starter template (tested to import cleanly).

## Publish on Amazon KDP 🟡
- EPUB 3 (nav + landmarks + NCX, stable identifier, optional cover), KDP eBook .docx (Heading 1 chapters), print interior .docx (trim size, mirrored margins with KDP gutter-by-page-count rules, folios without numbers on chapter openings, odd-page chapter starts, front/back matter), smart punctuation, heading styles, optional table of contents (EPUB visible Contents page in spine; Word hyperlinks to chapter bookmarks; print Contents section with optional PAGEREF page numbers + dot leaders, Word updates fields on open), preflight, saved publishing details.
- Tested: XHTML well-formedness of every EPUB file, OPF metadata, docx page size/margins/sections/mirrorMargins (in schema order), visual render of EPUB pages and print interior.
- **Needs:** a real upload to KDP (Kindle Previewer / Print Previewer) — not possible from this environment; EPUBCheck could not be run (no Java installed).

## Phase 8 — Hardening & polish (partly)
- ✅ Keyboard shortcuts, focus styles, aria labels, no colour-only errors (labels + icons), touch targets, safe areas, dark mode.
- ✅ Phone-width layout checked (no horizontal overflow at 390 px).
- ⬜ Formal accessibility audit with a screen reader.
- ✅ Large-manuscript test (300k words, 300 chapters, 2,000 references; fake IndexedDB so real browsers are faster): search 36 ms, backlinks 34 ms, archive build+parse 193 ms, proofreading 5k words 25 ms (`tests/perf.test.ts`).
- ⬜ PWA install test on Android (needs the HTTPS host).
- ⬜ Security review of a deployed server.

## Dedication & About the Author pages ✅
- Managed on Home; stored on the project record (`bookPages`, included in backups and sync). Scope: all my books (every project), this project, or specific books.
- Every export picks the matching page automatically, with a per-export override or "leave it out": Word, plain text, Markdown (as `00 - Dedication.md` / `NN - About the Author.md`), and all KDP formats.
- Text written in older versions (per-book KDP "Book details") is moved into pages once, automatically.
- Tested: page choice and scope ranking, tracked saves with undo, legacy migration, inclusion in text/Markdown/KDP exports; checked in a test browser.

## Performance
- Secondary pages (Board, World, Timeline, Threads, Notes, Search, Backup, Settings) load on first use: the main bundle went from 1.2 MB to 0.8 MB. Everything is still cached for offline use.

## Repository & releases
- ✅ Source pushed to GitHub (`toxiicxmonster/AuthorDesk`, `main`). Ignored: `AuthorDesk.exe`, `app/dist`, `node_modules`, `.env*`, `sync-server.txt`, databases, backups, exports.
- ✅ README rewritten for GitHub: install from Releases, building `AuthorDesk.exe`, packaging a release zip.
- 🟡 v0.1 release zip (`AuthorDesk.exe` + `dist/` + README.txt + `sync-server.example.txt`) built and checked by extracting it; publishing it needs `gh auth login`.

## Risks
- Browser storage eviction → `navigator.storage.persist()` requested; backup reminders; diagnostics show whether storage is protected.
- Launcher data tied to origin/profile → fixed port, documented; backups.
- Rule-based grammar has false positives → style rules off by default, per-rule disable, ignore list.

## Acceptance checklist (PROJECT.md §20)
- [x] App runs locally with documented commands.
- [ ] PWA installed on a phone (needs HTTPS host).
- [x] Create and reopen a project without data loss.
- [x] Create, rename, reorder, and jump between chapters.
- [x] Write and autosave manuscript text.
- [x] Search across chapters.
- [x] Open character/location reference while writing.
- [x] Create and move story board cards.
- [x] Run proofreading and accept/ignore/undo a suggestion.
- [x] Export a full project archive.
- [x] Import the archive into a clean workspace and verify content and links (automated).
- [x] Offline edits remain available after reconnecting (local-first; sync queue).
- [x] Sync conflicts preserve both versions (automated two-device test).
- [x] Google Drive import/export clearly marked as not yet verified.
- [x] No credentials or private manuscript content committed by default.
- [x] Desktop and phone layouts are usable.
- [x] Tests, lint, and type checks pass.
