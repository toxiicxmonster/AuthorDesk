# Project.md --- AuthorDesk

## 1. Project Overview

**Working name:** AuthorDesk\
**Product type:** Personal writing studio for novelists\
**Primary goal:** Build a focused writing application that combines
long-form manuscript writing, character/world reference, story planning,
chapter navigation, and writing assistance in one place.

The application should feel like a private author's workspace---not a
generic word processor and not a complicated project-management tool. It
must be comfortable to use on a Windows PC and on a phone, with reliable
synchronization and portable backups.

### Core user outcomes

1.  Write and edit a manuscript with minimal distraction.
2.  Jump quickly between books, parts, chapters, scenes, and notes.
3.  Keep character profiles, locations, factions, objects, lore,
    timelines, and plot threads close at hand.
4.  Plan the story with an outline and a visual story board.
5.  Receive Grammarly-style spelling, grammar, punctuation, clarity, and
    style suggestions without losing the author's voice.
6.  Sync work between PC and phone.
7.  Import and export the complete project, including manuscript and
    reference material, through Google Drive.
8.  Keep the source code in a private GitHub repository, while keeping
    private writing data protected.

------------------------------------------------------------------------

## 2. Important Architecture and Privacy Decision

**Do not assume that a private GitHub repository automatically makes a
GitHub Pages website private.** GitHub Pages is static hosting and is
not, by itself, a secure private-content system for personal
manuscripts. Do not put manuscript content, access tokens, or secrets
into a public-facing static build.

Use: - A **private GitHub repository for source code, issues, and
release history**. - A responsive **Progressive Web App (PWA)** that can
be installed on desktop and phone. - A local-first data model so writing
remains available offline. - An authenticated sync service or a properly
authenticated private storage integration for syncing user data. -
Google Drive integration for explicit import/export and optional
backups.

### Preferred implementation approach

Build the first version as a local-first web application/PWA. Store the
working copy locally on each device. Implement a sync abstraction so the
storage provider can be changed without rewriting the editor.

For private cross-device sync, choose one implementation after reviewing
current platform constraints: 1. **Recommended:** authenticated backend
with user login and a database/object store, with source code in private
GitHub. Keep manuscript data separate from source code. 2. **Optional
GitHub-based provider:** use a private repository as a data-sync
provider only through a secure server-side OAuth flow or another design
that never exposes a long-lived GitHub token in browser code. Do not put
a Personal Access Token in local storage, the source repository, or the
built PWA. 3. **Manual fallback:** export/import a complete project
archive, with a clear conflict warning.

Do not make GitHub Pages the only sync or privacy mechanism. If the user
ultimately wants GitHub Pages specifically, explain the privacy
limitations and propose a safe authenticated architecture before
implementing it.

------------------------------------------------------------------------

## 3. Target Platforms

### Phase 1

-   Windows desktop browser (Chrome/Edge).
-   Android phone browser, with installable PWA support.
-   Responsive layout for desktop, tablet, and phone.
-   Offline editing and local autosave.

### Design principles

-   Desktop: three-pane workspace where practical.
-   Phone: compact navigation, collapsible reference panel, comfortable
    writing width, touch-sized controls.
-   No destructive action without confirmation or a recoverable undo
    path.
-   Autosave continuously; show a clear saved/syncing/offline/error
    status.
-   Keyboard shortcuts on desktop, touch-friendly controls on mobile.
-   Respect browser safe areas and on-screen keyboards on phones.

------------------------------------------------------------------------

## 4. Main Navigation and Information Architecture

Top-level areas: 1. **Home / Projects** 2. **Manuscript** 3. **Story
Board** 4. **Characters** 5. **World & Reference** 6. **Timeline** 7.
**Plot Threads** 8. **Research & Notes** 9. **Writing Assistant** 10.
**Import / Export & Sync** 11. **Settings**

A project represents one book or a series. A series may contain multiple
books, and each book has its own manuscript and planning materials while
optionally sharing reference entries.

### Home dashboard

