"""Generates the seamless background tiles for the built-in themes (app/public/themes). Deterministic: run
`python scripts/make-theme-tiles.py` and the same files come out."""
import math, os, random

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app', 'public', 'themes') + os.sep

def cobblestone():
    rnd = random.Random(7)
    W = H = 240
    rows = 6
    rh = H / rows
    stones = []
    for r in range(rows):
        y = r * rh
        x = -rnd.uniform(0, 30) - (20 if r % 2 else 0)
        while x < W:
            w = rnd.uniform(34, 58)
            stones.append((x, y, w, rh, r))
            x += w
        # make the row tile exactly: stretch so it spans start..start+W
    # Rebuild rows so each row's stones sum to exactly W (seamless horizontally).
    out = []
    for r in range(rows):
        y = r * rh
        start = -rnd.uniform(4, 36)
        n = rnd.choice([5, 5, 6])
        ws = [rnd.uniform(0.8, 1.25) for _ in range(n)]
        tot = sum(ws)
        x = start
        for wv in ws:
            w = wv / tot * W
            out.append((x, y, w, rh))
            x += w
    defs = []
    shapes = []
    palette = ['#a79a89', '#b3a693', '#9d907f', '#ad9f8b', '#988b7b', '#b8ab98', '#a39583']
    for i, (x, y, w, h) in enumerate(out):
        g = 3.2  # mortar gap
        rx = rnd.uniform(9, 15)
        jx, jy = rnd.uniform(-1.5, 1.5), rnd.uniform(-1.5, 1.5)
        fill = rnd.choice(palette)
        gid = f'g{i}'
        defs.append(f'<radialGradient id="{gid}" cx="{rnd.uniform(.35,.5):.2f}" cy="{rnd.uniform(.3,.42):.2f}" r=".8"><stop offset="0" stop-color="{fill}"/><stop offset=".75" stop-color="{fill}" stop-opacity=".92"/><stop offset="1" stop-color="#6f6356"/></radialGradient>')
        for dx in (-W, 0, W):
            shapes.append(
                f'<rect x="{x+dx+g/2+jx:.1f}" y="{y+g/2+jy:.1f}" width="{w-g:.1f}" height="{h-g:.1f}" rx="{rx:.1f}" fill="url(#{gid})"/>'
            )
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
<defs>{''.join(defs)}
<filter id="n" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 .25  0 0 0 0 .2  0 0 0 0 .15  0 0 0 .22 0"/></filter>
</defs>
<rect width="{W}" height="{H}" fill="#62574b"/>
{''.join(shapes)}
<rect width="{W}" height="{H}" filter="url(#n)"/>
</svg>
'''
    open(OUT + 'cobblestone.svg', 'w', encoding='utf-8').write(svg)

def lace():
    # A faint lace / damask motif on deep wine: rosettes on a diamond lattice.
    W = H = 120
    c = '#f2a9b9'
    def rosette(cx, cy, r, op):
        petals = ''.join(
            f'<ellipse cx="{cx + r*0.55*math.cos(a):.1f}" cy="{cy + r*0.55*math.sin(a):.1f}" rx="{r*0.42:.1f}" ry="{r*0.2:.1f}" transform="rotate({math.degrees(a):.0f} {cx + r*0.55*math.cos(a):.1f} {cy + r*0.55*math.sin(a):.1f})"/>'
            for a in [k * math.pi / 4 for k in range(8)]
        )
        return f'<g fill="none" stroke="{c}" stroke-opacity="{op}" stroke-width="1"><circle cx="{cx}" cy="{cy}" r="{r*0.18:.1f}"/>{petals}<circle cx="{cx}" cy="{cy}" r="{r:.1f}" stroke-dasharray="2 3"/></g>'
    parts = []
    for (x, y) in [(0, 0), (W, 0), (0, H), (W, H)]:
        parts.append(rosette(x, y, 26, .22))
    parts.append(rosette(W / 2, H / 2, 26, .22))
    # little hearts between
    def heart(x, y, s, op):
        return f'<path transform="translate({x} {y}) scale({s})" d="M0 3C-3-1-7 1-5 4L0 9 5 4C7 1 3-1 0 3Z" fill="{c}" fill-opacity="{op}"/>'
    for (x, y) in [(W / 2, 0), (W / 2, H), (0, H / 2), (W, H / 2)]:
        parts.append(heart(x, y - 4, 1.1, .16))
    lattice = f'<path d="M0 {H/2} L{W/2} 0 L{W} {H/2} L{W/2} {H} Z" fill="none" stroke="{c}" stroke-opacity=".08" stroke-width="1"/>'
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
<rect width="{W}" height="{H}" fill="#2a0f17"/>
{lattice}
{''.join(parts)}
</svg>
'''
    open(OUT + 'lace.svg', 'w', encoding='utf-8').write(svg)

