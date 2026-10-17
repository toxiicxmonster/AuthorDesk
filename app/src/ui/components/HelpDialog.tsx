import { useState } from 'react';
import { Modal } from './common';
import { setUi, useUi } from '../store';

const SHORTCUTS: [string, string][] = [
  ['Ctrl+K', 'Jump to any chapter, character or command'],
  ['Ctrl+Shift+F', 'Search all your writing'],
  ['Ctrl+F', 'Find & replace in this scene'],
  ['Ctrl+Shift+H', 'Find & replace in the whole book'],
  ['Ctrl+S', 'Save now (it also saves automatically)'],
  ['Alt+PageDown / PageUp', 'Next / previous chapter'],
  ['Alt+Shift+PageDown / PageUp', 'Next / previous scene'],
  ['Ctrl+Alt+F', 'Focus mode (Esc to leave)'],
  ['Ctrl+\\', 'Show or hide the chapter list'],
  ['Ctrl+B / I / U', 'Bold / italic / underline'],
  ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
  ['F2', 'Rename the selected chapter in the list'],
  ['F1', 'This help'],
];

const TOPICS: { title: string; body: string[] }[] = [
  {
    title: 'Getting started',
    body: [
      'Click Write to start typing. There is no Save button to remember — every change is saved on this computer within a second.',
      'Chapters are listed on the left. Click one to open it; drag to reorder; use ⋯ for rename, move and more. Double-click a chapter title to rename it.',
      'The panel on the right (◧) shows your characters and places, scene details, writing suggestions and earlier versions of the scene.',
    ],
  },
  {
    title: 'Characters, places and world notes',
    body: [
      'Open World to add people, places, factions, objects and lore. Only fill in what helps — every field is optional.',
      'While writing, select a name and choose “Link” to connect it to its entry. Click linked words later to see the entry without leaving your page.',
    ],
  },
  {
    title: 'Planning',
    body: [
      'The Story Board holds idea cards in columns (for example acts). Turn a card into a scene when you are ready to write it.',
      'Timeline keeps track of when things happen in your world; Plot Threads shows where each subplot appears.',
    ],
  },
  {
    title: 'Writing suggestions',
    body: [
      'Underlines are suggestions, never automatic changes. Click one to see why and choose what to do. Red = probably a mistake, amber = worth a look, blue = optional style idea.',
      'Invented names? Choose “Add to dictionary” once and they won’t be flagged again.',
    ],
  },
  {
    title: 'Bringing in a book you already started',
    body: [
      'Backup → Import your own files. Put your chapters in a folder called “chapters” (one .md or .txt file each, numbered 01, 02…) and your characters, places, story board and timeline in spreadsheets saved as CSV.',
      'Click “How to lay out your files” there for a quick guide, or “Download a starter template” for a filled-in example to copy. The complete guide is IMPORTING.md in the AuthorDesk folder. You see a preview before anything is added.',
    ],
  },
  {
    title: 'Keeping your work safe',
    body: [
      'Your books live in this app on this computer. Make a backup now and then: Backup → Save backup. Keep a copy somewhere else (USB stick or a cloud folder).',
      'Deleted chapters go to Trash at the bottom of the chapter list and can be restored. Every scene also keeps earlier versions under History.',
    ],
  },
];

export function HelpDialog() {
  const open = useUi((s) => s.helpOpen);
  const [tab, setTab] = useState<'guide' | 'keys'>('guide');
  if (!open) return null;
  return (
    <Modal title="Help" onClose={() => setUi({ helpOpen: false })} wide>
      <div className="seg" role="tablist">
        <button role="tab" aria-selected={tab === 'guide'} className={tab === 'guide' ? 'on' : ''} onClick={() => setTab('guide')}>
          How to
        </button>
        <button role="tab" aria-selected={tab === 'keys'} className={tab === 'keys' ? 'on' : ''} onClick={() => setTab('keys')}>
          Keyboard shortcuts
        </button>
      </div>
      {tab === 'guide' ? (
        <div className="help-topics">
          {TOPICS.map((t, i) => (
            <details key={t.title} open={i === 0}>
              <summary>{t.title}</summary>
              {t.body.map((p, j) => (
                <p key={j}>{p}</p>
              ))}
            </details>
          ))}
        </div>
      ) : (
        <dl className="shortcuts">
          {SHORTCUTS.map(([k, d]) => (
            <div key={k}>
              <dt>
                <kbd>{k}</kbd>
              </dt>
              <dd>{d}</dd>
            </div>
          ))}
        </dl>
      )}
    </Modal>
  );
}