Show: - Recent books and recently edited chapters. - Continue Writing
button. - Word count for current book and selected date range. -
Chapter/scene completion status. - Sync state and last successful
sync. - Quick-create actions for chapter, character, location, plot
thread, and note. - Optional daily writing goal and progress.

Avoid turning the dashboard into a noisy analytics page.

------------------------------------------------------------------------

## 5. Manuscript Editor

The editor is the most important feature and must receive the most
testing.

### Manuscript hierarchy

`Series (optional) → Book → Part (optional) → Chapter → Scene`

Parts and scenes may be omitted. Chapters and scenes should be
reorderable by drag-and-drop, with accessible move-up/move-down
alternatives.

### Editor features

-   Rich, distraction-free long-form writing editor.
-   Support headings, paragraphs, italics, bold, block quotes, scene
    breaks, and basic inline formatting.
-   Autosave after edits, with a visible save state.
-   Word count and character count for the current selection, scene,
    chapter, and book.
-   Chapter and scene title fields.
-   Optional chapter summary and chapter status.
-   Focus mode that hides surrounding panels.
-   Find within current chapter and find across the manuscript.
-   Undo/redo.
-   Revision history or recoverable snapshots.
-   Keyboard shortcuts for save/sync, find, next/previous chapter, and
    focus mode.
-   Paste from common word processors with reasonable formatting
    cleanup.
-   Prevent accidental loss when navigating away or going offline.

### Fast chapter navigation

-   Persistent chapter navigator on desktop.
-   Collapsible chapter drawer on phone.
-   Search chapters by title or text.
-   Jump to a chapter in one or two actions.
-   Previous chapter / next chapter controls.
-   Recently opened chapters.
-   Optional bookmarks and pinned chapters.
-   Show chapter word count and status in the navigator.
-   Reordering chapters must not break links to notes, scenes, or
    references.

### Scene management

-   Scenes can be created, renamed, reordered, moved between chapters,
    and merged/split through explicit actions.
-   Each scene may have a POV character, location, time marker, summary,
    status, and notes.
-   Moving a scene should preserve its identity and backlinks.

------------------------------------------------------------------------

## 6. Character and Reference Database

Reference entries should be structured records, searchable and linkable
from manuscript text and planning cards.

### Character profile fields

-   Name and aliases.
-   Role (protagonist, antagonist, supporting, minor, etc.).
-   Short description.
-   Physical appearance.
-   Personality and temperament.
-   Goals, motivations, fears, and secrets.
-   Strengths, flaws, skills, and limitations.
-   Backstory.
-   Relationships to other characters.
-   Character arc at book/series level.
-   First appearance and last known appearance.
-   Current status.
-   Voice/dialogue notes.
-   Relevant timeline events.
-   Tags and custom fields.
-   Images or visual references (optional).
-   Freeform notes.

### Other reference types

Provide templates for: - Locations and regions. - Organizations,
factions, and families. - Species and cultures. - Items, artifacts,
technology, and magic. - Historical events and lore. - Rules,
terminology, and glossary. - Research links and citations.

### Reference usability

-   Search all reference records.
-   Filter by type, tag, book, and status.
-   Mark records as favorites.
-   Show backlinks: chapters, scenes, board cards, and notes that
    mention or link to a record.
-   Allow links between records, e.g. character ↔ location, character ↔
    faction, item ↔ owner.
-   Support aliases and alternate spellings.
-   Warn about likely duplicate names without blocking legitimate
    duplicates.
-   Provide a "quick reference" side panel in the editor that can be
    opened without leaving the current chapter.
-   Add a reference link to selected text using a picker; do not require
    the author to memorize special syntax.
-   Optional mention detection can suggest matching characters or
    locations, but must not silently rewrite text.

------------------------------------------------------------------------

## 7. Story Board and Outlining

Provide both a structured outline and a visual board. The board is for
planning, not a replacement for the manuscript.

### Views

-   **Outline view:** nested book/part/chapter/scene list.
-   **Board view:** movable cards arranged in columns or freeform lanes.
-   **Chapter view:** scenes and notes within a selected chapter.
-   **Plot-thread view:** follow one subplot across chapters.
-   **Timeline view:** order events by in-world time.

