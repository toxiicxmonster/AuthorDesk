# Importing an existing book into AuthorDesk

This guide explains exactly how to lay out your files so AuthorDesk can bring in your **chapters, characters, locations, other world notes, story board, timeline, plot threads and research notes** in one go.

- In the app: **Backup & Sync → Import your own files → Choose a folder…** (or *Choose a .zip or files…*).
- On a brand-new install: choose **Bring in my existing book** on the welcome screen.
- You always see a preview first. Nothing you already have is changed or deleted. Chapters are added after your existing ones. (A brand-new book's empty "Chapter 1" is moved to Trash so your chapters come first.)

**Easiest start:** in the app, click **Download a starter template**. It contains a filled-in example of every file below (the same files as [`docs/import-template/`](docs/import-template/)). Replace the example content with yours and import the folder.

---

## 1. The folder layout

Put everything in one folder (any name). **Every file is optional** — include only what you have.

```
My Book/
├── chapters/                      ← one file per chapter
│   ├── 01 - The Lamp.md
│   ├── 02 - Below.txt
│   └── 10 - The Return.md
├── characters.csv                 ← spreadsheet, one row per character
├── characters/                    ← OR / AND one file per character
│   └── Elsie Marr.md
├── locations.csv                  ← spreadsheet, one row per place
├── locations/                     ← OR / AND one file per place
├── world.csv                      ← factions, items, lore, terms… (has a Type column)
├── board.csv                      ← story board cards
├── timeline.csv                   ← timeline events
├── plot-threads.csv               ← subplots
└── notes/                         ← research notes, one file each
    └── How lighthouse lamps worked.md
```

The names matter (capitals don't). Accepted alternatives:

| Content | File / folder names accepted |
| --- | --- |
| Chapters | folder `chapters/`, or one file `manuscript.md` / `book.md` / `draft.md` / `novel.md` (or any single `.md`/`.txt` at the top level) |
| Characters | `characters.csv`, `people.csv`, `cast.csv`; folder `characters/` or `people/` |
| Locations | `locations.csv`, `places.csv`, `settings.csv`; folder `locations/` or `places/` |
| Other world entries | `world.csv`, `references.csv`, `worldbuilding.csv`, `story bible.csv` |
| Story board | `board.csv`, `storyboard.csv`, `story-board.csv`, `cards.csv`, `outline.csv` |
| Timeline | `timeline.csv`, `events.csv` |
| Plot threads | `plot-threads.csv`, `plot threads.csv`, `threads.csv`, `subplots.csv` |
| Notes | folder `notes/` or `research/` |

A zipped copy of the folder works too. Files that don't fit the layout (pictures, Word files, etc.) are skipped and listed in the preview.

**File types:** chapters, profiles and notes are `.md` (Markdown) or `.txt`. Spreadsheets are `.csv` (or `.tsv`).

---

## 2. Chapters

One file per chapter inside `chapters/`. Files are imported in **name order**, and numbers are compared as numbers (`2` comes before `10`). Start names with a number to control the order: `01 - The Lamp.md`, `02 - Below.txt`.

Inside a chapter file:

```markdown
# The Lamp                     ← chapter title (optional)

## Counting the steps          ← starts a scene called "Counting the steps" (optional)

Mara climbed the two hundred and twelve steps…   ← paragraphs are separated by a blank line

At the top, the lamp ticked like a patient clock. *Not here.*   ← *italic*, **bold**

* * *                          ← a scene break inside the scene (also *** or #)

By morning she had decided not to tell Tobias.

## The quay                    ← a second scene in the same chapter

"Fog's a liar," Tobias said.
```

Rules:

- **Chapter title:** the first line starting with `# `. In a `.txt` file, a short first line followed by an empty line also counts (no full stop at the end). Otherwise the file name is used without its leading number (`07 - The Storm.txt` → *The Storm*).
- **Scenes:** each `## Heading` starts a new scene with that title. With no `##` lines, the whole chapter is one scene.
- **Paragraphs:** separate them with an empty line. If a file has no empty lines at all, each line becomes its own paragraph.
- `### Heading` becomes a small heading. A line starting with `>` becomes a block quote.

**All chapters in one file?** Name it `manuscript.md` (or put any single `.md`/`.txt` at the top level). A new chapter starts at every `# Title` line, or at every line that begins with *Chapter*, *Prologue* or *Epilogue*.

**From Word:** *File → Save As → Plain Text (.txt)* — one file per chapter, or the whole book as `manuscript.txt`. **From Google Docs:** *File → Download → Markdown (.md)*. **From Scrivener:** *File → Export → Files…* as plain text or Markdown into the `chapters/` folder.

---

## 3. Spreadsheets (CSV) — general rules

Make them in Excel, Google Sheets, Numbers or LibreOffice, then save or download as **CSV**:

- **Excel:** *File → Save As → CSV UTF-8 (Comma delimited)*.
- **Google Sheets:** *File → Download → Comma-separated values* (one file per tab).
- **Numbers:** *File → Export To → CSV*.

Rules for every sheet:

1. **Row 1 holds the column names.** Columns can be in any order. Capitals, spaces and punctuation in the names don't matter (`Also known as` = `also-known-as` = `ALSOKNOWNAS`).
2. **Only `Name` is required** (`Title` for the board and timeline). Leave any other cell empty if you don't know it.
3. **Several values in one cell** (nicknames, characters, threads): separate them with **semicolons** — `Mara; the keeper's girl`. For **Tags**, commas also work.
4. **Columns AuthorDesk doesn't recognise are kept.** They become your own custom fields on that entry — for example a `Shoe size` column.
5. **Links are made by name.** In the board, timeline and plot-thread sheets, type a character's or place's **name or nickname** exactly as it appears in your characters/locations, and a chapter's **title** in a `Chapter` column. Anything that doesn't match is listed after the import so you can fix it.
6. Commas, quotes and line breaks inside cells are fine; the spreadsheet program handles the quoting. Semicolon-separated (European Excel) and tab-separated files work too.

---

## 4. `characters.csv`

| Column | What goes in it | Other names accepted |
| --- | --- | --- |
| **Name** *(required)* | Full name | Title |
| Also known as | Nicknames, titles, other spellings (`;`-separated) | AKA, Aliases, Nicknames |
| Role | Protagonist, antagonist, supporting… | |
| Summary | A sentence or two | Short description, Description, One-liner |
| Appearance | | Looks, Physical appearance |
| Personality | | Temperament |
| Goals | | Motivation(s) |
| Fears | | Secrets |
| Strengths | | Skills |
| Flaws | | Weaknesses |
| Backstory | | History, Background |
| Arc | | Character arc |
| Voice | Voice / dialogue notes | Dialogue, Speech |
| First appearance | | |
| Last appearance | Last known appearance | |
| Status | alive, missing… | Current status |
| Tags | (`;` or `,`-separated) | Tag |
| Notes | Anything else | Note |
| Favourite | `yes` to star them | Favorite, Star |
| *anything else* | Kept as a custom field with that column name | |

Example:

```csv
Name,Also known as,Role,Summary,Appearance,Goals,Tags,Notes,Favourite
Mara Quill,Mara; the keeper's girl,Protagonist,"Seventeen, stubborn.",Salt-stiff braid,Find her father,main; family,"Born in winter.",yes
Tobias Wren,Tobias,Supporting,"Kind, until it costs him something.",,,town,,
```

### One file per character instead (`characters/Name.md`)

Good if your character notes are already written as documents:

```markdown
# Elsie Marr                    ← name (or the file name is used)

Also known as: Old Elsie; the net-mender
Role: Minor
Summary: Mends nets on the quay and hears everything.
Appearance: Hands like knotted rope.
Tags: town; witness

She was the last person to see Mara's father before the storm.
Everything after the blank line becomes free-form notes.
```

The `Key: value` lines at the top use the same names as the spreadsheet columns. The first empty line after them ends that block; the rest of the file becomes the character's **Notes**. You can mix both: some characters in `characters.csv` and others as files.

---

## 5. `locations.csv` (or `locations/Name.md`)

| Column | Other names accepted |
| --- | --- |
| **Name** *(required)* | Title |
| Also known as | AKA, Aliases |
| Summary | Short description |
| Region | Parent location |
| Description | |
| Sensory | Sights sounds smells, Senses |
| History | |
| Inhabitants | People |
| Status, Tags, Notes, Favourite | same as characters |

Per-place files in `locations/` work exactly like character files.

---

## 6. `world.csv` — everything else

One sheet for factions, families, species, objects, magic, history, invented words and research. The extra **Type** column says what each row is:

| Type value (any of these) | Becomes |
| --- | --- |
| faction, family, organisation, group | Faction / Family |
| species, culture, race | Species / Culture |
| item, object, artifact, technology, magic | Item / Tech / Magic |
| lore, event, history, legend | Event / Lore |
| glossary, term, word, rule | Glossary / Rule |
| research, source | Research |
| character, person / location, place | Character / Location (if you'd rather keep everyone in one sheet) |

The other columns are the same as above (`Name`, `Also known as`, `Summary`, `Tags`, `Notes`…). Any extra columns become custom fields. An unknown Type is imported as *Event / Lore* and mentioned in the preview.

```csv
Type,Name,Summary,Tags
faction,The Harbour Guild,Owns the boats and most of the town.,power
glossary,Wickie,A lighthouse keeper.,
```

---

## 7. `board.csv` — the story board

One row per card, in the order you want them in each column.

| Column | What goes in it | Other names accepted |
| --- | --- | --- |
| **Title** *(required)* | The card's title | Card, Name, Scene |
| Column | Which board column it goes in, e.g. `Act I`. Missing columns are created. Empty → *Imported cards* | Lane, Act, List, Group |
| Summary | | Description, Synopsis |
| Type | `scene`, `beat`, `idea`, `question`, `research`, `reminder` (default `scene`) | Kind |
| Status | `idea`, `planned`, `drafting`, `written`, `revised`, `final` (also: draft, done, finished…) — default `idea` | |
| Chapter | A chapter **title** to link the card to | |
| POV | Point-of-view character's name | Point of view, Viewpoint |
| Location | A place name | Place, Setting |
| Characters | Other characters in it (`;`-separated) | Cast, People |
| Plot threads | Thread names (`;`-separated). New names create new threads | Threads, Subplots |
| When | Time marker, e.g. `Day 3, dawn` | Time, Date |
| Tags | | |
| Notes | | |

```csv
Column,Title,Summary,Type,Status,Chapter,POV,Location,Plot threads
Act I,Message in the lens,The inciting discovery.,beat,written,The Lamp,Mara Quill,Gull Point Light,Where is Father?
Act II,The tunnel under the rock,Smugglers' passage.,idea,idea,,,,Where is Father?
```

**From Trello, Notion, Plottr, Excel outlines…:** export or copy into a sheet with these column names, then save it as `board.csv`.

---

## 8. `timeline.csv`

| Column | What goes in it | Other names accepted |
| --- | --- | --- |
| **Title** *(required)* | What happens | Event, Name, What |
| When | In-world date or a relative marker: `Spring 1203`, `three days before the siege` | Date, Time |
| Order | A number used to sort events (`-100`, `0`, `10`…). Leave empty if unknown | Sort, Sequence |
| Description | | Summary, Details, Notes |
| Characters | Names (`;`-separated) | Who, People |
| Location | A place name | Where, Place |
| Chapter | A chapter title (links the event to that chapter's first scene) | |
| Plot threads | Thread names (`;`-separated) | Threads |

---

## 9. `plot-threads.csv`

| Column | What goes in it |
| --- | --- |
| **Name** *(required)* | e.g. `Where is Father?` |
| Description | |
| Stakes | |
| Status | `open` (default), `paused`, `resolved` (also: done, closed, on hold) |
| Characters | Key characters (`;`-separated) |
| Resolution | How it ends |

---

## 10. `notes/` — research and notes

One `.md` or `.txt` file per note. `# Title` (or the file name) becomes the title. Optional `Source:` and `Tags:` lines at the top:

```markdown
# How lighthouse lamps worked

Source: https://en.wikipedia.org/wiki/Lighthouse
Tags: research

Fresnel lenses focused a small flame into a beam visible for miles.
```

---

## 11. What happens when you import

1. AuthorDesk reads the files and shows a **preview**: how many chapters, scenes, words, characters, places, cards, events, threads and notes it found, plus anything worth knowing (skipped files, unknown statuses, rows without a name).
2. If you have several books in the project, you choose which one to add to.
3. You choose what happens when a character or place **with the same name already exists**: keep yours (default) or add the imported one too.
4. After importing you get a summary, including any names in the board/timeline that **didn't match** a character, place or chapter, so you can fix them.

Nothing is sent anywhere: the import runs entirely on your computer.

**Moving a whole project between AuthorDesk installs?** Don't use this. Use **Backup & Sync → Save backup** and **Restore a backup**; that keeps everything, including history and links.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| "Nothing in those files matched the import layout" | Check the file and folder names in section 1, and that spreadsheets are saved as `.csv`, not `.xlsx`. |
| Accents or curly quotes look wrong (`Ã©`) | Save the CSV as **UTF-8** (Excel: *CSV UTF-8*). |
| Chapters in the wrong order | Start file names with numbers: `01 -`, `02 -`… |
| Everything ended up in one chapter | Put each chapter in its own file, or start each with `# Title` in `manuscript.md`. |
| A whole sheet landed in one column | Make sure the first row has column names and the file is comma-, semicolon- or tab-separated. |
| Names listed as "didn't match" | Spell them exactly as in your characters/locations (nicknames from *Also known as* work too), then link them in the app. |
