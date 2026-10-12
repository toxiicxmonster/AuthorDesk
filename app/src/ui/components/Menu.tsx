import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

export interface MenuItem {
  label: string;
  run: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/** Accessible click-to-open menu (no hover dependency, works on touch). */
export function Menu({ items, label, children }: { items: (MenuItem | null)[]; label: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | TouchEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    document.addEventListener('keydown', key);
    ref.current?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus();
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      <button
        className="icon-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {children ?? <Icon name="more" />}
      </button>
      {open && (
        <div className="menu" role="menu">
          {items.filter(Boolean).map((it) => (
            <button
              key={it!.label}
              role="menuitem"
              className={it!.danger ? 'danger-text' : ''}
              disabled={it!.disabled}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                it!.run();
              }}
            >
              {it!.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