### Board card fields

-   Title.
-   Summary.
-   Type: scene, plot beat, idea, question, research, or reminder.
-   Assigned chapter/scene (optional).
-   POV character.
-   Location.
-   Timeline marker.
-   Plot thread(s).
-   Status: Idea, Planned, Drafting, Written, Revised, Final.
-   Tags and notes.
-   Linked reference entries.

### Board interactions

-   Create, edit, duplicate, move, reorder, and archive cards.
-   Drag cards between lanes/columns.
-   Convert a board card into a chapter or scene without losing notes
    and links.
-   Move a scene between chapters.
-   Filter by character, plot thread, POV, location, status, and tag.
-   Search all board cards.
-   Board changes must autosave and sync.
-   Mobile users must be able to reorder cards using accessible move
    controls if drag-and-drop is awkward.

### Suggested starter templates

-   Three-act structure.
-   Save the Cat-style beat sheet (template only; do not require a
    particular method).
-   Hero's Journey.
-   Blank outline.
-   Custom user-created templates.

Templates should be optional and editable.

------------------------------------------------------------------------

## 8. Timeline and Plot Threads

### Timeline

-   Store events with an in-world date/time or a relative marker
    (e.g. "three days before the siege").
-   Link events to characters, places, chapters, scenes, and plot
    threads.
-   Allow events whose exact date is unknown.
-   Show chronological and chapter-order views.
-   Flag possible continuity conflicts, such as a character appearing in
    two distant places at the same time, as suggestions---not definitive
    errors.
-   Support separate timelines for different books or story worlds.

### Plot threads

-   Create named plot threads with description, stakes, key characters,
    status, and resolution notes.
-   Link scenes and board cards to one or more threads.
-   View a plot thread across the outline.
-   Identify threads that have not appeared for many chapters, with
    configurable thresholds.
-   Do not automatically declare a thread abandoned; only flag it for
    author review.

------------------------------------------------------------------------

## 9. Grammarly-Style Writing Assistant

Create an integrated proofreading and editing layer inspired by
grammar-checking tools, but do not copy another product's branding or
claim feature parity.

### Core checks

-   Spelling.
-   Grammar.
-   Punctuation.
-   Capitalization.
-   Commonly confused words.
-   Repeated words and accidental duplication.
-   Basic readability and clarity suggestions.
-   Overused words and phrases.
-   Repeated sentence starts.
-   Dialogue punctuation suggestions.
-   Consistency checks for character names, locations, invented terms,
    and capitalization.
-   Optional passive-voice and adverb suggestions, presented as style
    suggestions rather than errors.

### UX requirements

-   Underline or mark suggestions in the editor without changing the
    manuscript automatically.
-   Clicking a suggestion opens a small explanation and one or more
    replacement options.
-   Actions: Accept, Ignore, Add to Dictionary, and Ignore this rule.
-   "Apply all" may only apply a clearly scoped set after preview and
    confirmation.
-   Support undo immediately after accepting a suggestion.
-   Differentiate definite errors from optional style suggestions.
-   Allow the author to disable categories or set a preferred
    language/dialect (e.g. US or UK English).
-   Add a custom dictionary for invented names and fictional
    terminology.
-   Never silently alter prose.
-   Never send manuscript text to a third-party service without clear
    opt-in, explanation of what is sent, and an off switch.

### Implementation strategy

-   Build the proofreading provider behind a replaceable interface.
-   Start with local deterministic checks and browser spell-check
    support where useful.
-   Add an optional grammar service later if a suitable provider is
    selected. Keep API keys server-side; never ship secret keys in the
    client.
-   Show when a check is unavailable offline.
-   Store suggestion metadata separately from manuscript text.
-   Make it possible to re-run checks after a chapter changes.
-   Treat AI-generated rewrites as optional suggestions, never as
    authoritative corrections.

### Suggested provider interface

A proofreading provider should accept text plus language/settings and
return structured suggestions: - start and end offsets. - category and
severity. - short explanation. - replacement candidates. - rule
identifier. - provider identifier. - confidence if available.

