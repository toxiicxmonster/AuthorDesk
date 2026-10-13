# AuthorDesk user guide

## Getting around

- Press **Ctrl+K** (or click *Jump to…* at the top, or 🔍 on a phone) and type a few letters to jump to any chapter, character, place, note or board card, or run a command like *New chapter*, *Back up now* or *Theme: Night*.
- Press **F1** or **?** for help at any time.
- New here? Choose *Look around with a sample book* on the welcome screen.

## Themes

Click **◐** in the top bar to switch between Paper, Sepia, Pastel Blue, Sage, Cozy Cottage, Night or *Match my device*. To make your own: Settings → Theme → *Create a theme*, pick five colours (background, panels, writing page, text, accent) and watch the whole app update as you go. AuthorDesk tells you if the text would be hard to read. Use *Share* to save a theme as a file and *Import a theme file* to add one.

## Writing

- **Home** shows your book’s word count, today’s words (set a daily goal), recent scenes, quick-create buttons and backup status. **Continue writing** reopens where you left off.
- **Write:** the chapter list is on the left (☰ or Ctrl+\\ to toggle), the page in the middle, tools on the right (◧). Each chapter has one or more scenes; with one scene the chapter simply *is* the scene.
- Everything saves automatically; the badge at the top shows *Saving soon… / Saving… / All changes saved*. If saving ever fails you’ll see a red banner — keep the window open.
- Toolbar: bold, italic, underline, heading, block quote, scene break (⁂), undo/redo, link to reference (🔗), find (🔍), snapshot (📸), focus mode (◎).
- Chapter ⋯ menu: rename, move, add scene, insert chapter after, pin, put in a part, Move to Trash (restore it from 🗑 Trash at the bottom of the list). Double-click a chapter to rename it. Drag chapters or scenes to reorder; drop a scene on another chapter to move it.
- **Scene notes** tab (right panel): chapter/scene titles, summaries, status, POV, location, time marker, plot threads, notes, split at cursor, merge with next, create a board card.
- **History tab:** snapshots of the scene; preview, copy or restore (your current text is snapshotted first).

## References

Create characters, places and more in **References**. While writing, select a name and press 🔗 to link it; click linked text to see the entry in the side panel. The panel also lists entries mentioned in the scene. Each entry shows where it is linked or mentioned. Archive entries to hide them without breaking links.

## Planning

- **Story Board:** lanes and cards; drag or use a card’s ⋯ menu to move. Open a card to set POV, location, threads, tags and notes, and to turn it into a scene or chapter. ⋯ → *Add structure from template* for three-act and other structures.
- **Outline** (Board → Outline): every chapter and scene with editable summaries.
- **Timeline:** events with a date or relative marker and an optional order number. Possible continuity questions appear at the top — they are hints, not errors.
- **Plot Threads:** a grid of which chapters each thread appears in; long-quiet threads get a gentle reminder.

## Dedication & About the Author

On your book's **Home** page, the *Dedication & About the Author* card holds these pages. Write each one once and choose where it applies:

- **All my books (every project)**: handy for an author bio.
- **All books in this project**: for a series.
- **Only these books**: for a dedication to one book.

When you export (Word, plain text, Markdown or Amazon KDP), the right page for that book is picked automatically. You can choose a different one, or leave it out, in the export dialog.

## Proofreading

Suggestions appear as you write, a moment after you pause, like Grammarly or Google Docs. Underlines: wavy red = likely error, amber = worth checking, dotted blue = style idea (off by default; turn on in Settings). Click one to accept, ignore, add the word to your dictionary, or turn that check off. The **Suggestions** tab lists everything and can apply a reviewed batch of fixes. Ctrl+Z undoes any accepted change. Checks you turned off are listed by name in Settings → Proofreading, each with a *Turn back on* button.

**Stronger words.** When a verb leans on an adverb or "very" props up an adjective, AuthorDesk offers one precise word in the same tense instead: *ran quickly* → *sprinted / raced / dashed*, *said angrily* → *snapped / growled*, *very tired* → *exhausted*. Speech tags that say the same thing twice (*whispered quietly*, *replied back*) offer the plain verb.

**Dialogue assistant.** The side panel's **Dialogue** tab shows, for the open scene, how much of it is spoken, who speaks and how often (matching first names to your characters), which speech tags you use, and what might lose a reader: several lines in a row with no speaker named, two speakers in one paragraph, or a quotation that's never closed. A speech that runs on into the next paragraph, with its quote left open, is recognized as correct. Click any item to jump to it.

**Add-ons: set up once.** The first time AuthorDesk starts, it offers to install its two private add-ons, the grammar engine and the AI Editor (about 17 GB together; it checks your free space first). Both are ticked; untick either, or choose *Not now* (it asks again next launch) or *Don't ask again*. They download in the background while you write, with a small progress card in the corner, and each switches on the moment it's ready: no restart. If you close AuthorDesk mid-download, it carries on where it left off next time. **Settings → Add-ons** shows what's installed and has an *Install* button for anything that isn't. You can still install them by hand with the scripts below.

