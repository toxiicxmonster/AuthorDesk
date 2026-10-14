/// <reference lib="webworker" />
import { reviewManuscript, type SceneInput } from './metrics';

export interface ReviewRequest {
  id: number;
  scenes: SceneInput[];
  names: string[];
}

self.onmessage = (ev: MessageEvent<ReviewRequest>) => {
  const { id, scenes, names } = ev.data;
  try {
    (self as unknown as Worker).postMessage({ id, report: reviewManuscript(scenes, names) });
  } catch (e) {
    (self as unknown as Worker).postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
};
