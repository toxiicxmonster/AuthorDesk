/**
 * Client for the private AI Editor: llama.cpp running an open-weight model on this PC, started by the AuthorDesk
 * launcher on first use and reached through it at /ai/* (same origin, loopback only). Nothing leaves the machine.
 * Installed with scripts\install-ai-editor.ps1.
 *
 * This module only produces text. It never touches the manuscript: results are shown in the AI Editor panel,
 * where the author can copy them.
 */

export interface AiStatus {
  installed: boolean;
  ready: boolean;
  starting: boolean;
  model: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Called with the text so far, as it streams in. */
  onText?: (soFar: string) => void;
  /** JSON schema the answer must follow (llama.cpp grammar-constrained output). */
  schema?: object;
  fetchImpl?: typeof fetch;
}

export class AiError extends Error {}

/** Asks the launcher about the AI Editor. Null when not running under the launcher (e.g. the dev server). */
export async function fetchAiStatus(fetchImpl: typeof fetch = globalThis.fetch?.bind(globalThis)): Promise<AiStatus | null> {
  try {
    const res = await fetchImpl('/ai/status', { cache: 'no-store' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
    const j = (await res.json()) as Partial<AiStatus>;
    return { installed: !!j.installed, ready: !!j.ready, starting: !!j.starting, model: j.model ?? '' };
  } catch {
    return null;
  }
}

/** Starts loading the model in the background (so it's warm by the time the author asks). */
export async function warmUpAi(fetchImpl: typeof fetch = globalThis.fetch?.bind(globalThis)): Promise<void> {
  try {
    await fetchImpl('/ai/start', { method: 'POST' });
  } catch {
    /* not under the launcher */
  }
}

/** Reads an OpenAI-style server-sent-event stream, returning the full text. */
export async function readStream(body: ReadableStream<Uint8Array>, onText?: (soFar: string) => void): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return text;
      try {
        const delta = (JSON.parse(data) as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta?.content;
        if (delta) {
          text += delta;
          onText?.(text);
        }
      } catch {
        /* keep-alive or partial line */
      }
    }
  }
  return text;
}

/** One chat completion from the local model. Streams when `onText` is given. */
export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  const doFetch = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const stream = !!opts.onText;
  const body: Record<string, unknown> = {
    messages,
    temperature: opts.temperature ?? 0.4,
    max_tokens: opts.maxTokens ?? 600,
    stream,
  };
  if (opts.schema) body.response_format = { type: 'json_schema', json_schema: { name: 'answer', schema: opts.schema } };
  let res: Response;
  try {
    res = await doFetch('/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: opts.signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new AiError('Couldn’t reach the AI Editor. Restart AuthorDesk and try again.');
  }
  if (!res.ok) {
    let msg = `The AI Editor returned an error (HTTP ${res.status}).`;
    try {
      const j = (await res.json()) as { error?: string | { message?: string } };
      msg = typeof j.error === 'string' ? j.error : (j.error?.message ?? msg);
    } catch {
      /* not JSON */
    }
    throw new AiError(msg);
  }
  if (stream && res.body) return readStream(res.body, opts.onText);
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return j.choices?.[0]?.message?.content ?? '';
}

/** Strips the chatter models add around an answer ("Here's a rewrite:", surrounding quotes). */
export function cleanAnswer(text: string): string {
  let t = text.trim();
  t = t.replace(/^(?:sure[,!.]?\s*)?(?:here(?:['’]s| is| are)[^:\n]*:\s*)/i, '');
  if (/^["“].*["”]$/s.test(t) && !/["“”]/.test(t.slice(1, -1))) t = t.slice(1, -1);
  return t.trim();
}

/** Splits a numbered list ("1. … 2. …") into its items; a single answer comes back as one item. */
export function splitOptions(text: string): string[] {
  const parts = text
    .split(/\n?\s*(?:^|\n)\s*(?:\d+[.)]|[-*•])\s+/m)
    .map((p) => cleanAnswer(p))
    .filter(Boolean);
  return parts.length ? parts : [cleanAnswer(text)].filter(Boolean);
}
