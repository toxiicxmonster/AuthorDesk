import { reviewManuscript, type ReviewReport, type SceneInput } from './metrics';
import type { ReviewRequest } from './review.worker';

let worker: Worker | null = null;
let seq = 0;

/** Runs the whole-manuscript review off the main thread (falls back to running here where workers aren't available). */
export function runReview(scenes: SceneInput[], names: string[]): Promise<ReviewReport> {
  if (typeof Worker === 'undefined') return Promise.resolve(reviewManuscript(scenes, names));
  worker ??= new Worker(new URL('./review.worker.ts', import.meta.url), { type: 'module' });
  const w = worker;
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const onMessage = (ev: MessageEvent<{ id: number; report?: ReviewReport; error?: string }>) => {
      if (ev.data.id !== id) return;
      w.removeEventListener('message', onMessage);
      if (ev.data.report) resolve(ev.data.report);
      else reject(new Error(ev.data.error ?? 'The review failed.'));
    };
    w.addEventListener('message', onMessage);
    w.postMessage({ id, scenes, names } satisfies ReviewRequest);
  });
}
