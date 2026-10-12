import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { useBooks, useManuscript, useScene, pushRecent, getRecent } from '../data';
import { navigate } from '../router';
import { setUi, useUi } from '../store';
import { Navigator } from '../components/Navigator';
import { RightPanel } from '../components/RightPanel';
import { SceneEditor } from '../../editor/SceneEditor';
import { EditorContext, flushAllEdits } from '../../editor/EditorContext';
import { db } from '../../storage/db';
import { EmptyState, InlineEdit } from '../components/common';
import { Icon } from '../components/Icon';
import { createChapter, updateRecord } from '../../storage/repo';

export function WritePage({ projectId, sceneId, initialFind }: { projectId: string; sceneId: string | null; initialFind?: string | null }) {
  const scene = useScene(sceneId);
  const books = useBooks(projectId);
  const [bookId, setBookId] = useState<string | null>(null);
  const tree = useManuscript(bookId);
  const leftOpen = useUi((s) => s.leftOpen);
  const rightOpen = useUi((s) => s.rightOpen);
  const focusMode = useUi((s) => s.focusMode);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [proofStatus, setProofStatus] = useState('');
  const [proofRequest, setProofRequest] = useState(0);

  // Resolve which book we're in from the scene, or fall back to the first book.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (scene) {
        const ch = await db.chapters.get(scene.chapterId);
        if (!cancelled && ch) setBookId(ch.bookId);
      } else if (books.length && !bookId) {
        setBookId(books[0].id);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scene?.chapterId, books, bookId, scene]);

  // No scene selected (or it vanished): open the most recent or the first scene.
  useEffect(() => {
    if (scene !== null || !tree) return;
    if (sceneId && scene === undefined) return;
    const recent = getRecent(projectId).find((id) => tree.sceneOrder.some((s) => s.id === id));
    const target = recent ?? tree.sceneOrder[0]?.id;
    if (target && target !== sceneId) navigate(projectId, 'write', target);
  }, [scene, sceneId, tree, projectId]);

  useEffect(() => {
    if (scene) pushRecent(projectId, scene.id);
  }, [scene?.id, projectId, scene]);

  const idx = scene && tree ? tree.sceneOrder.findIndex((s) => s.id === scene.id) : -1;
  const prev = idx > 0 ? tree!.sceneOrder[idx - 1] : null;
  const next = idx >= 0 && tree && idx < tree.sceneOrder.length - 1 ? tree.sceneOrder[idx + 1] : null;
  const chapter = tree?.chapters.find((c) => c.id === scene?.chapterId) ?? null;
  const chapterScenes = (chapter && tree?.scenesByChapter.get(chapter.id)) || [];

  // Previous/next chapter (first scene of the adjacent chapter).
  const chIdx = chapter && tree ? tree.chapters.findIndex((c) => c.id === chapter.id) : -1;
  const prevChapterScene = chIdx > 0 ? tree!.scenesByChapter.get(tree!.chapters[chIdx - 1].id)?.[0] : undefined;
  const nextChapterScene = chIdx >= 0 && tree && chIdx < tree.chapters.length - 1 ? tree.scenesByChapter.get(tree.chapters[chIdx + 1].id)?.[0] : undefined;

  const go = useCallback(
    async (id: string | undefined | null) => {
      if (!id) return;
      await flushAllEdits();
      navigate(projectId, 'write', id);
    },
    [projectId],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key === 'PageDown') {
        e.preventDefault();
        void go(e.shiftKey ? next?.id : nextChapterScene?.id);
      } else if (e.altKey && e.key === 'PageUp') {
        e.preventDefault();
        void go(e.shiftKey ? prev?.id : prevChapterScene?.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, next, prev, nextChapterScene, prevChapterScene]);

  const ctx = useMemo(
    () => ({ editor, proofVersion: 0, rerunProofread: () => setProofRequest((n) => n + 1), proofStatus }),
    [editor, proofStatus],
  );

  const otherChapterWords = chapterScenes.filter((s) => s.id !== scene?.id).reduce((n, s) => n + s.wordCount, 0);
  const otherBookWords = (tree?.wordCount ?? 0) - (scene?.wordCount ?? 0);

  const book = books.find((b) => b.id === bookId) ?? null;

  return (
    <EditorContext.Provider value={ctx}>
      <div className={`workspace${focusMode ? ' focus' : ''}${leftOpen ? ' left-open' : ''}${rightOpen ? ' right-open' : ''}`}>
        {leftOpen && !focusMode && tree && (
          <>
            <div className="scrim" onClick={() => setUi({ leftOpen: false })} aria-hidden />
            <Navigator projectId={projectId} books={books} book={book} tree={tree} currentSceneId={scene?.id ?? null} />
          </>
        )}
        <main className="center" id="main">
          {scene && chapter ? (
            <>
              <div className="scene-head">
                <button className="icon-btn" onClick={() => go(prev?.id)} disabled={!prev} aria-label="Previous scene (Alt+Shift+PageUp)" title="Previous scene">
                  <Icon name="left" size={22} />
                </button>
                <div className="scene-head-title">
                  <InlineEdit className="ch" label="Chapter title" value={chapter.title} onSave={(v) => void updateRecord('chapters', chapter.id, { title: v })} />
                  {chapterScenes.length > 1 && (
                    <>
                      <span className="muted" aria-hidden>
                        ›
                      </span>
                      <InlineEdit className="sc" label="Scene title" value={scene.title} onSave={(v) => void updateRecord('scenes', scene.id, { title: v })} />
                    </>
                  )}
                </div>
                <button className="icon-btn" onClick={() => go(next?.id)} disabled={!next} aria-label="Next scene (Alt+Shift+PageDown)" title="Next scene">
                  <Icon name="right" size={22} />
                </button>
              </div>
              <SceneEditor
                key={scene.id}
                scene={scene}
                chapterOtherWords={otherChapterWords}
                bookOtherWords={otherBookWords}
                onEditor={setEditor}
                onProofread={setProofStatus}
                proofRequest={proofRequest}
                initialFind={initialFind ?? null}
              />
              {!next && !focusMode && book && (
                <div className="end-actions">
                  <button
                    onClick={async () => {
                      const ch = await createChapter(projectId, book.id, `Chapter ${(tree?.chapters.length ?? 0) + 1}`);
                      const s = await db.scenes.where('chapterId').equals(ch.id).first();
                      void go(s?.id);
                    }}
                  >
                    + Start next chapter
                  </button>
                </div>
              )}
            </>
          ) : tree && tree.sceneOrder.length === 0 ? (
            <EmptyState title="No chapters yet">
              <button
                className="primary"
                onClick={async () => {
                  if (!book) return;
                  const ch = await createChapter(projectId, book.id, 'Chapter 1');
                  const s = await db.scenes.where('chapterId').equals(ch.id).first();
                  void go(s?.id);
                }}
              >
                Create the first chapter
              </button>
            </EmptyState>
          ) : (
            <p className="muted pad">Loading…</p>
          )}
        </main>
        {rightOpen && !focusMode && scene && chapter && (
          <>
            <div className="scrim right" onClick={() => setUi({ rightOpen: false })} aria-hidden />
            <RightPanel scene={scene} chapter={chapter} nextScene={next} />
          </>
        )}
      </div>
    </EditorContext.Provider>
  );
}
