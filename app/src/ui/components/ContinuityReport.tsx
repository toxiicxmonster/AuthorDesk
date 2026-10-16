import { useEffect, useState } from 'react';
import { db } from '../../storage/db';
import { navigate } from '../router';
import { deathWithoutChapter, findContradictions, findDeathIssues, type Contradiction, type DeathIssue } from '../../proofreading/continuity';
import { bookScenes, placeFactsCached, seriesScenes, storyDates } from '../../proofreading/continuityData';
import { findAgeIssues, type AgeIssue } from '../../proofreading/ages';
import type { ReferenceEntry } from '../../domain/schema';
import { reportError, toast } from '../store';
import type { ContinuityScene } from '../../proofreading/continuity';
import { fetchAiStatus } from '../../ai/aiEditor';
import { judgeChange, VERDICT_LABEL, type ChangeView } from '../../ai/continuityJudge';

/** Review → Continuity: the same character described differently across the book, and characters speaking after death. */
export function ContinuityReport({ projectId, bookId, refs, runKey }: { projectId: string; bookId: string; refs: ReferenceEntry[]; runKey: string }) {
  const [found, setFound] = useState<{ contradictions: Contradiction[]; deaths: DeathIssue[]; ages: AgeIssue[]; scenes: ContinuityScene[] } | null>(null);
  const [aiInstalled, setAiInstalled] = useState(false);
  const [views, setViews] = useState<Record<string, ChangeView | 'asking'>>({});

  useEffect(() => {
    void fetchAiStatus().then((s) => setAiInstalled(!!s?.installed));
  }, []);

  const ask = async (c: Contradiction) => {
    if (!found) return;
    setViews((v) => ({ ...v, [c.key]: 'asking' }));
    try {
      const view = await judgeChange(c, found.scenes);
      setViews((v) => ({ ...v, [c.key]: view }));
    } catch (e) {
      setViews((v) => {
        const rest = { ...v };
        delete rest[c.key];
        return rest;
      });
      reportError(e, 'The AI Editor couldn’t look at this');
    }
  };

  const load = async () => {
    const chars = refs.filter((r) => !r.archivedAt && r.type === 'character');
    const names = refs.filter((r) => !r.archivedAt).flatMap((r) => [r.name, ...r.aliases]);
    const [scenes, ignored] = await Promise.all([seriesScenes(projectId).then((s) => s ?? bookScenes(bookId)), db.ignored.where('projectId').equals(projectId).toArray()]);
    const dismissed = new Set(ignored.map((i) => i.key).filter((k) => k.startsWith('continuity|')));
    const info = chars.map((c) => ({ id: c.id, name: c.name, aliases: c.aliases, appearance: c.fields.appearance ?? '' }));
    const facts = placeFactsCached(scenes, info);
    const { dates, births, startAges } = await storyDates(projectId, scenes, chars);
    setFound({
      scenes,
      ages: findAgeIssues(facts, dates, births, dismissed, startAges),
      contradictions: findContradictions(facts, dismissed, new Set(dates.keys())),
      deaths: findDeathIssues(scenes, info.map((c, i) => ({ ...c, status: chars[i].status })), names, dismissed),
    });
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey, refs]);

  const dismiss = async (key: string, label: string) => {
    await db.ignored.put({ id: key, projectId, ruleId: 'continuity', key });
    toast(`Won’t flag ${label} again.`);
    void load();
  };

  if (!found) return null;
  const total = found.contradictions.length + found.deaths.length + found.ages.length;
  const undated = refs.filter((r) => !r.archivedAt && r.type === 'character' && deathWithoutChapter(r.status));
  return (
    <section className="card">
      <h2>
        Continuity <span className="muted small">({total})</span>
      </h2>
      <p className="muted small">
        A character described differently in different places, or speaking after their entry says they died (put the chapter in their Status, e.g. “deceased,
        Ch. 14”), or an age that doesn’t fit the timeline (link timeline events with a date or story day, like “March 2019” or “Day 12”, to scenes or chapters;
        a character’s Age or “Born: 2002” on their entry is checked too). Purple underlines mark these in the editor too.
      </p>
      {!total && <p className="small">Nothing contradicts itself. Nice.</p>}
      {undated.map((r) => (
        <p key={r.id} className="small muted">
          {r.name}’s status says “{r.status.trim()}” but not when, so lines after their death can’t be checked. Add the chapter, like “deceased, Ch. 14”, in{' '}
          <button className="link-btn" onClick={() => navigate(projectId, 'refs', r.id)}>
            {r.name.split(/\s+/)[0]}’s entry
          </button>
          .
        </p>
      ))}
      <ul className="sugg-list">
        {found.contradictions.map((c) => (
          <li key={c.key} className="sugg sev-conflict">
            <div className="sugg-main">
              <strong className="small">
                {c.characterName} · {c.label}
              </strong>
              <span className="block small">
                “{c.first.value}” in{' '}
                <button className="link-btn" onClick={() => navigate(projectId, 'write', c.first.sceneId, { find: c.first.original })}>
                  {c.first.chapterTitle}
                </button>
                , but “{c.other.value}” in{' '}
                <button className="link-btn" onClick={() => navigate(projectId, 'write', c.other.sceneId, { find: c.other.original })}>
                  {c.other.chapterTitle}
                </button>
                .{c.note ? ` ${c.note}` : ''}
              </span>
              {(() => {
                const v = views[c.key];
                if (v === 'asking') return <span className="block small muted">The AI Editor is reading both passages…</span>;
                if (v)
                  return (
                    <span className="block small ai-note">
                      <strong>AI Editor: {VERDICT_LABEL[v.verdict]}.</strong> {v.reason}
                    </span>
                  );
                return aiInstalled ? (
                  <button className="link-btn small" onClick={() => void ask(c)}>
                    Mistake or on purpose? Ask the AI Editor
                  </button>
                ) : null;
              })()}
            </div>
            <button className="small" onClick={() => void dismiss(c.key, `${c.characterName}’s ${c.label.toLowerCase()}`)}>
              Changed on purpose
            </button>
          </li>
        ))}
        {found.ages.map((a) => (
          <li key={a.key} className="sugg sev-conflict">
            <div className="sugg-main">
              <strong className="small">{a.characterName} · age</strong>
              <span className="block small">
                {a.message}{' '}
                <button className="link-btn" onClick={() => navigate(projectId, 'write', a.fact.sceneId, { find: a.fact.original })}>
                  Go to {a.fact.chapterTitle}
                </button>
              </span>
            </div>
            <button className="small" onClick={() => void dismiss(a.key, `${a.characterName}’s age there`)}>
              This is fine
            </button>
          </li>
        ))}
        {found.deaths.map((d) => (
          <li key={d.key} className="sugg sev-conflict">
            <div className="sugg-main">
              <strong className="small">{d.characterName} · speaks after dying</strong>
              <span className="block small">
                Died in chapter {d.diedIn + 1}, but speaks in{' '}
                <button className="link-btn" onClick={() => navigate(projectId, 'write', d.sceneId, { find: d.text })}>
                  {d.chapterTitle}
                </button>
                : {d.text}
              </span>
            </div>
            <button className="small" onClick={() => void dismiss(d.key, 'this line')}>
              This is fine
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