Offsets must be validated against the exact text version they were
generated from. If the text changes before a suggestion is applied, mark
the suggestion stale and do not apply it to the wrong text.

------------------------------------------------------------------------

## 10. Sync, Offline Use, and Conflict Handling

Sync must be designed deliberately; never use "last write wins" blindly
for the whole project.

### Requirements

-   Local-first editing with automatic local persistence.
-   Background sync when connectivity returns.
-   Clear states: Local only, Syncing, Synced, Offline, Conflict, and
    Sync error.
-   Per-record change tracking and timestamps.
-   Conflict detection when the same record changes on two devices.
-   For conflicting prose edits, preserve both versions and offer a
    side-by-side resolution screen.
-   For independent records, merge changes where safe.
-   Never silently overwrite a newer chapter with an older copy.
-   Keep recoverable versions/snapshots.
-   Display last successful sync time and account/provider.
-   Provide manual "Sync now" and "Resolve conflicts" actions.
-   Handle interrupted uploads and retries safely.
-   Do not treat a device clock as the only source of truth for conflict
    resolution.
-   Include a sync status page with diagnostics that do not reveal
    manuscript contents.

### GitHub requirements and safeguards

-   Keep source code in a private GitHub repository.
-   Do not commit manuscript data by default.
-   Do not store secrets, OAuth tokens, or personal access tokens in
    source files, browser storage, logs, or exported diagnostics.
-   If a GitHub repository is used as a data provider, use a secure
    authorization flow and document the threat model.
-   Use atomic or version-aware updates where possible.
-   Handle API rate limits and network failures.
-   Document how to revoke the app's access.
-   Provide an alternative export path so users are never locked into
    GitHub.

### Data safety

-   Local autosave should not depend on successful network sync.
-   Add a warning before clearing local data.
-   Provide backup reminders or an optional scheduled backup.
-   Make it possible to export the project even if sync is broken.
-   Do not log full manuscript text by default.

------------------------------------------------------------------------

## 11. Google Drive Import and Export

Google Drive support is required for complete project portability.
Implement this through an explicit user-authorized Google sign-in/OAuth
flow; never ask the user to paste their Google password.

### Export formats

1.  **AuthorDesk Project Archive (`.authorproj` or `.zip`)** ---
    complete restorable project.
2.  **Markdown (`.md`)** --- chapters/scenes and reference notes, with a
    clear folder structure.
3.  **DOCX** --- manuscript export suitable for editing or sharing in
    word processors.
4.  **Plain text (`.txt`)** --- clean manuscript export.
5.  **JSON** --- structured data export for migration and backups.
6.  **CSV** --- optional export for tabular lists such as characters and
    locations.

### Full project archive contents

-   Project manifest with schema version.
-   Books, parts, chapters, scenes, and manuscript text.
-   Characters and relationship links.
-   Locations, factions, items, lore, glossary, and other references.
-   Board cards, lanes, outlines, and templates.
-   Timeline events and plot threads.
-   Research notes and source links.
-   Tags, settings, custom dictionary, and user preferences.
-   Optional images/attachments.
-   Stable IDs and timestamps.
-   Data integrity manifest/checksums where practical.

### Import behavior

-   Preview what will be imported before changing existing data.
-   Support importing a new project or merging into an existing project.
-   Detect duplicates and ID collisions.
-   Offer choices for duplicate records: keep existing, import as copy,
    or merge where safe.
-   Never overwrite the current project without explicit confirmation.
-   Validate archive schema and file sizes; reject malformed or unsafe
    archive entries.
-   Show a useful report of imported, skipped, and conflicting items.
-   Support round-trip testing: export a project, import it into a clean
    workspace, and verify the content/relationships match.

### Google Drive UX

-   Connect/disconnect Google Drive.
-   Choose destination folder.
-   Export a snapshot to Drive.
-   Import from Drive.
-   Optional manual "Back up now" and "Restore backup".
-   Do not silently replace the latest backup; create versioned backups
    or ask before overwriting.
-   Make it clear whether the app is importing, exporting, or merely
    creating a backup.
-   Explain required Drive permissions in plain language and request the
    narrowest feasible scope.
