import { useEffect, useMemo, useState } from 'react';
import { TextSelection } from '@tiptap/pm/state';
import { useEditorCtx } from '../../editor/EditorContext';
import { collectTextBlocks } from '../../editor/blocks';
import { analyzeDialogue } from '../../proofreading/dialogue';
import { useReferences } from '../data';

/** Side panel → Dialogue: who speaks, how it's tagged, and what might lose the reader, for the open scene. */
export function DialoguePanel({ projectId }: { projectId: string }) {
  const { editor } = useEditorCtx();
  const refs = useReferences(projectId);
  const [doc, setDoc] = useState(() => editor?.state.doc ?? null);

  useEffect(() => {
    if (!editor) return;
    setDoc(editor.state.doc);
    let timer = 0;
    const onUpdate = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setDoc(editor.state.doc), 400);
    };
    editor.on('update', onUpdate);
    return () => {
      window.clearTimeout(timer);
      editor.off('update', onUpdate);
    };
  }, [editor]);

  const names = useMemo(() => refs.filter((r) => !r.archivedAt).flatMap((r) => [r.name, ...r.aliases]), [refs]);
  const blocks = useMemo(() => (doc ? collectTextBlocks(doc) : []), [doc]);
  const report = useMemo(() => analyzeDialogue(blocks.map((b) => b.text), names), [blocks, names]);

  if (!editor) return <p className="muted">Open a scene to see its dialogue.</p>;
  if (!report.lines.length) return <p className="muted">No dialogue in this scene yet. Quoted speech will show up here as you write it.</p>;

  const jump = (block: number, start: number, end: number) => {
    const b = blocks[block];
    if (!b) return;
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.setSelection(TextSelection.create(tr.doc, b.pos + start, Math.min(b.pos + end, tr.doc.content.size))).scrollIntoView();
        return true;
      })
      .run();
  };
  const most = report.speakers[0]?.[1] ?? 1;

  return (
    <div className="dialogue-panel">
      <p className="small">
        <strong>{report.lines.length}</strong> line{report.lines.length === 1 ? '' : 's'} of dialogue · about <strong>{Math.round(report.share * 100)}%</strong> of this
        scene is spoken.
      </p>

      {report.issues.length > 0 && (
        <section>
          <h3>Worth a look</h3>
          <ul className="sugg-list">
            {report.issues.map((i, k) => (
              <li key={k} className="sugg sev-warning">
                <button className="sugg-main" onClick={() => jump(i.block, i.start, i.end)}>
                  <span className="sev sev-warning">{i.kind === 'unclosed' ? 'Quote' : i.kind === 'two-speakers' ? 'Paragraphs' : 'Who’s talking?'}</span>
                  <span className="block small">{i.message}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3>Who speaks</h3>
        <ul className="dialogue-bars">
          {report.speakers.map(([who, n]) => (
            <li key={who}>
              <span className="who">{who}</span>
              <span className="bar" style={{ width: `${Math.max(6, (n / most) * 100)}%` }} />
              <span className="muted small">{n}</span>
            </li>
          ))}
          {report.lines.some((l) => !l.speaker) && (
            <li className="muted small">{report.lines.filter((l) => !l.speaker).length} line(s) with no speaker named</li>
          )}
        </ul>
      </section>

      {report.tags.length > 0 && (
        <section>
          <h3>Speech tags</h3>
          <p className="small">{report.tags.map(([t, n]) => `${t} ×${n}`).join(' · ')}</p>
          {report.tagNote && <p className="small muted">{report.tagNote}</p>}
        </section>
      )}

      <details>
        <summary className="small">Every line ({report.lines.length})</summary>
        <ul className="sugg-list">
          {report.lines.map((l, k) => (
            <li key={k} className="sugg">
              <button className="sugg-main" onClick={() => jump(l.block, l.start, l.end)}>
                <strong className="small">{l.speaker ?? '?'}</strong>
                {l.tag && <span className="muted small"> · {l.tag}</span>}
                <span className="block small">{l.text.length > 90 ? l.text.slice(0, 88) + '…' : l.text}</span>
              </button>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