**AI Editor (optional, on this PC).** Install it once with `powershell -ExecutionPolicy Bypass -File scripts\install-ai-editor.ps1` (about 8 GB). It uses llama.cpp and an open-source model (Mistral-Nemo 12B on graphics cards with 10 GB or more, Qwen2.5 7B otherwise): no account, no subscription, nothing sent anywhere. Open the side panel's **AI Editor** tab (or select text and choose *Ask AI Editor…*). It works on the selection or the paragraph at the cursor: **Rewrite**, **Smoother**, **Tighter**, **Without the adverb**, **Clearer**, **Fix grammar**, **Change tone**, **Show, don't tell**, **Character voice** (using that character's notes) and **Ask**. Results appear in the panel with the changes highlighted; **nothing is ever written into your book**, so copy what you like and paste it yourself. Notes for any listed characters in the passage are used as background, so suggestions stay true to them. *Find character details in this scene* lists facts about your characters that their entries don't have yet, each with *Add to entry*. With the AI Editor installed, flagged adverbs are also read in context first: only the weak ones stay underlined, with the AI's reason in the hover text (turn this off in Settings → Proofreading → AI Editor). The model loads the first time you use it (10–20 seconds) and unloads after 15 idle minutes.

**Character details.** When you describe a listed character, AuthorDesk notices details their entry doesn't have yet, like *"Winnie pushed her auburn hair back"*, and underlines them in **green**; click to add "Hair: auburn" to her Physical appearance. A detail that contradicts the entry is underlined in **purple**: update the entry, or keep it and fix the text yourself. These only ever change the character's entry, never your book, and each has Undo. Underline colours: red wavy = likely error, purple double = contradicts a character, amber = check, blue dotted = style, green dashed = a character detail to add.

**Grammar engine on this computer (recommended).** For the most thorough checking (full-sentence grammar, verb forms, confused words like *affect/effect* from real usage statistics, and style), install the private grammar engine once: run `powershell -ExecutionPolicy Bypass -File scripts\install-grammar-engine.ps1` from the AuthorDesk folder. It downloads LanguageTool, its English usage data and a Java runtime (about 9 GB, into `%LOCALAPPDATA%\AuthorDesk\grammar-engine`; no admin rights needed). After that, AuthorDesk starts the engine by itself and uses it automatically: nothing leaves this PC and there are no rate limits. It takes a few seconds to warm up after AuthorDesk starts. Settings → Proofreading → *Deep grammar check* shows whether it's ready and lets you turn it off. Every underline explains itself when you hover over it; findings without a concrete fix are left out.

**Online grammar check (optional).** Settings → Proofreading → *Turn on online check…* adds deeper grammar and style checks from LanguageTool, a free service with no account. Before anything is sent, AuthorDesk explains exactly what goes where: only the paragraphs of the scene you're editing, a couple of seconds after you pause, and only paragraphs that changed. Suggestions from it are labelled *LanguageTool* in the Suggestions tab. It pauses while you're offline, and you can turn it off at any time. To keep text on machines you control, tick *Use my own LanguageTool server* and enter its address (for example `http://localhost:8081/v2/check` for LanguageTool running in Docker on this PC).

## Publishing on Amazon KDP

Backup & Sync → **Publish on Amazon KDP…** (or Ctrl+K → *Publish*).

1. Choose **Kindle eBook** (EPUB, recommended), **Kindle eBook (Word)**, or **Paperback / hardcover** (pick the trim size you'll select on KDP, a font and text size).
2. Choose how chapter headings look and which extra pages to include (title, copyright, **table of contents**). The **Dedication** and **About the Author** menus pick the pages you wrote on Home (automatically, a different one, or none). eBook contents link to each chapter (Kindle's own Go To menu is always included). For print you can list chapters only, or add page numbers — those are filled in by Microsoft Word, so open the file in Word, choose **Yes** when it asks to update fields, and save before uploading. Curly quotes and em dashes are applied to the exported copy only — your manuscript isn't changed.
3. Fill in the book details (author name, copyright year, optional imprint and ISBN). They're saved with the book for next time.
4. Read the checklist at the bottom (it warns about empty chapters, leftover "TK"/"TODO" notes, and books under 24 or over 828 print pages), then save the file.
5. On kdp.amazon.com, upload it as the **manuscript** on the Content page. For print, choose the same trim size and **No bleed**, then check every spread in KDP's **Print Previewer**. For eBooks, check it in the **Kindle Previewer**. Covers are uploaded separately.

If you change the book later, export again and re-upload; KDP replaces the old file.

## Bringing in an existing book

Backup & Sync → **Import your own files** (or *Bring in my existing book* on the welcome screen). Chapters go in a `chapters/` folder as `.md` or `.txt` files; characters, places, the story board, timeline and plot threads go in CSV spreadsheets. Every detail is in [IMPORTING.md](../IMPORTING.md).

## Backups

Backup & Sync → **Save backup** regularly and keep copies elsewhere (USB drive, cloud folder). To restore: **Import** → choose the file → review → Restore, Merge, or Import as a copy. Exports to Word, text, Markdown, JSON and CSV are there too.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| Ctrl+K / Ctrl+Shift+F | Search everything |
| Ctrl+F | Find & replace in scene |
| Ctrl+S | Save now |
| Alt+PageDown / PageUp | Next / previous chapter |
| Alt+Shift+PageDown / PageUp | Next / previous scene |
| Ctrl+Alt+F | Focus mode (Esc exits) |
| Ctrl+\\ | Toggle chapter list |
