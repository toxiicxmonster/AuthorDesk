import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

export interface MenuItem {
  label: string;
  run: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/** Room kept between a menu and the window's edges. */
const EDGE = 8;

/**
 * Accessible click-to-open menu (no hover dependency, works on touch). The list is drawn at the top level of the page
 * and placed against the window, so a scrolling column or panel can't clip it: it opens below its button, or above when
 * there's more room there, and scrolls inside itself when it's longer than the window allows.
 */
export function Menu({ items, label, children }: { items: (MenuItem | null)[]; label: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<CSSProperties>({});
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - EDGE;
    const above = r.top - EDGE;
    const tall = menuRef.current?.scrollHeight ?? 0;
    const wide = menuRef.current?.offsetWidth ?? 0;
    const up = tall > below && above > below;
    // Lined up with the button's right edge, or its left edge when that would run off the left of the window.
    const side: CSSProperties =
      r.right - wide >= EDGE ? { right: Math.max(EDGE, window.innerWidth - r.right), left: 'auto' } : { left: Math.max(EDGE, Math.min(r.left, window.innerWidth - wide - EDGE)), right: 'auto' };
    setPlace({
      position: 'fixed',
      ...side,
      ...(up ? { top: 'auto', bottom: window.innerHeight - r.top + 2 } : { top: r.bottom + 2, bottom: 'auto' }),
      maxHeight: Math.max(120, up ? above : below),
      overflowY: 'auto',
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) => !!t && (ref.current?.contains(t as Node) || menuRef.current?.contains(t as Node));
    const close = (e: MouseEvent | TouchEvent) => !inside(e.target) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    // Placed against the window: close rather than float in place when the page scrolls or the window resizes.
    const gone = (e: Event) => !inside(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', gone, true);
    window.addEventListener('resize', gone);
    menuRef.current?.querySelector<HTMLButtonElement>('[role=menuitem]:not(:disabled)')?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', gone, true);
      window.removeEventListener('resize', gone);
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
      {open &&
        createPortal(
          <div className="menu" role="menu" aria-label={label} ref={menuRef} style={place}>
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
          </div>,
          document.body,
        )}
    </div>
  );
}
