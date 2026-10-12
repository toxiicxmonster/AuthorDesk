import { useEffect, useRef, useState, type ReactNode } from 'react';
import { dismissToast, setUi, useUi } from '../store';
import { WRITING_STATUSES, type WritingStatus } from '../../domain/schema';

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, textarea, select, button:not(.modal-x)');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header>
          <h2>{title}</h2>
          <button className="modal-x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function DialogHost() {
  const d = useUi((s) => s.dialog);
  const [value, setValue] = useState('');
  useEffect(() => setValue(d?.input?.initial ?? ''), [d]);
  if (!d) return null;
  const close = (v: string | null) => {
    setUi({ dialog: null });
    d.resolve(v);
  };
  return (
    <Modal title={d.title} onClose={() => close(null)}>
      {d.message && <p className="dialog-msg">{d.message}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          close(d.input ? value : 'confirm');
        }}
      >
        {d.input && (
          <label className="field">
            <span>{d.input.label}</span>
            <input value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
          </label>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={() => close(null)}>
            Cancel
          </button>
          {d.choices?.map((c) => (
            <button type="button" key={c.value} onClick={() => close(c.value)}>
              {c.label}
            </button>
          ))}
          <button type="submit" className={d.danger ? 'danger' : 'primary'} disabled={!!d.input && !value.trim()}>
            {d.confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ToastHost() {
  const toasts = useUi((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          <span>{t.kind === 'error' ? '⚠ ' : ''}{t.message}</span>
          {t.action && (
            <button
              onClick={() => {
                t.action!.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button onClick={() => dismissToast(t.id)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

export function StatusSelect({ value, onChange, label = 'Status' }: { value: WritingStatus; onChange: (v: WritingStatus) => void; label?: string }) {
  return (
    <label className="field inline">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as WritingStatus)}>
        {WRITING_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s[0].toUpperCase() + s.slice(1)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function StatusDot({ status }: { status: WritingStatus }) {
  return <span className={`status-dot st-${status}`} title={status} aria-label={`Status: ${status}`} />;
}

/** Text input that saves on blur / Enter, so typing doesn't write to the database per keystroke. */
export function CommitInput({
  value,
  onCommit,
  label,
  multiline,
  placeholder,
  rows = 3,
  className,
}: {
  value: string;
  onCommit: (v: string) => void;
  label?: string;
  multiline?: boolean;
  placeholder?: string;
  rows?: number;
  className?: string;
}) {
  const [v, setV] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setV(value);
  }, [value]);
  const commit = (current: string) => {
    focused.current = false;
    if (current !== value) onCommit(current);
  };
  const common = {
    value: v,
    placeholder,
    'aria-label': label ?? placeholder,
    onFocus: () => (focused.current = true),
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => commit(e.currentTarget.value),
  };
  const input = multiline ? (
    <textarea {...common} rows={rows} onChange={(e) => setV(e.target.value)} />
  ) : (
    <input
      {...common}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
  if (!label) return <span className={className}>{input}</span>;
  return (
    <label className={`field ${className ?? ''}`}>
      <span>{label}</span>
      {input}
    </label>
  );
}

export function TagInput({ value, onChange, label = 'Tags' }: { value: string[]; onChange: (v: string[]) => void; label?: string }) {
  return (
    <CommitInput
      label={label}
      value={value.join(', ')}
      placeholder="Separate with commas"
      onCommit={(v) =>
        onChange([
          ...new Set(
            v
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean),
          ),
        ])
      }
    />
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const d = Date.now() - Date.parse(iso);
  if (d < 60_000) return 'just now';
  if (d < 3_600_000) return `${Math.round(d / 60_000)} min ago`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)} h ago`;
  return new Date(iso).toLocaleDateString();
}

/** Text that turns into an input when clicked (or on F2). Enter/blur saves, Esc cancels. */
export function InlineEdit({
  value,
  onSave,
  label,
  className,
  editing: editingProp,
  onEditingChange,
}: {
  value: string;
  onSave: (v: string) => void;
  label: string;
  className?: string;
  editing?: boolean;
  onEditingChange?: (v: boolean) => void;
}) {
  const [editingState, setEditingState] = useState(false);
  const editing = editingProp ?? editingState;
  const setEditing = (v: boolean) => {
    setEditingState(v);
    onEditingChange?.(v);
  };
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) {
      setDraft(value);
      setTimeout(() => ref.current?.select(), 0);
    }
  }, [editing, value]);
  if (!editing) {
    return (
      <button
        type="button"
        className={`inline-edit ${className ?? ''}`}
        title={`${label} — click to rename`}
        aria-label={`${label}: ${value}. Click to rename`}
        onClick={() => setEditing(true)}
      >
        {value || 'Untitled'}
      </button>
    );
  }
  const commit = () => {
    const v = draft.trim();
    setEditing(false);
    if (v && v !== value) onSave(v);
  };
  return (
    <input
      ref={ref}
      className={`inline-edit-input ${className ?? ''}`}
      aria-label={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setEditing(false);
        e.stopPropagation();
      }}
    />
  );
}
