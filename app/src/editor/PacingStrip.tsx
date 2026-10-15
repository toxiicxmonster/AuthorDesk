import { useEffect, useMemo, useState, type RefObject } from 'react';
import type { Editor } from '@tiptap/react';
import { pacingSummary, pacingTicks, tickAt, type PacingBlock, type PacingTick } from '../review/pacing';

/** Height (in characters) of the gap drawn between paragraphs. */
const GAP = 24;
const WIDTH = 20;

function blocksOf(editor: Editor): PacingBlock[] {
  const out: PacingBlock[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'paragraph' || node.type.name === 'heading') {
      // Each inline leaf (a line break) counts as one character, so text offsets line up with document positions.
      out.push({ text: node.textBetween(0, node.content.size, undefined, '​'), pos: pos + 1 });
      return false;
    }
    return true;
  });
  return out;
}

/**
 * A thin strip beside the page: one tick per sentence, top to bottom, its width the sentence's length; dialogue
 * and narration in different colours, long sentences and paragraphs picked out, and the part on screen outlined.
 * Click to jump there.
 */
export function PacingStrip({ editor, pageRef }: { editor: Editor; pageRef: RefObject<HTMLDivElement | null> }) {
  const [ticks, setTicks] = useState<PacingTick[]>(() => pacingTicks(blocksOf(editor)));
  const [view, setView] = useState<{ from: number; to: number } | null>(null);

  useEffect(() => {
    let timer: number | undefined;
    const update = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setTicks(pacingTicks(blocksOf(editor))), 400);
    };
    editor.on('update', update);
    return () => {
      window.clearTimeout(timer);
      editor.off('update', update);
    };
  }, [editor]);

  const layout = useMemo(() => {
    let y = 0;
    const rows = ticks.map((t) => {
      y += t.paragraphStart ? GAP : 0;
      const row = { t, y, h: t.chars };
      y += t.chars;
      return row;
    });
    return { rows, total: Math.max(1, y) };
  }, [ticks]);

  // The part of the scene on screen, as a band on the strip.
  useEffect(() => {
    const page = pageRef.current;
    if (!page || !ticks.length) return;
    const measure = () => {
      const box = page.getBoundingClientRect();
      // Look inside the text itself: the page's padding around it has no document position.
      const text = editor.view.dom.getBoundingClientRect();
      const left = text.left + text.width / 2;
      const top = editor.view.posAtCoords({ left, top: Math.max(box.top, text.top) + 4 })?.pos;
      const bottom = editor.view.posAtCoords({ left, top: Math.min(box.bottom, text.bottom) - 4 })?.pos;
      if (top === undefined || bottom === undefined) return setView(null);
      const yOf = (pos: number) => {
        let i = layout.rows.findIndex((r) => r.t.pos > pos);
        if (i < 0) i = layout.rows.length;
        const r = layout.rows[Math.max(0, i - 1)];
        return r ? r.y + Math.min(r.h, Math.max(0, pos - r.t.pos)) : 0;
      };
      setView({ from: yOf(top), to: Math.max(yOf(bottom), yOf(top) + 1) });
    };
    measure();
    page.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      page.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [editor, pageRef, layout, ticks.length]);

  if (!ticks.length) return null;
  const sum = pacingSummary(ticks);
  const label = `Pacing: ${sum.sentences} sentences, ${Math.round(sum.dialogue * 100)}% with dialogue, ${sum.averageWords} words on average, ${sum.long} long. Click to jump.`;

  const jump = (e: React.MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const i = tickAt(ticks, (e.clientY - box.top) / box.height, GAP);
    const t = ticks[i];
    if (t) editor.chain().focus().setTextSelection(t.pos).scrollIntoView().run();
  };

  return (
    <div className="pacing-strip" title={label} onClick={jump} role="presentation">
      <svg viewBox={`0 0 ${WIDTH} ${layout.total}`} preserveAspectRatio="none" aria-hidden>
        {view && <rect className="pt-view" x={0} y={view.from} width={WIDTH} height={view.to - view.from} />}
        {layout.rows.map(({ t, y, h }, i) => (
          <g key={i}>
            {t.longParagraph && <rect className="pt-longpara" x={0} y={y} width={2} height={h} />}
            <rect className={t.long ? 'pt-long' : t.dialogue ? 'pt-dialogue' : 'pt-narration'} x={3} y={y + h * 0.1} width={Math.min(WIDTH - 3, 2 + t.words * 0.45)} height={Math.max(h * 0.8, 1)} />
          </g>
        ))}
      </svg>
      <span className="visually-hidden">{label}</span>
    </div>
  );
}