def sage_leaves():
    # Scattered sage sprigs: a curved stem with soft paired leaves, in tones just off the Sage background.
    rnd = random.Random(11)
    W = H = 180
    bg = '#cfdbc3'
    tones = ['#b9c9aa', '#c3d1b5', '#aebf9f', '#dbe5d1']
    def sprig(x, y, angle, scale, tone, vein):
        leaves = []
        for k, (t, side) in enumerate([(0.25, 1), (0.42, -1), (0.6, 1), (0.76, -1)]):
            lx, ly = 0, -40 * t
            rot = side * (52 - k * 6)
            sz = 1.0 - k * 0.14
            leaves.append(
                f'<g transform="translate({lx:.1f} {ly:.1f}) rotate({rot}) scale({sz:.2f})">'
                f'<path d="M0 0 C 5 -6 6 -16 0 -24 C -6 -16 -5 -6 0 0 Z" fill="{tone}"/>'
                f'<path d="M0 -2 L0 -20" stroke="{vein}" stroke-width=".6" stroke-linecap="round"/></g>'
            )
        tip = f'<g transform="translate(0 -40) scale(.8)"><path d="M0 0 C 4 -5 5 -13 0 -19 C -5 -13 -4 -5 0 0 Z" fill="{tone}"/></g>'
        stem = f'<path d="M0 0 Q 2 -20 0 -40" fill="none" stroke="{vein}" stroke-width="1.1" stroke-linecap="round"/>'
        return f'<g transform="translate({x:.1f} {y:.1f}) rotate({angle:.0f}) scale({scale:.2f})">{stem}{"".join(leaves)}{tip}</g>'
    spots = [(32, 34), (122, 28), (78, 94), (166, 88), (28, 152), (118, 146)]
    parts = []
    # Each sprig as a few points along its stem (it grows "up" from its base, rotated by its angle). Keep every pair,
    # including copies across the tile's edges, at least `gap` apart so no two sprigs touch.
    def points(x, y, a, s):
        r = math.radians(a)
        return [(x + math.sin(r) * 44 * s * t, y - math.cos(r) * 44 * s * t) for t in (0, .33, .66, 1)]
    def clear(p, others, gap=30):
        for q in others:
            for (px, py) in p:
                for (qx, qy) in q:
                    dx = (px - qx + W / 2) % W - W / 2
                    dy = (py - qy + H / 2) % H - H / 2
                    if dx * dx + dy * dy < gap * gap:
                        return False
        return True
    placed = []
    picks = []
    for (x, y) in spots:
        for _ in range(400):
            a = rnd.uniform(-60, 60) + rnd.choice([0, 180])
            s = rnd.uniform(0.75, 1.0)
            if clear(points(x, y, a, s), placed):
                break
        placed.append(points(x, y, a, s))
        picks.append((x, y, a, s))
    for (x, y, a, s) in picks:
        tone = rnd.choice(tones)
        vein = '#a4b694' if tone != '#dbe5d1' else '#c6d4b8'
        for dx in (-W, 0, W):
            for dy in (-H, 0, H):
                parts.append(sprig(x + dx, y + dy, a, s, tone, vein))
    dots = ''.join(f'<circle cx="{rnd.uniform(0, W):.1f}" cy="{rnd.uniform(0, H):.1f}" r="{rnd.uniform(.8, 1.6):.1f}" fill="#bccbae" fill-opacity=".7"/>' for _ in range(14))
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
<rect width="{W}" height="{H}" fill="{bg}"/>
{dots}
{''.join(parts)}
</svg>
'''
    open(OUT + 'sage-leaves.svg', 'w', encoding='utf-8').write(svg)

def starship():
    # Deep space: faint cyan circuit traces on a 20 px grid, with scattered stars.
    rnd = random.Random(42)
    W = H = 240
    G = 20
    cyan = '#4fd8e8'
    dirs = [(1, 0), (0, 1), (-1, 0), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)]
    traces = []
    for _ in range(13):
        x, y = rnd.randrange(0, W // G) * G, rnd.randrange(0, H // G) * G
        pts = [(x, y)]
        d = rnd.choice(dirs[:4])
        for _ in range(rnd.randint(2, 4)):
            n = rnd.randint(1, 3)
            x += d[0] * G * n
            y += d[1] * G * n
            pts.append((x, y))
            # Turn somewhere new (never straight back): circuit traces bend at right angles and 45°.
            d = rnd.choice([e for e in dirs if e not in (d, (-d[0], -d[1]))])
        traces.append(pts)
    parts = []
    for pts in traces:
        path = 'M' + ' L'.join(f'{px} {py}' for px, py in pts)
        end = pts[-1]
        for dx in (-W, 0, W):
            for dy in (-H, 0, H):
                parts.append(f'<g transform="translate({dx} {dy})"><path d="{path}" fill="none" stroke="{cyan}" stroke-opacity=".13" stroke-width="1.2" stroke-linejoin="round"/>'
                             f'<circle cx="{pts[0][0]}" cy="{pts[0][1]}" r="2" fill="{cyan}" fill-opacity=".22"/>'
                             f'<circle cx="{end[0]}" cy="{end[1]}" r="3" fill="none" stroke="{cyan}" stroke-opacity=".25"/></g>')
    stars = []
    for _ in range(46):
        x, y = rnd.uniform(0, W), rnd.uniform(0, H)
        r = rnd.choice([.5, .6, .7, .9, 1.2])
        stars.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="#e8f4ff" fill-opacity="{rnd.uniform(.25, .7):.2f}"/>')
    for _ in range(3):
        x, y = rnd.uniform(12, W - 12), rnd.uniform(12, H - 12)
        stars.append(f'<path d="M{x:.1f} {y-4:.1f} L{x+.8:.1f} {y-.8:.1f} L{x+4:.1f} {y:.1f} L{x+.8:.1f} {y+.8:.1f} L{x:.1f} {y+4:.1f} L{x-.8:.1f} {y+.8:.1f} L{x-4:.1f} {y:.1f} L{x-.8:.1f} {y-.8:.1f} Z" fill="#e8f4ff" fill-opacity=".55"/>')
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
<rect width="{W}" height="{H}" fill="#0b1220"/>
{''.join(parts)}
{''.join(stars)}
</svg>
'''
    open(OUT + 'starship.svg', 'w', encoding='utf-8').write(svg)

os.makedirs(OUT, exist_ok=True)
cobblestone()
lace()
sage_leaves()
starship()
print('ok')
