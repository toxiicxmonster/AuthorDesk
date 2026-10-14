import { chat, cleanAnswer, splitOptions, type ChatOptions } from './aiEditor';
import { AI_TASKS, buildMessages, pickBest, type AiTask, type AiTaskId } from './prompts';

/** A flagged mark's request for the AI Editor: the passage (usually its sentence), the action and the flagged word. */
export interface MarkRequest {
  id: number;
  text: string;
  context: string;
  task: AiTaskId;
  focus: string | null;
  from: number;
  to: number;
  /** The mark that asked, so its popover can show the answer. */
  markKey: string;
  /** The AI Editor panel runs it (wide screens); otherwise the popover does. */
  panel: boolean;
}

/** The single best version for a mark, shown in its popover. `text` is null when no version was usable. */
export interface MarkBest {
  requestId: number;
  text: string | null;
  done: boolean;
  error: string | null;
}

export const taskById = (id: AiTaskId): AiTask => AI_TASKS.find((t) => t.id === id)!;

/** The best version in a finished answer: the top pick for multi-version actions, the answer itself otherwise. */
export function bestOf(task: AiTask, answer: string, original: string, focus: string | null): string | null {
  const best = task.versions > 1 ? pickBest(task, splitOptions(answer), original, focus)[0] : cleanAnswer(answer);
  return best && best.trim() !== original.trim() ? best : null;
}

/** Runs a mark's request without the panel (small screens): the same prompt, best version only. */
export async function bestForMark(req: MarkRequest, opts: Pick<ChatOptions, 'signal' | 'fetchImpl' | 'temperature'> = {}): Promise<string | null> {
  const task = taskById(req.task);
  const answer = await chat(buildMessages(task, { text: req.text, context: req.context, focus: req.focus }), {
    ...opts,
    temperature: Math.min(opts.temperature ?? 0.25, 0.25),
    maxTokens: Math.min(2400, 200 + Math.ceil(req.text.length / 3) * (task.request ?? task.versions)),
  });
  return bestOf(task, answer, req.text, req.focus);
}
