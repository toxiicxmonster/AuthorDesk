import { useLayoutEffect, useRef, useState } from 'react';

/**
 * How tightly a row of labelled links must be drawn to fit: 0 = as designed, 1 = tighter spacing, 2 = icons only.
 * It steps down only when the row overflows and back up once there's room for the previous step again (the width
 * each step needed is remembered, so it doesn't flicker at the edge).
 */
export function useFitNav<T extends HTMLElement>(deps: readonly unknown[]): { ref: React.RefObject<T | null>; level: 0 | 1 | 2 } {
  const ref = useRef<T | null>(null);
  const [level, setLevel] = useState<0 | 1 | 2>(0);
  const needed = useRef<number[]>([]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const check = () => {
      if (level < 2 && el.scrollWidth > el.clientWidth + 1) {
        needed.current[level] = el.scrollWidth;
        setLevel((level + 1) as 1 | 2);
      } else if (level > 0 && el.clientWidth >= (needed.current[level - 1] ?? Infinity)) setLevel((level - 1) as 0 | 1);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, ...deps]);

  // A different set of links (a series adds one) needs measuring again.
  useLayoutEffect(() => {
    needed.current = [];
    setLevel(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ref, level };
}