-   If Google Drive integration is deferred, complete local archive
    import/export first and design a provider interface so Drive can be
    added without changing the data model.

------------------------------------------------------------------------

## 12. Search, Linking, and Cross-References

Global search should search: - Manuscript text. - Chapter and scene
titles. - Character and reference fields. - Board cards. - Timeline
events. - Plot threads. - Notes and research.

Search features: - Search filters by content type, book, chapter, tag,
and status. - Recent searches (optional). - Search result snippets with
the matching text. - Open the result at the correct
chapter/scene/record. - Provide a keyboard shortcut on desktop. - Search
must work on local data while offline.

Add backlinks and "mentioned in" panels wherever useful. Deleting a
linked reference should warn about affected links and offer
archive/replace/cancel rather than silently breaking them.

------------------------------------------------------------------------

## 13. Data Model and Technical Requirements

Use stable IDs for every entity. Prefer a normalized structured data
model, with manuscript text stored in a format that preserves editing
and export fidelity.

Suggested entities: - `Workspace` - `Series` - `Book` - `Part` -
`Chapter` - `Scene` - `Character` - `Relationship` - `ReferenceEntry`
(or typed entities for Location, Faction, Item, Species, Lore,
GlossaryTerm) - `Board` - `BoardLane` - `BoardCard` - `PlotThread` -
`TimelineEvent` - `Note` - `Attachment` - `Tag` -
`CustomDictionaryEntry` - `WritingGoal` - `RevisionSnapshot` -
`SyncChange` - `ImportExportJob` - `UserSettings`

Common record fields: - `id` (stable UUID or equivalent). -
`workspaceId` and relevant parent IDs. - `createdAt`, `updatedAt`. -
`archivedAt` where soft deletion is appropriate. - `schemaVersion` where
needed. - `tags` and relationships as IDs, not duplicated display names.

Use migrations for schema changes. Unknown fields from a newer export
should be preserved where practical or produce a clear compatibility
warning rather than being silently discarded.

### Suggested stack (confirm during initial technical spike)

-   TypeScript.
-   React.
-   Vite.
-   PWA service worker.
-   IndexedDB for local structured data and offline use.
-   A robust editor framework such as TipTap/ProseMirror or another
    actively maintained editor that supports structured documents and
    selection-aware suggestions.
-   A backend API and database for authenticated sync if using the
    recommended backend model.
-   Automated tests for import/export, migrations, autosave, and sync
    conflict cases.

Do not commit to a particular backend vendor until comparing cost,
authentication, data portability, offline support, and ease of
self-hosting. Keep storage and sync behind interfaces.

------------------------------------------------------------------------

## 14. UI Layout

### Desktop writing workspace

-   **Left sidebar:** book selector, chapter/scene navigator, outline.
-   **Center:** manuscript editor.
-   **Right sidebar:** quick-reference panel, character/location cards,
    notes, proofreading suggestions.
-   Panels can collapse independently.
-   Editor should have a comfortable line length and adjustable font
    size, line spacing, and theme.

### Phone writing workspace

-   Main editor occupies most of the screen.
-   Chapter navigation is available from a clearly labeled button.
-   Quick reference, board, and proofreading are accessible in a bottom
    sheet or dedicated tab.
-   Buttons must not be hidden behind the keyboard.
-   Autosave and sync indicators remain visible without obstructing
    text.
-   Support portrait mode first; do not depend on hover.

### Visual style

-   Calm, readable, author-focused.
-   Neutral interface with optional light and dark themes.
-   Avoid excessive panels, animations, and bright warning colors.
-   Distinguish content types with subtle icons/labels.
-   Ensure accessible contrast, keyboard navigation, and screen-reader
    labels.

------------------------------------------------------------------------

## 15. Security and Privacy

-   Use secure authentication for remote sync and Google Drive.
-   Keep server secrets out of client bundles.
-   Request only necessary account permissions.
-   Provide disconnect and revoke-access instructions.
-   Avoid sending manuscript text to external grammar/AI services unless
    explicitly enabled.
