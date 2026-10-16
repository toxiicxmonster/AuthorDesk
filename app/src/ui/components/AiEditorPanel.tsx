import { useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { useEditorCtx } from '../../editor/EditorContext';
import { collectTextBlocks } from '../../editor/blocks';
import { AiError, chat, fetchAiStatus, warmUpAi, type AiStatus } from '../../ai/aiEditor';
import { TONES, buildMessages, type AiTask, type AiTaskId } from '../../ai/prompts';
import { SCAN_FIELDS, findDetailsWithAi, type FoundDetail } from '../../ai/characterDetails';
import { CHARACTER_FIELD_LABELS, charactersIn } from '../../ai/characterContext';
import { useSettings } from '../../storage/settings';
import { db } from '../../storage/db';
import { updateRecord } from '../../storage/repo';
import { useReferences } from '../data';
import { reportError, setUi, toast, useUi } from '../store';
import { useRoute } from '../router';
import { AiResultCard, type AiResult } from './AiResults';
import { bestOf, taskById } from '../../ai/markRewrite';
import { textAt, type TextAnchor } from '../../editor/aiApply';

/**
 * Side panel → AI Editor. Each version has a "Use" button that puts it in place of the passage it was written for
 * (one undoable step, only if that passage is unchanged); nothing reaches the book without that click.
 * Character notes aren't used here: writing in a character's voice lives in the Dialogue tab.
 * Replacements go through editor/aiApply.ts; this file may not call the editor's commands itself (ESLint enforces it).
 */

interface Passage {
  text: string;
  context: string;
  /** The flagged words this passage was opened for, if it came from clicking a mark. */
  focus: string | null;
  /** For a tense slip: the tense to put the passage in. */
  toTense?: 'past' | 'present';
  /** Where the passage is in the scene (for "Use"). */
  anchor: TextAnchor | null;
}

interface Result extends AiResult {
  passage: Passage;
}

const PRIMARY: AiTaskId[] = ['rewrite', 'smoother', 'tighter', 'no-adverb'];
const MORE: AiTaskId[] = ['clearer', 'grammar', 'show', 'tone-read'];

/** The selection, or the paragraph at the cursor, plus the paragraphs either side as read-only context. */
function passageFrom(editor: Editor): Passage {
  const { state } = editor;
  const { from, to, empty, $from } = state.selection;
  // The selection, or the whole paragraph at the cursor, without surrounding spaces.
  let a = empty ? $from.start() : from;
  let b = empty ? $from.end() : to;
  const raw = textAt(editor, a, b);
  a += raw.length - raw.trimStart().length;
  b -= raw.length - raw.trimEnd().length;
  const text = b > a ? textAt(editor, a, b) : '';
  const blocks = collectTextBlocks(state.doc);
  let at = blocks.findIndex((bl) => bl.pos <= from && from <= bl.pos + bl.text.length);
  if (at < 0) at = 0;
  const context = [blocks[at - 1]?.text, blocks[at + 1]?.text].filter(Boolean).join('\n\n');
  const fits = text.length > 0 && text.length <= 4000;
  return { text: text.slice(0, 4000), context: context.slice(0, 3000), focus: null, anchor: fits ? { from: a, to: b, text } : null };
}

/** The tone the author wants for a scene, from a "Tone: …" (or "Mood: …") line in its scene notes. */
export async function intendedToneOf(sceneId: string | null): Promise<string | undefined> {
  if (!sceneId) return undefined;
  const scene = await db.scenes.get(sceneId);
  return /^\s*(?:intended\s+)?(?:tone|mood)\s*[:\-–]\s*(.+)$/im.exec(scene?.notes ?? '')?.[1]?.trim() || undefined;
}

export function AiEditorPanel({ projectId }: { projectId: string }) {
  const { editor } = useEditorCtx();
  const settings = useSettings();
  const refs = useReferences(projectId);
  const request = useUi((s) => s.aiRequest);
  const route = useRoute();
  const characters = useMemo(() => refs.filter((r) => !r.archivedAt && r.type === 'character'), [refs]);
  const [status, setStatus] = useState<AiStatus | null | undefined>(undefined);
  const [passage, setPassage] = useState<Passage>({ text: '', context: '', focus: null, anchor: null });
  const [pinned, setPinned] = useState(false);
  const [tone, setTone] = useState<string>(TONES[2]);
  const [question, setQuestion] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [scan, setScan] = useState<{ busy: boolean; found: FoundDetail[] | null }>({ busy: false, found: null });
  const abort = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const handled = useRef<number | null>(null);

  // Status: warm the model up when the panel opens, and keep the status current while it loads.
  useEffect(() => {
    let alive = true;
    let timer = 0;
    const poll = async (first: boolean) => {
      const st = await fetchAiStatus();
      if (!alive) return;
      setStatus(st);
      if (first && st?.installed && !st.ready) void warmUpAi();
      if (st?.installed && !st.ready) timer = window.setTimeout(() => void poll(false), 2000);
    };
    void poll(true);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, []);

  // Follow the selection, unless a passage is pinned (by the author, or by clicking a mark).
  useEffect(() => {
    if (!editor || pinned) return;
    const update = () => setPassage(passageFrom(editor));
    update();
    editor.on('selectionUpdate', update);
    editor.on('update', update);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('update', update);
    };
  }, [editor, pinned]);

  useEffect(() => () => abort.current?.abort(), []);

  /** `requestId`: run for a clicked mark, whose popover shows the best version. */
  const run = async (task: AiTask, p: Passage = passage, requestId?: number) => {
    if (!p.text) return toast('Select some text, or put the cursor in a paragraph, first.');
    if (task.id === 'ask' && !question.trim()) return toast('Type a question first.');
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    const id = nextId.current++;
    const extra = task.id === 'tone' ? tone : task.id === 'ask' ? question.trim() : p.focus ? `“${p.focus}”` : '';
    setResults((rs) => [{ id, task, extra, passage: p, original: p.text, anchor: p.anchor, focus: p.focus, text: '', done: false, error: null }, ...rs].slice(0, 20));
    const patch = (x: Partial<Result>) => setResults((rs) => rs.map((r) => (r.id === id ? { ...r, ...x } : r)));
    try {
      const intendedTone = task.id === 'tone-read' ? await intendedToneOf(route.view === 'write' ? route.itemId : null) : undefined;
      const text = await chat(buildMessages(task, { text: p.text, context: p.context, tone, question, focus: p.focus, toTense: p.toTense, intendedTone }), {
        signal: ctrl.signal,
        // A fix for one flagged word should change as little as possible.
        temperature: p.focus ? Math.min(settings.aiTemperature, 0.25) : settings.aiTemperature,
        maxTokens: Math.min(2400, 200 + Math.ceil(p.text.length / 3) * (task.request ?? task.versions)),
        onText: (t) => patch({ text: t }),
      });
      patch({ text, done: true });
      if (requestId) setUi({ aiBest: { requestId, text: bestOf(task, text, p.text, p.focus), done: true, error: null } });
    } catch (e) {
      const error = e instanceof DOMException && e.name === 'AbortError' ? 'Stopped.' : e instanceof AiError ? e.message : 'The AI Editor ran into a problem. Try again.';
      patch({ done: true, error });
      if (requestId) setUi({ aiBest: { requestId, text: null, done: true, error } });
    }
  };

  // A clicked mark asked for help: work on its sentence straight away.
  useEffect(() => {
    if (!request?.panel || handled.current === request.id || !status?.installed) return;
    handled.current = request.id;
    const p: Passage = { text: request.text, context: request.context, focus: request.focus, toTense: request.toTense, anchor: { from: request.from, to: request.to, text: request.text } };
    setPinned(true);
    setPassage(p);
    void run(taskById(request.task), p, request.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, status?.installed]);

  if (status === undefined) return <p className="muted">Checking the AI Editor…</p>;
  if (status === null) return <p className="muted">The AI Editor runs in the AuthorDesk desktop app, not in a web browser. Open AuthorDesk to use it.</p>;
  if (!status.installed) return <AiNotInstalled />;
  if (!editor) return <p className="muted">Open a scene to use the AI Editor.</p>;

  const busy = results.some((r) => !r.done);
  const release = () => {
    setPinned(false);
    setUi({ aiRequest: null });
  };

  const findDetails = async () => {
    setScan({ busy: true, found: null });
    try {
      const scene = collectTextBlocks(editor.state.doc)
        .map((b) => b.text)
        .join('\n\n');
      const named = charactersIn(scene, characters).map((c) => ({ id: c.id, name: c.name, aliases: c.aliases, fields: c.fields }));
      setScan({ busy: false, found: await findDetailsWithAi(scene, named) });
    } catch (e) {
      setScan({ busy: false, found: [] });
      reportError(e, 'The AI Editor couldn’t scan this scene');
    }
  };

  // Adds a found detail to the character's entry (never to the manuscript), with Undo.
  const addDetail = async (d: FoundDetail) => {
    const ref = await db.references.get(d.characterId);
    if (!ref) return;
    const before = ref.fields[d.field] ?? '';
    const after = before.trim() ? `${before.replace(/\s+$/, '')}\n${d.fact}` : d.fact;
    await updateRecord('references', ref.id, { fields: { ...ref.fields, [d.field]: after } });
    setScan((s) => ({ ...s, found: s.found?.filter((x) => x !== d) ?? null }));
    toast(`Added to ${d.characterName}’s ${CHARACTER_FIELD_LABELS[d.field] ?? d.field}`, {
      action: {
        label: 'Undo',
        run: async () => {
          const cur = await db.references.get(ref.id);
          if (cur) await updateRecord('references', cur.id, { fields: { ...cur.fields, [d.field]: before } });
        },
      },
    });
  };

  const [latest, ...earlier] = results;

  return (
    <div className="ai-panel">
      <AiStatusLine status={status} />

      <section className="ai-passage">
        <div className="ai-passage-head small">
          <strong>{pinned ? 'Working on' : 'Passage'}</strong>
          {passage.focus && <span className="chip">“{passage.focus}”</span>}
          {pinned ? (
            <button className="link-btn" onClick={release} title="Follow the cursor again">
              Use my selection
            </button>
          ) : (
            <button className="link-btn" onClick={() => setPinned(true)} disabled={!passage.text} title="Keep this passage while you click elsewhere">
              Keep
            </button>
          )}
        </div>
        <blockquote>{passage.text || <span className="muted">Select text, or click in a paragraph.</span>}</blockquote>
      </section>

      <section className="ai-actions">
        <div className="ai-primary">
          {PRIMARY.map((id) => {
            const t = taskById(id);
            return (
              <button key={id} title={t.hint} disabled={!passage.text} onClick={() => void run(t)}>
                {t.label}
              </button>
            );
          })}
        </div>
        <form
          className="ai-ask"
          onSubmit={(e) => {
            e.preventDefault();
            void run(taskById('ask'));
          }}
        >
          <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about this passage…" aria-label="Ask about this passage" />
          <button type="submit" disabled={!passage.text || !question.trim()}>
            Ask
          </button>
        </form>
        <details className="ai-more">
          <summary className="small">More</summary>
          <div className="ai-primary">
            {MORE.map((id) => {
              const t = taskById(id);
              return (
                <button key={id} title={t.hint} disabled={!passage.text} onClick={() => void run(t)}>
                  {t.label}
                </button>
              );
            })}
          </div>
          <div className="ai-pair">
            <select value={tone} onChange={(e) => setTone(e.target.value)} aria-label="Tone">
              {TONES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <button disabled={!passage.text} onClick={() => void run(taskById('tone'))}>
              Change tone
            </button>
          </div>
          <p className="small muted">To make a line sound like a particular character, use the Dialogue tab.</p>
        </details>
      </section>

      {latest && <AiResultCard key={latest.id} editor={editor} r={latest} busy={busy} onStop={() => abort.current?.abort()} onAgain={() => void run(latest.task, latest.passage)} />}
      {earlier.length > 0 && (
        <details className="ai-earlier">
          <summary className="small">Earlier suggestions ({earlier.length})</summary>
          {earlier.map((r) => (
            <AiResultCard key={r.id} editor={editor} r={r} busy={false} onStop={() => undefined} onAgain={() => void run(r.task, r.passage)} />
          ))}
        </details>
      )}

      <details className="ai-characters">
        <summary className="small">Character details in this scene</summary>
        <p className="small muted">Facts about your characters that this scene states but their entries don’t have yet.</p>
        <button disabled={scan.busy || !characters.length} onClick={() => void findDetails()}>
          {scan.busy ? 'Reading the scene…' : 'Find them'}
        </button>
        {scan.found && !scan.found.length && <p className="small muted">Nothing new about your characters in this scene.</p>}
        {scan.found && scan.found.length > 0 && (
          <ul className="sugg-list">
            {scan.found.map((d, k) => (
              <li key={k} className="sugg sev-note">
                <div className="sugg-main">
                  <strong className="small">{d.characterName}</strong>{' '}
                  <span className="muted small">· {CHARACTER_FIELD_LABELS[d.field] ?? SCAN_FIELDS[d.field]}</span>
                  <span className="block small">{d.fact}</span>
                  <span className="block small muted">“{d.quote}”</span>
                </div>
                <button className="small" onClick={() => void addDetail(d)}>
                  Add to entry
                </button>
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}

export function AiStatusLine({ status }: { status: AiStatus }) {
  return (
    <p className="ai-status small muted">
      <span className={`ai-dot${status.ready ? ' on' : ''}`} aria-hidden /> {status.ready ? status.model : `Loading ${status.model || 'the model'}…`} · on this computer ·
      suggestions only
    </p>
  );
}

export function AiNotInstalled() {
  return (
    <div className="ai-panel">
      <p>
        <strong>The AI Editor isn’t installed yet.</strong> It suggests rewrites, smoother and tighter wording, stronger verbs and lines in a character’s voice, and
        reads flagged adverbs in context, all on this computer with open-source software. No account, no subscription, nothing sent anywhere.
      </p>
      <p className="small">
        To install it (about 8 GB), open <a href="#/settings">Settings → Add-ons</a> and choose Install. It downloads in the background while you write.
      </p>
    </div>
  );
}
