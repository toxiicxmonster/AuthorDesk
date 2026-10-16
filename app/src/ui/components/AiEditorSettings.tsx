import { useEffect, useState } from 'react';
import { fetchAiStatus, type AiStatus } from '../../ai/aiEditor';
import { updateSettings, useSettings } from '../../storage/settings';

/** Settings → Proofreading → AI Editor: status, adverb judging, and how freely it rewrites. */
export function AiEditorSettings() {
  const s = useSettings();
  const [status, setStatus] = useState<AiStatus | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void fetchAiStatus().then((st) => alive && setStatus(st));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <fieldset className="field">
      <legend>AI Editor</legend>
      <p className="small">
        An open-source model running on this PC: rewrites, smooths and tightens passages in the side panel (suggestions you copy; it never writes into your book),
        and can read each flagged adverb in context. No account, subscription or internet needed.
      </p>
      <p className="small">
        Status:{' '}
        <strong>
          {status === undefined
            ? 'checking…'
            : status === null
              ? 'available in the AuthorDesk app'
              : !status.installed
                ? 'not installed (install it under Add-ons, about 8 GB)'
                : `${status.ready ? 'loaded' : 'installed; loads when first used'} · ${status.model}`}
        </strong>
      </p>
      <label className="check">
        <input type="checkbox" checked={s.aiJudgeAdverbs} onChange={(e) => void updateSettings({ aiJudgeAdverbs: e.target.checked })} /> Let the AI Editor read each
        flagged adverb’s sentence, and only underline the weak ones
      </label>
      <label className="field">
        <span>
          Rewrites: {s.aiTemperature <= 0.3 ? 'faithful' : s.aiTemperature >= 0.7 ? 'adventurous' : 'balanced'} ({s.aiTemperature.toFixed(1)})
        </span>
        <input type="range" min={0} max={1} step={0.1} value={s.aiTemperature} onChange={(e) => void updateSettings({ aiTemperature: Number(e.target.value) })} />
      </label>
    </fieldset>
  );
}
