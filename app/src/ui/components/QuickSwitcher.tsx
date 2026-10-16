import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../storage/db';
import { navigate, type View } from '../router';
import { setUi, toast, useUi } from '../store';
import { flushAllEdits } from '../../editor/EditorContext';
import { REFERENCE_TYPE_ICONS, REFERENCE_TYPE_LABELS } from '../../domain/referenceTemplates';
import { createChapter } from '../../storage/repo';
import { updateSettings, useSettings } from '../../storage/settings';
import { BUILTIN_THEMES } from '../theme';

interface Item {
  id: string;
  icon: string;
  label: string;
  detail?: string;
  group: string;
  keywords?: string;
  run: () => void | Promise<void>;
}

/** Score how well `q` matches `text`: prefix > word start > substring > in-order letters. 0 = no match. */
export function matchScore(text: string, q: string): number {
  // Punctuation is ignored, so "theme sage" finds "Theme: Sage".
  const t = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  const s = q.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return 1;
  // Several words: every word must appear (as a word start scores higher).
  const words = s.split(' ');
  if (words.length > 1 && !t.includes(s)) {
    if (!words.every((w) => t.includes(w))) return looseLetters(t, s);
    const starts = words.filter((w) => new RegExp(`(^| )${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(t)).length;
    return 50 + starts * 5 - t.length / 100;
  }
  if (t.startsWith(s)) return 100 - t.length / 100;
  const i = t.indexOf(s);
  if (i > 0 && /[\s›\-(]/.test(t[i - 1])) return 80 - i / 100;
  if (i >= 0) return 60 - i / 100;
  return looseLetters(t, s);
}

/** Last resort: the typed letters appear in order ("evs" → "Elara Voss"). */
function looseLetters(t: string, s: string): number {
  let pos = 0;
  for (const ch of s) {
    if (ch === ' ') continue;
    pos = t.indexOf(ch, pos);
    if (pos < 0) return 0;
    pos++;
  }
  return 20;
}

const VIEWS: [View, string, string][] = [
  ['home', '⌂', 'Home'],
  ['write', '✎', 'Write'],
  ['board', '▦', 'Story Board'],
  ['refs', '👤', 'Characters & World'],
  ['timeline', '⏱', 'Timeline'],
  ['threads', '🧵', 'Plot Threads'],
  ['notes', '🗒', 'Notes & Research'],
  ['search', '🔍', 'Search all text'],
  ['data', '⇅', 'Backup, export & sync'],
  ['settings', '⚙', 'Settings'],
];

export function QuickSwitcher({ projectId }: { projectId: string | null }) {
  const open = useUi((s) => s.searchOpen);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const settings = useSettings();

  const data = useLiveQuery(async () => {
    if (!open || !projectId) return null;
    const [chapters, scenes, refs, notes, threads, cards, books] = await Promise.all([
      db.chapters.where('projectId').equals(projectId).toArray(),
      db.scenes.where('projectId').equals(projectId).toArray(),
      db.references.where('projectId').equals(projectId).toArray(),
      db.notes.where('projectId').equals(projectId).toArray(),
      db.plotThreads.where('projectId').equals(projectId).toArray(),
      db.boardCards.where('projectId').equals(projectId).toArray(),
      db.books.where('projectId').equals(projectId).toArray(),
    ]);
    return { chapters, scenes, refs, notes, threads, cards, books };
  }, [open, projectId]);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);

  const close = () => setUi({ searchOpen: false });

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const go = (view: View, id?: string | null, params?: Record<string, string>) => async () => {
      await flushAllEdits();
      navigate(projectId, view, id, params);
    };
    if (data && projectId) {
      const liveChapters = data.chapters.filter((c) => !c.archivedAt).sort((a, b) => a.order - b.order);
      const bookName = (id: string) => (data.books.length > 1 ? data.books.find((b) => b.id === id)?.title : undefined);
      for (const c of liveChapters) {
        const scenes = data.scenes.filter((s) => s.chapterId === c.id && !s.archivedAt).sort((a, b) => a.order - b.order);
        if (scenes[0]) out.push({ id: `ch-${c.id}`, icon: '📖', label: c.title, detail: [bookName(c.bookId), `${scenes.reduce((n, s) => n + s.wordCount, 0).toLocaleString()} words`].filter(Boolean).join(' · '), group: 'Chapters', run: go('write', scenes[0].id) });
        if (scenes.length > 1)
          for (const s of scenes) out.push({ id: `sc-${s.id}`, icon: '·', label: `${c.title} › ${s.title}`, group: 'Scenes', run: go('write', s.id) });
      }
      for (const r of data.refs.filter((r) => !r.archivedAt))
        out.push({ id: `r-${r.id}`, icon: REFERENCE_TYPE_ICONS[r.type], label: r.name, detail: REFERENCE_TYPE_LABELS[r.type], keywords: r.aliases.join(' '), group: 'Characters & World', run: go('refs', r.id) });
      for (const t of data.threads.filter((t) => !t.archivedAt)) out.push({ id: `t-${t.id}`, icon: '🧵', label: t.name, group: 'Plot threads', run: go('threads', t.id) });
      for (const n of data.notes.filter((n) => !n.archivedAt)) out.push({ id: `n-${n.id}`, icon: '🗒', label: n.title, group: 'Notes', run: go('notes', n.id) });
      for (const c of data.cards.filter((c) => !c.archivedAt)) out.push({ id: `b-${c.id}`, icon: '▦', label: c.title, detail: 'Board card', group: 'Board', run: go('board', c.id) });
      const firstBook = data.books.filter((b) => !b.archivedAt).sort((a, b) => a.order - b.order)[0];
      out.push(
        {
          id: 'a-new-chapter',
          icon: '+',
          label: 'New chapter',
          group: 'Actions',
          keywords: 'add create',
          run: async () => {
            if (!firstBook) return;
            const n = liveChapters.filter((c) => c.bookId === firstBook.id).length + 1;
            const ch = await createChapter(projectId, firstBook.id, `Chapter ${n}`);
            const s = await db.scenes.where('chapterId').equals(ch.id).first();
            navigate(projectId, 'write', s?.id);
          },
        },
        { id: 'a-new-char', icon: '+', label: 'New character…', group: 'Actions', keywords: 'add create person', run: go('refs', null, { new: 'character' }) },
        { id: 'a-new-place', icon: '+', label: 'New place…', group: 'Actions', keywords: 'add create location', run: go('refs', null, { new: 'location' }) },
        { id: 'a-replace', icon: '⇄', label: 'Find & replace in the book…', group: 'Actions', keywords: 'rename character everywhere change name all chapters', run: async () => setUi({ replaceOpen: { query: '' } }) },
        { id: 'a-backup', icon: '⇩', label: 'Back up now', group: 'Actions', keywords: 'save export archive', run: go('data') },
        { id: 'a-kdp', icon: '📘', label: 'Publish on Amazon KDP…', group: 'Actions', keywords: 'kindle ebook epub paperback print export amazon', run: go('data', null, { kdp: '1' }) },
        { id: 'a-focus', icon: '◎', label: 'Focus mode', group: 'Actions', keywords: 'distraction free zen', run: async () => { await go('write')(); setUi({ focusMode: true }); } },
      );
      for (const [v, icon, label] of VIEWS) out.push({ id: `v-${v}`, icon, label: `Go to ${label}`, group: 'Go to', run: go(v) });
    }
    for (const t of [...BUILTIN_THEMES, ...settings.customThemes])
      out.push({ id: `th-${t.id}`, icon: '◐', label: `Theme: ${t.name}`, group: 'Themes', keywords: 'appearance colour color dark light', run: () => void updateSettings({ theme: t.id }).then(() => toast(`Theme: ${t.name}`)) });
    return out;
  }, [data, projectId, settings.customThemes]);

  const results = useMemo(() => {
    const s = q.trim();
    const scored = items
      .map((it) => ({ it, score: Math.max(matchScore(it.label, s), it.keywords ? matchScore(it.keywords, s) * 0.8 : 0) - (s ? 0 : ['Themes', 'Scenes', 'Board'].includes(it.group) ? 1000 : 0) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    const list = scored.slice(0, 40).map((x) => x.it);
    if (s && projectId) list.push({ id: 'search-all', icon: '🔍', label: `Search all writing for “${s}”`, group: 'Search', run: async () => { await flushAllEdits(); navigate(projectId, 'search', null, { q: s }); } });
    return list;
  }, [items, q, projectId]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;
  const pick = (it: Item | undefined) => {
    if (!it) return;
    close();
    void it.run();
  };
  let lastGroup = '';
  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Jump to">
        <input
          ref={input}
          className="palette-input"
          value={q}
          placeholder={projectId ? 'Jump to a chapter, character, note… or type a command' : 'Type a command'}
          aria-label="Jump to"
          aria-controls="palette-list"
          aria-activedescendant={results[active] ? `pal-${active}` : undefined}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(results.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              pick(results[active]);
            } else if (e.key === 'Escape') {
              close();
            }
          }}
        />
        <ul className="palette-list" id="palette-list" role="listbox" ref={listRef}>
          {results.map((it, i) => {
            const header = it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            return (
              <li key={it.id} role="presentation">
                {header && <div className="palette-group">{header}</div>}
                <button
                  id={`pal-${i}`}
                  data-i={i}
                  role="option"
                  aria-selected={i === active}
                  className={i === active ? 'on' : ''}
                  onMouseMove={() => setActive(i)}
                  onClick={() => pick(it)}
                >
                  <span className="pal-icon" aria-hidden>
                    {it.icon}
                  </span>
                  <span className="grow">{it.label}</span>
                  {it.detail && <span className="muted small">{it.detail}</span>}
                </button>
              </li>
            );
          })}
          {!results.length && <li className="muted pad">Nothing matches. Try fewer letters.</li>}
        </ul>
        <div className="palette-foot muted small">↑↓ to move · Enter to open · Esc to close</div>
      </div>
    </div>
  );
}
