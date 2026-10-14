import type { AiTaskId } from '../ai/prompts';
import { useSyncExternalStore } from 'react';

export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error';

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'error';
  action?: { label: string; run: () => void };
}

export interface DialogRequest {
  id: number;
  title: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
  /** Extra choices beside confirm/cancel (e.g. "Archive instead"). */
  choices?: { label: string; value: string }[];
  input?: { label: string; initial: string };
  resolve: (v: string | null) => void;
}

interface UiState {
  saveStatus: SaveStatus;
  saveError: string | null;
  focusMode: boolean;
  online: boolean;
  toasts: Toast[];
  dialog: DialogRequest | null;
  leftOpen: boolean;
  rightOpen: boolean;
  rightTab: 'reference' | 'scene' | 'proof' | 'dialogue' | 'ai' | 'history';
  quickRefId: string | null;
  /** Set when a flagged mark asks the AI Editor to work on its sentence; `id` changes for each request. */
  aiRequest: { id: number; text: string; context: string; task: AiTaskId; focus: string | null; from: number; to: number } | null;
  searchOpen: boolean;
  helpOpen: boolean;
}

let state: UiState = {
  saveStatus: 'saved',
  saveError: null,
  focusMode: false,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  toasts: [],
  dialog: null,
  leftOpen: typeof window === 'undefined' ? true : window.innerWidth > 900,
  rightOpen: typeof window === 'undefined' ? true : window.innerWidth > 1200,
  rightTab: 'reference',
  quickRefId: null,
  aiRequest: null,
  searchOpen: false,
  helpOpen: false,
};

const listeners = new Set<() => void>();

export function setUi(patch: Partial<UiState> | ((s: UiState) => Partial<UiState>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  // On small screens the chapter drawer and the side panel are overlays: only one at a time.
  if (typeof window !== 'undefined' && window.innerWidth <= 900) {
    if (p.leftOpen && !state.leftOpen) p.rightOpen = false;
    if (p.rightOpen && !state.rightOpen) p.leftOpen = false;
  }
  state = { ...state, ...p };
  listeners.forEach((l) => l());
}

export function getUi(): UiState {
  return state;
}

export function useUi<T>(select: (s: UiState) => T): T {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => select(state),
    () => select(state),
  );
}

let toastSeq = 0;
export function toast(message: string, opts: { kind?: Toast['kind']; action?: Toast['action']; ms?: number } = {}) {
  const id = ++toastSeq;
  setUi((s) => ({ toasts: [...s.toasts, { id, message, kind: opts.kind ?? 'info', action: opts.action }] }));
  setTimeout(() => dismissToast(id), opts.ms ?? (opts.action ? 8000 : 4000));
}

export function dismissToast(id: number) {
  setUi((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

let dialogSeq = 0;
function ask(opts: Omit<DialogRequest, 'id' | 'resolve'>): Promise<string | null> {
  return new Promise((resolve) => {
    setUi({ dialog: { ...opts, id: ++dialogSeq, resolve } });
  });
}

export async function confirmDialog(
  title: string,
  message: string,
  opts: { confirmLabel?: string; danger?: boolean; choices?: DialogRequest['choices'] } = {},
): Promise<string | null> {
  return ask({ title, message, confirmLabel: opts.confirmLabel ?? 'OK', danger: opts.danger ?? false, choices: opts.choices });
}

export async function promptDialog(title: string, label: string, initial = '', confirmLabel = 'Save'): Promise<string | null> {
  return ask({ title, message: '', confirmLabel, danger: false, input: { label, initial } });
}

export function reportError(e: unknown, context: string) {
  const msg = e instanceof Error ? e.message : String(e);
  toast(`${context}: ${msg}`, { kind: 'error', ms: 8000 });
}


// Crossing into phone size closes overlay panels so the page is visible.
if (typeof window !== 'undefined') {
  let wasSmall = window.innerWidth <= 900;
  window.addEventListener('resize', () => {
    const small = window.innerWidth <= 900;
    if (small && !wasSmall) setUi({ leftOpen: false, rightOpen: false });
    wasSmall = small;
  });
}
