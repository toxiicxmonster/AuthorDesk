import { useEffect, useRef, useState } from 'react';
import { searchProject, type SearchKind, type SearchResult } from '../../storage/search';
import { useBooks } from '../data';
import { navigate } from '../router';
import { WRITING_STATUSES } from '../../domain/schema';

const KINDS: [SearchKind, string][] = [
  ['scene', 'Manuscript'],
  ['chapter', 'Chapters'],
  ['reference', 'References'],
  ['card', 'Board'],
  ['event', 'Timeline'],
  ['thread', 'Plot threads'],
  ['note', 'Notes'],
];

const RECENT_KEY = 'authordesk.recentSearches';

export function SearchPage({ projectId, initialQuery }: { projectId: string; initialQuery: string }) {
  const [q, setQ] = useState(initialQuery);
  const [kinds, setKinds] = useState<SearchKind[]>([]);
  const [bookId, setBookId] = useState('');
  const [status, setStatus] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const books = useBooks(projectId);
  const input = useRef<HTMLInputElement>(null);
  const [recent, setRecent] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    } catch {
      return [];
    }
  });

  useEffect(() => input.current?.focus(), []);

  useEffect(() => {
    if (!q.trim()) {
      setResults(null);
      return;
    }
    let cancelled = false;
    setBusy(true);
    const t = window.setTimeout(async () => {
      const r = await searchProject(projectId, q, { kinds, bookId: bookId || null, status: status || null });
      if (!cancelled) {
        setResults(r);
        setBusy(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [q, kinds, bookId, status, projectId]);

  const open = (r: SearchResult) => {
    const next = [q.trim(), ...recent.filter((x) => x !== q.trim())].slice(0, 8);
    setRecent(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    navigate(projectId, r.target.view, r.target.itemId, r.kind === 'scene' ? { find: q.trim() } : undefined);
  };

  return (
    <div className="page narrow search-page">
      <h1>Search</h1>
      <input
        ref={input}
        className="wide-input"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search manuscript, characters, notes, board… (Ctrl+K)"
        aria-label="Search everything"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && results?.[0]) open(results[0]);
        }}
      />
      <div className="row gap wrap filters">
        {KINDS.map(([k, label]) => (
          <label key={k} className="check chip-check">
            <input type="checkbox" checked={kinds.includes(k)} onChange={(e) => setKinds(e.target.checked ? [...kinds, k] : kinds.filter((x) => x !== k))} /> {label}
          </label>
        ))}
        {books.length > 1 && (
          <select value={bookId} onChange={(e) => setBookId(e.target.value)} aria-label="Book">
            <option value="">All books</option>
            {books.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
        )}
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Any status</option>
          {WRITING_STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      {!q && recent.length > 0 && (
        <div className="recent-searches">
          <span className="muted small">Recent: </span>
          {recent.map((r) => (
            <button key={r} className="link small" onClick={() => setQ(r)}>
              {r}
            </button>
          ))}
        </div>
      )}
      <div aria-live="polite" className="muted small">
        {busy ? 'Searching…' : results ? `${results.length} result${results.length === 1 ? '' : 's'}` : ''}
      </div>
      <ul className="results">
        {results?.map((r) => (
          <li key={r.kind + r.id}>
            <button onClick={() => open(r)}>
              <span className="pill">{KINDS.find((k) => k[0] === r.kind)?.[1]}</span> <strong>{r.title}</strong>
              <span className="muted small"> {r.subtitle}</span>
              {r.snippet && <span className="snippet block"><Highlight text={r.snippet} q={q} /></span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Highlight({ text, q }: { text: string; q: string }) {
  const i = text.toLowerCase().indexOf(q.trim().toLowerCase());
  if (i < 0 || !q.trim()) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.trim().length)}</mark>
      {text.slice(i + q.trim().length)}
    </>
  );
}
