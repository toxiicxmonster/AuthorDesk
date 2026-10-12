# Architecture

```
┌──────────── Device (PC or phone) ─────────────┐        ┌── optional ──┐
│ React UI ─ TipTap editor ─ proofreading worker │        │ Sync server  │
│        │                                       │ HTTPS  │ Node+SQLite  │
│ repository (stable ids, rev, change log)       │◄──────►│ versioned    │
│        │                                       │ cookie │ records      │
│ IndexedDB (Dexie) — the working copy           │        └──────────────┘
│        │                                       │
│ import/export (.authorproj, md, docx, …) ──────┼──► files / Google Drive
└────────────────────────────────────────────────┘
PC only: AuthorDesk.exe serves app/dist on localhost:47820 and proxies /api/* to the sync server.
```

## Boundaries

| Module | Responsibility | Depends on |
| --- | --- | --- |
| `domain/` | Zod schemas (source of truth for persisted/imported shape), text utilities, reference/continuity/thread logic. Pure. | — |
| `storage/` | Dexie database, repository functions (create/update/archive/reorder/move/split/merge, snapshots, change log), search, backlinks, migrations, settings. | domain |
| `editor/` | TipTap configuration, refLink mark, proofreading & find plugins, autosave/flush, find bar. | storage, proofreading |
| `proofreading/` | `ProofreadingProvider` interface, deterministic rules, Hunspell spell worker. No DOM, no storage. | domain |
| `importExport/` | Archive build/parse/validate/import, exporters (DOCX/TXT/MD/JSON/CSV), text import, import-your-own-files (`bundleImport`, tolerant `csv`), Amazon KDP publishing (`publish` model + preflight, `epub`, `kdpDocx`), Google Drive client. | storage, domain |
| `sync/` | Three-way merge (pure), sync engine (transport-agnostic), controller (HTTP transport, status, background scheduling). | storage |
| `ui/` | Pages, components, hash router, UI store (toasts/dialogs/panels), themes (`theme.ts`: five base colours → CSS tokens, contrast check). | everything above |

## Data model

Every record has `id` (UUID), `projectId`, `createdAt`, `updatedAt`, `archivedAt` (soft delete), and `rev` (incremented on every local write). Relationships are ids, never names. Manuscript prose is stored as ProseMirror JSON (`Scene.content`) plus derived `plainText`, `wordCount` and `referenceIds` for search, counts, exports and backlinks.

Tables: projects, books, parts, chapters, scenes, references (typed: character, location, faction, species, item, lore, glossary, research), plotThreads, timelineEvents, boardLanes, boardCards, notes, snapshots, dictionary; plus local-only settings, changes (sync queue, one entry per record), ignored suggestions, syncMeta (last agreed server version/base), conflicts.

Schema evolution: Dexie versions for indexes; `storage/migrations.ts` for record shapes (also applied to imported archives). Zod `looseObject` keeps unknown fields from newer versions instead of dropping them; a newer local schema blocks startup with a clear message rather than risking data.

## Key behaviours

- **Autosave:** editor changes save ~0.7 s after typing stops, on navigation (flush), on tab hide/unload, and Ctrl+S. Failures retry and show a persistent banner. Snapshots: at most every 10 minutes while writing (40 kept per scene) and before split/merge/restore/import/sync overwrite.
- **Proofreading:** rules run per text block; spelling runs in a worker. Results are placed as decorations with document positions and mapped through edits; any edit inside a flagged range drops it. Applying re-checks the exact text first (stale protection) and is a normal undoable transaction.
- **Search:** in-memory scan of local data; fast enough for typical novels (hundreds of thousands of words) and works offline.
- **Archive format:** zip with `manifest.json` (format, schema version, counts, SHA-256 per file), `data/<table>.json`, `preferences.json`, `boardTemplates.json`. Import validates paths, sizes, checksums and every record before touching data, and previews new/identical/different counts.
- **Sync:** see `docs/sync-server.md` and ADR 0002.
- **Import your own files:** reads a folder/zip of chapter files and CSV sheets into an in-memory bundle, previews it, then writes everything through the repository so ids, revs and the change log are normal. Links are resolved by name/alias; unmatched names are reported, never guessed.
- **KDP publishing:** `publish.ts` builds a format-independent model (chapters, front/back matter, smart punctuation on a copy, page estimate, preflight). `epub.ts` writes EPUB 3 (mimetype stored first, nav + NCX + landmarks); `kdpDocx.ts` writes eBook or print `.docx` with the `docx` library, then post-processes `settings.xml` to add `<w:mirrorMargins/>` in schema order. The manuscript itself is never modified.
- **Themes:** a theme is five colours; `theme.ts` derives the full token set and applies it as CSS variables on `:root`. Custom themes are stored in settings and exported as small JSON files.
