import { useEffect, useRef, useState } from 'react';
import { AiError, chat, fetchAiStatus, type AiStatus } from '../../ai/aiEditor';
import { AI_TASKS, buildMessages } from '../../ai/prompts';
import { toCharacterContext } from '../../ai/characterContext';
import type { DialogueLine } from '../../proofreading/dialogue';
import type { ReferenceEntry } from '../../domain/schema';
import { useSettings } from '../../storage/settings';
import { AiResultCard, type AiResult } from './AiResults';
import type { TextAnchor } from '../../editor/aiApply';
import { useEditorCtx } from '../../editor/EditorContext';

const VOICE = AI_TASKS.find((t) => t.id === 'voice')!;

/**
 * Dialogue tab → "In a character's voice": rewrites the chosen line so it sounds like a character, using their
 * reference notes (personality, voice, backstory…) as background. "Use" puts the chosen version in place of the line.
 */
export function DialogueVoice({ line, paragraph, characters, anchor }: { line: DialogueLine | null; paragraph: string; characters: ReferenceEntry[]; anchor: TextAnchor | null }) {
  const settings = useSettings();
  const { editor } = useEditorCtx();
  const [status, setStatus] = useState<AiStatus | null | undefined>(undefined);
  const [who, setWho] = useState('');
  const [results, setResults] = useState<AiResult[]>([]);
  const abort = useRef<AbortController | null>(null);
  const nextId = useRef(1);

  useEffect(() => {
    let alive = true;
    void fetchAiStatus().then((st) => alive && setStatus(st));
    return () => {
      alive = false;
      abort.current?.abort();
    };
  }, []);

  // Default to whoever speaks the line, when they're a listed character.
  const speaker = line?.speaker ? characters.find((c) => c.name === line.speaker) : undefined;
  useEffect(() => {
    if (speaker) setWho(speaker.id);
  }, [speaker?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!status) return null; // not under the desktop app, or still checking
  if (!status.installed) {
    return <p className="small muted">Install the AI Editor (see its tab) to get suggestions in a character’s voice.</p>;
  }

  const character = characters.find((c) => c.id === who);
  const busy = results.some((r) => !r.done);

  const run = async () => {
    if (!line || !character) return;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    const id = nextId.current++;
    setResults((rs) => [{ id, task: VOICE, extra: character.name, original: line.text, anchor, text: '', done: false, error: null }, ...rs].slice(0, 10));
    const patch = (x: Partial<AiResult>) => setResults((rs) => rs.map((r) => (r.id === id ? { ...r, ...x } : r)));
    try {
      const text = await chat(buildMessages(VOICE, { text: line.text, context: paragraph, characters: [toCharacterContext(character)], character: character.name }), {
        signal: ctrl.signal,
        temperature: settings.aiTemperature,
        maxTokens: 200 + Math.ceil(line.text.length / 3) * VOICE.versions,
        onText: (t) => patch({ text: t }),
      });
      patch({ text, done: true });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') patch({ done: true, error: 'Stopped.' });
      else patch({ done: true, error: e instanceof AiError ? e.message : 'The AI Editor ran into a problem. Try again.' });
    }
  };

  const [latest, ...earlier] = results;

  return (
    <div className="ai-panel">
      <blockquote className="ai-line">{line ? line.text : <span className="muted">Click a line of dialogue in your scene, or in the list below.</span>}</blockquote>
      <div className="ai-pair">
        <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Character">
          <option value="">Whose voice?</option>
          {characters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button className="primary" disabled={!line || !character || busy} onClick={() => void run()}>
          Suggest
        </button>
      </div>
      {character && (
        <p className="small muted">
          Using notes for {character.name}
          {Object.values(character.fields).some((v) => v?.trim()) ? '' : ' (none yet; add personality and voice notes to their entry for better results)'}
        </p>
      )}
      {latest && <AiResultCard key={latest.id} editor={editor} r={latest} busy={busy} onStop={() => abort.current?.abort()} onAgain={() => void run()} />}
      {earlier.length > 0 && (
        <details className="ai-earlier">
          <summary className="small">Earlier suggestions ({earlier.length})</summary>
          {earlier.map((r) => (
            <AiResultCard key={r.id} editor={editor} r={r} busy={false} onStop={() => undefined} onAgain={() => void run()} />
          ))}
        </details>
      )}
    </div>
  );
}