-   Do not use manuscript contents for analytics or model training.
-   Do not log manuscript text or tokens.
-   Use HTTPS for all remote connections.
-   Sanitize imported files and validate file types/size.
-   Make privacy behavior visible in Settings.
-   Document what is stored locally, what is sent to sync storage, and
    what is sent to third-party providers.
-   Provide a "delete cloud copy" workflow where supported, with clear
    explanation that local exports/backups may remain.

------------------------------------------------------------------------

## 16. Accessibility and Reliability

-   Keyboard-accessible navigation and editor controls.
-   Touch targets suitable for phone use.
-   Clear focus indicators.
-   Do not convey errors using color alone.
-   Confirm destructive operations.
-   Recover from refreshes, browser crashes, and temporary offline
    states.
-   Display actionable errors instead of generic "Something went wrong."
-   Test large manuscripts and large reference databases.
-   Avoid blocking the editor while global search or proofreading runs.
-   Keep the editor responsive while saving or syncing in the
    background.

------------------------------------------------------------------------

## 17. Testing Requirements

Automated tests are required for core behavior, not just visual
rendering.

### Unit tests

-   Word count and text utilities.
-   Stable IDs and relationship operations.
-   Data validation and schema migrations.
-   Proofreading suggestion offsets and stale-suggestion protection.
-   Archive manifest and integrity checks.

### Integration tests

-   Autosave and recovery.
-   Chapter/scene reorder while preserving IDs and links.
-   Reference backlinks.
-   Import/export round trips.
-   Sync merge and conflict handling.
-   Google Drive authorization and upload/download, once implemented.
-   Offline editing followed by reconnection.
-   Permission failure and revoked-token behavior.

### End-to-end tests

-   Create a project, book, chapter, scene, character, and board card.
-   Write text, refresh, and verify it persists.
-   Navigate rapidly between chapters.
-   Open quick reference while writing.
-   Accept and undo a proofreading suggestion.
-   Export a full project and import it into a clean workspace.
-   Make changes on two simulated devices and verify conflicts are
    preserved.
-   Test phone-sized layout and virtual keyboard behavior.

### Definition of done

A feature is not complete until: - It works on desktop and phone
layouts. - Data persists across reloads. - Errors are understandable. -
Relevant automated tests pass. - No secrets are exposed. - It is
documented in the project README. - Import/export or sync behavior is
tested where applicable.

------------------------------------------------------------------------

## 18. Development Phases

Claude Code should implement this in small, testable phases. Do not
attempt the entire application in one giant change. Keep `PROJECT.md`
(this file), `README.md`, and a running `IMPLEMENTATION_PLAN.md`
updated.

### Phase 0 --- Repository and technical design

-   Inspect the existing repository before changing anything.
-   If empty, scaffold the project.
-   Add architecture notes, development commands, linting, formatting,
    type checking, and tests.
-   Create `.gitignore` and `.env.example`.
-   Confirm PWA, local storage, editor, and sync architecture.
-   Write a short architecture decision record for the selected private
    sync approach.
-   Verify the chosen approach does not expose private manuscripts or
    tokens.

### Phase 1 --- Usable local writing MVP

-   Projects and books.
-   Chapters and scenes.
-   Editor with autosave, word count, undo/redo, and quick chapter
    navigation.
-   Local persistence and crash/refresh recovery.
-   Responsive desktop and phone layouts.
-   Basic global search.
-   Local-only status indicator.

**Milestone:** The user can write a small book locally, close/reopen the
app, and reliably find and edit any chapter.

### Phase 2 --- Reference library

-   Character profiles.
-   Locations, factions, items, lore, glossary, and notes.
-   Tags, links, backlinks, and editor quick-reference panel.
-   Global reference search.

**Milestone:** The user can write while looking up characters and world
details without losing their place.

### Phase 3 --- Story planning

-   Outline and visual board.
-   Scene cards, statuses, filters, and reordering.
-   Plot threads.
-   Timeline events.
-   Convert cards to scenes and back while preserving data.

**Milestone:** A complete outline can be planned and connected to
manuscript scenes.

### Phase 4 --- Proofreading

