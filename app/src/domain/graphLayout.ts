/**
 * A small force-directed layout (Fruchterman–Reingold) for the relationship map: connected entries pull together,
 * everyone pushes apart, within a fixed box. Deterministic (starts from a circle), so the map looks the same each
 * time until the author drags something. Pure.
 */

export interface Point {
  x: number;
  y: number;
}

export function forceLayout(ids: readonly string[], edges: readonly [string, string][], opts: { width?: number; height?: number; iterations?: number; fixed?: ReadonlyMap<string, Point> } = {}): Map<string, Point> {
  const width = opts.width ?? 800;
  const height = opts.height ?? 560;
  const n = ids.length;
  const pos = new Map<string, Point>();
  ids.forEach((id, i) => {
    const fixed = opts.fixed?.get(id);
    const a = (2 * Math.PI * i) / Math.max(1, n);
    pos.set(id, fixed ? { ...fixed } : { x: width / 2 + (width / 3) * Math.cos(a), y: height / 2 + (height / 3) * Math.sin(a) });
  });
  if (n < 2) return pos;
  const k = Math.sqrt((width * height) / n) * 0.75;
  let temp = width / 8;
  const iterations = opts.iterations ?? 250;
  for (let it = 0; it < iterations; it++) {
    const disp = new Map(ids.map((id) => [id, { x: 0, y: 0 }]));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = pos.get(ids[i])!;
        const b = pos.get(ids[j])!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d = Math.hypot(dx, dy);
        if (d < 0.01) {
          dx = 0.01 * (i - j);
          dy = 0.01;
          d = Math.hypot(dx, dy);
        }
        const f = (k * k) / d;
        disp.get(ids[i])!.x += (dx / d) * f;
        disp.get(ids[i])!.y += (dy / d) * f;
        disp.get(ids[j])!.x -= (dx / d) * f;
        disp.get(ids[j])!.y -= (dy / d) * f;
      }
    }
    for (const [s, t] of edges) {
      const a = pos.get(s);
      const b = pos.get(t);
      if (!a || !b) continue;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d = Math.max(0.01, Math.hypot(dx, dy));
      const f = (d * d) / k;
      disp.get(s)!.x -= (dx / d) * f;
      disp.get(s)!.y -= (dy / d) * f;
      disp.get(t)!.x += (dx / d) * f;
      disp.get(t)!.y += (dy / d) * f;
    }
    for (const id of ids) {
      if (opts.fixed?.has(id)) continue;
      const p = pos.get(id)!;
      const d = disp.get(id)!;
      const len = Math.max(0.01, Math.hypot(d.x, d.y));
      p.x = Math.min(width - 40, Math.max(40, p.x + (d.x / len) * Math.min(len, temp)));
      p.y = Math.min(height - 30, Math.max(30, p.y + (d.y / len) * Math.min(len, temp)));
    }
    temp *= 0.98;
  }
  return pos;
}