-   Custom dictionary.
-   Spelling and deterministic writing checks.
-   Suggestion panel with accept/ignore/undo.
-   Stale suggestion protection.
-   Optional grammar provider interface.
-   Privacy settings for any external provider.

**Milestone:** Suggestions help the author while never silently changing
text.

### Phase 5 --- Complete archive import/export

-   Versioned project archive.
-   JSON, Markdown, TXT, and DOCX export as feasible.
-   Preview and validate imports.
-   Duplicate/conflict handling.
-   Round-trip tests.

**Milestone:** The full project can be backed up and restored without
losing relationships.

### Phase 6 --- Cross-device sync

-   Authentication and chosen sync provider.
-   Local-first background sync.
-   Conflict detection and resolution.
-   Sync diagnostics and retry.
-   Test with two independent browser profiles/devices.

**Milestone:** A chapter edited on PC becomes available on the phone,
and conflicting edits are never silently lost.

### Phase 7 --- Google Drive

-   OAuth connection.
-   Folder selection.
-   Export snapshot, import project, and versioned backup.
-   Disconnect/revoke workflow.
-   Permission and error handling.

**Milestone:** The user can move a complete project to/from Google Drive
and restore it.

### Phase 8 --- Hardening and polish

-   Accessibility audit.
-   Large-manuscript performance.
-   PWA install/offline tests.
-   Security review.
-   Backup/restore walkthrough.
-   User documentation and release checklist.

------------------------------------------------------------------------

## 19. Claude Code Working Instructions

1.  Start by inspecting the repository and reporting the current stack,
    structure, and any existing functionality.
2.  Read this file fully before planning implementation.
3.  Do not delete or rewrite existing work without understanding it.
4.  Create `IMPLEMENTATION_PLAN.md` with tasks, dependencies, risks, and
    acceptance checks.
5.  Implement one phase at a time; run tests and type checks after each
    meaningful change.
6.  Keep modules small and maintain clear boundaries between editor,
    domain model, local storage, sync providers, proofreading providers,
    and import/export.
7.  Use typed interfaces and schema validation for persisted/imported
    data.
8.  Do not use fake success states for save, sync, OAuth, or export
    operations.
9.  Do not store private manuscripts in the source-code repository by
    default.
10. Never hardcode credentials or commit `.env` files.
11. Use environment variables and provide `.env.example` with
    placeholder values only.
12. If an external service requires account setup, credentials, billing,
    or a manual OAuth-console step, stop at a secure integration
    boundary and document exactly what the user must configure.
13. Do not claim Google Drive or GitHub sync is working until tested
    with real authorization and a round-trip test.
14. Prefer a working, tested local MVP over a large unfinished scaffold.
15. Keep `README.md` current with setup, development, testing,
    deployment, backup, and known limitations.
16. Ask a concise question only when a decision blocks safe
    implementation. Otherwise use the recommended defaults in this
    document and record the decision.

------------------------------------------------------------------------

## 20. Initial Acceptance Checklist

-   [ ] App runs locally with documented commands.
-   [ ] PWA can be installed on a supported device.
-   [ ] Create and reopen a project without data loss.
-   [ ] Create, rename, reorder, and jump between chapters.
-   [ ] Write and autosave manuscript text.
-   [ ] Search across chapters.
-   [ ] Open character/location reference while writing.
-   [ ] Create and move story board cards.
-   [ ] Run proofreading and accept/ignore/undo a suggestion.
-   [ ] Export a full project archive.
-   [ ] Import the archive into a clean workspace and verify content and
    links.
-   [ ] Offline edits remain available after reconnecting.
-   [ ] Sync conflicts preserve both versions.
-   [ ] Google Drive import/export is authorized and tested, or clearly
    marked as not yet implemented.
-   [ ] No credentials or private manuscript content are committed to
    the source repository by default.
-   [ ] Desktop and phone layouts are usable.
-   [ ] Tests, lint, and type checks pass.

## 21. Product Principle

**The manuscript is the source of truth; planning tools support it, and
writing assistance advises rather than takes control.** The author must
always be able to find, export, recover, and retain ownership of their
work.
