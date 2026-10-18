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

# ---------- Scattered-motif tiles (genre themes) ----------

def scatter(rnd, W, H, n, gap, tries=3000):
    """Up to n points spread over a W×H tile, at least `gap` apart even across the wrap-around edges."""
    pts = []
    for _ in range(tries):
        if len(pts) >= n:
            break
        x, y = rnd.uniform(0, W), rnd.uniform(0, H)
        ok = True
        for (px, py) in pts:
            dx = (x - px + W / 2) % W - W / 2
            dy = (y - py + H / 2) % H - H / 2
            if dx * dx + dy * dy < gap * gap:
                ok = False
                break
        if ok:
            pts.append((x, y))
    return pts

def wrapped(W, H, x, y, body, pad=40):
    """A motif at (x, y), plus its copies across the edges it comes near, so the tile repeats seamlessly."""
    out = []
    for dx in (-W, 0, W):
        for dy in (-H, 0, H):
            X, Y = x + dx, y + dy
            if -pad <= X <= W + pad and -pad <= Y <= H + pad:
                out.append(f'<g transform="translate({X:.1f} {Y:.1f})">{body}</g>')
    return ''.join(out)

def tile(name, W, H, bg, motifs):
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">\n<rect width="{W}" height="{H}" fill="{bg}"/>\n{motifs}\n</svg>\n'
    open(OUT + name, 'w', encoding='utf-8').write(svg)

def rot(body, deg, s=1.0):
    return f'<g transform="rotate({deg:.0f}) scale({s:.2f})">{body}</g>'

def sparkle(c, op, r=6):
    return f'<path d="M0 {-r} L{r*.22:.1f} {-r*.22:.1f} L{r} 0 L{r*.22:.1f} {r*.22:.1f} L0 {r} L{-r*.22:.1f} {r*.22:.1f} L{-r} 0 L{-r*.22:.1f} {-r*.22:.1f} Z" fill="{c}" fill-opacity="{op}"/>'

def crescent(c, op, r=9):
    return f'<path d="M0 {-r} A{r} {r} 0 1 0 0 {r} A{r*.75:.1f} {r*.85:.1f} 0 1 1 0 {-r} Z" fill="{c}" fill-opacity="{op}"/>'

def star5(c, op, r=7):
    pts = []
    for k in range(10):
        a = math.pi / 2 + k * math.pi / 5
        rr = r if k % 2 == 0 else r * 0.45
        pts.append(f'{math.cos(a)*rr:.1f} {-math.sin(a)*rr:.1f}')
    return f'<path d="M{" L".join(pts)} Z" fill="{c}" fill-opacity="{op}"/>'

def heart(c, op, s=1.0):
    return f'<path transform="scale({s:.2f})" d="M0 4C-4-1-10 1-8 6L0 13 8 6C10 1 4-1 0 4Z" fill="{c}" fill-opacity="{op}"/>'

def writing_desk():
    # Honey-oak planks with flowing grain and the odd knot; seamless (grain periods divide the width).
    rnd = random.Random(3)
    W, H = 320, 240
    rows = 4
    rh = H / rows
    tones = ['#c99f6c', '#c39563', '#cda574', '#bf9160']
    parts = []
    for r in range(rows):
        y0 = r * rh
        parts.append(f'<rect x="0" y="{y0:.1f}" width="{W}" height="{rh:.1f}" fill="{tones[r % len(tones)]}"/>')
        for g in range(7):
            yy = y0 + 5 + g * (rh - 10) / 6 + rnd.uniform(-2, 2)
            k = rnd.choice([1, 2])
            amp = rnd.uniform(1.5, 4)
            ph = rnd.uniform(0, math.tau)
            d = 'M' + ' L'.join(f'{x:.1f} {yy + amp*math.sin(math.tau*k*x/W + ph):.1f}' for x in range(0, W + 1, 8))
            parts.append(f'<path d="{d}" fill="none" stroke="#8a5e34" stroke-opacity="{rnd.uniform(.12, .25):.2f}" stroke-width="{rnd.uniform(.6, 1.4):.1f}"/>')
        # a knot now and then
        if r % 2 == 0:
            kx = rnd.uniform(20, W - 20)
            ky = y0 + rh / 2 + rnd.uniform(-6, 6)
            knot = ''.join(f'<ellipse cx="0" cy="0" rx="{4+i*3}" ry="{2+i*1.5:.1f}" fill="none" stroke="#7a4f2a" stroke-opacity="{.3-i*.06:.2f}" stroke-width=".8"/>' for i in range(4))
            parts.append(wrapped(W, H, kx, ky, knot))
        # plank seams: the long edge and an end joint
        parts.append(f'<rect x="0" y="{y0:.1f}" width="{W}" height="1.2" fill="#6e4726" fill-opacity=".35"/>')
        jx = rnd.uniform(30, W - 30)
        parts.append(f'<rect x="{jx:.1f}" y="{y0:.1f}" width="1.2" height="{rh:.1f}" fill="#6e4726" fill-opacity=".3"/>')
    tile('writing-desk.svg', W, H, '#c49a68', ''.join(parts))

def fantasy():
    # Enchanted forest at night: gold sparkles, crescent moons and little runes on deep emerald.
    rnd = random.Random(21)
    W = H = 220
    gold = '#e3c26a'
    runes = [
        'M0 -8 L0 8 M0 -8 L5 -3 M0 -2 L5 3',          # ᚠ-like
        'M-4 8 L-4 -8 L4 0 L-4 8',                     # ᚦ-like
        'M0 -8 L0 8 M-5 -3 L5 3',                      # ᛁ with a slash
        'M-5 -8 L0 0 L5 -8 M0 0 L0 8',                 # ᛉ-like
        'M-4 -8 L4 8 M4 -8 L-4 8',                     # ᚷ
    ]
    pts = scatter(rnd, W, H, 22, 30)
    parts = []
    for i, (x, y) in enumerate(pts):
        kind = i % 5
        if kind in (0, 1, 2):
            body = sparkle(gold, rnd.uniform(.25, .55), rnd.uniform(3, 7))
        elif kind == 3:
            body = rot(crescent(gold, .3, rnd.uniform(6, 9)), rnd.uniform(-40, 40))
        else:
            body = f'<path d="{rnd.choice(runes)}" fill="none" stroke="{gold}" stroke-opacity=".28" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'
        parts.append(wrapped(W, H, x, y, body))
    dots = ''.join(f'<circle cx="{rnd.uniform(0,W):.1f}" cy="{rnd.uniform(0,H):.1f}" r="{rnd.uniform(.5,1.1):.1f}" fill="{gold}" fill-opacity="{rnd.uniform(.2,.5):.2f}"/>' for _ in range(30))
    tile('fantasy.svg', W, H, '#13261f', dots + ''.join(parts))

def mystery():
    # Noir: question marks, magnifying glasses and fingerprints, faint on charcoal.
    rnd = random.Random(5)
    W = H = 220
    c = '#c9ccd4'
    def magnifier(op):
        return f'<g fill="none" stroke="{c}" stroke-opacity="{op}" stroke-width="1.6" stroke-linecap="round"><circle cx="-2" cy="-2" r="7"/><path d="M3 3 L10 10"/></g>'
    def fingerprint(op):
        arcs = ''.join(f'<path d="M{-r} 2 A{r} {r*1.25:.1f} 0 0 1 {r} 2" />' for r in (2.5, 5, 7.5, 10))
        return f'<g fill="none" stroke="{c}" stroke-opacity="{op}" stroke-width="1">{arcs}<path d="M-10 2 Q-10 9 -6 12 M10 2 Q10 8 7 11"/></g>'
    def question(op):
        return f'<text x="0" y="7" text-anchor="middle" font-family="Georgia, \'Times New Roman\', serif" font-size="20" font-style="italic" fill="{c}" fill-opacity="{op}">?</text>'
    pts = scatter(rnd, W, H, 12, 48)
    parts = []
    for i, (x, y) in enumerate(pts):
        k = i % 3
        body = question(.16) if k == 0 else magnifier(.15) if k == 1 else fingerprint(.13)
        parts.append(wrapped(W, H, x, y, rot(body, rnd.uniform(-25, 25), rnd.uniform(.85, 1.15))))
    tile('mystery.svg', W, H, '#1c1e24', ''.join(parts))

def spooky():
    # Cute horror: little bats, moons and pumpkins on deep purple.
    rnd = random.Random(13)
    W = H = 220
    def bat(op):
        return f'<path d="M0 -2 C2 -6 6 -6 8 -3 C10 -6 14 -5 15 -1 C12 -1 10 1 9 3 C7 1 4 2 2 4 C1 2 -1 2 -2 4 C-4 2 -7 1 -9 3 C-10 1 -12 -1 -15 -1 C-14 -5 -10 -6 -8 -3 C-6 -6 -2 -6 0 -2 Z" fill="#cbb6ea" fill-opacity="{op}"/>'
    def pumpkin(op):
        return (f'<g fill="#ff9a3c" fill-opacity="{op}"><ellipse cx="-4" cy="2" rx="5" ry="6"/><ellipse cx="4" cy="2" rx="5" ry="6"/><ellipse cx="0" cy="2" rx="5" ry="6.5"/></g>'
                f'<path d="M0 -4 Q1 -8 3 -9" stroke="#8fbf6a" stroke-opacity="{op+.1:.2f}" stroke-width="1.6" fill="none" stroke-linecap="round"/>')
    pts = scatter(rnd, W, H, 16, 40)
    parts = []
    for i, (x, y) in enumerate(pts):
        k = i % 4
        if k in (0, 1):
            body = rot(bat(.3), rnd.uniform(-20, 20), rnd.uniform(.8, 1.1))
        elif k == 2:
            body = pumpkin(.35)
        else:
            body = rot(crescent('#f3e3a1', .3, 7), rnd.uniform(-30, 30))
        parts.append(wrapped(W, H, x, y, body))
    dots = ''.join(f'<circle cx="{rnd.uniform(0,W):.1f}" cy="{rnd.uniform(0,H):.1f}" r="{rnd.uniform(.5,1):.1f}" fill="#e8dcff" fill-opacity="{rnd.uniform(.2,.45):.2f}"/>' for _ in range(24))
    tile('spooky.svg', W, H, '#1f1430', dots + ''.join(parts))

def storybook():
    # Children's books: pastel stars, hearts, dots and crayon squiggles on cream.
    rnd = random.Random(8)
    W = H = 200
    pastel = ['#f7a8b8', '#a8d8f0', '#b8e0a8', '#f8d78a', '#c9b3f0']
    pts = scatter(rnd, W, H, 18, 36)
    parts = []
    for i, (x, y) in enumerate(pts):
        c = pastel[i % len(pastel)]
        k = i % 4
        if k == 0:
            body = rot(star5(c, .55, rnd.uniform(6, 8)), rnd.uniform(-20, 20))
        elif k == 1:
            body = rot(heart(c, .55, rnd.uniform(.7, .9)), rnd.uniform(-20, 20))
        elif k == 2:
            body = rot(f'<path d="M-10 0 Q-5 -6 0 0 T10 0" fill="none" stroke="{c}" stroke-opacity=".7" stroke-width="2.4" stroke-linecap="round"/>', rnd.uniform(-40, 40))
        else:
            body = f'<circle r="{rnd.uniform(3,4.5):.1f}" fill="{c}" fill-opacity=".55"/>'
        parts.append(wrapped(W, H, x, y, body))
    tile('storybook.svg', W, H, '#fdf4e3', ''.join(parts))

def wild_west():
    # Westerns: saguaro cacti, horseshoes and stars on sand.
    rnd = random.Random(17)
    W = H = 220
    def cactus(op):
        return (f'<g fill="#7f9a5a" fill-opacity="{op}"><rect x="-3" y="-12" width="6" height="22" rx="3"/>'
                f'<path d="M-3 0 H-7 a2.5 2.5 0 0 1 -2.5 -2.5 V-8 a2.5 2.5 0 0 1 5 0 V-3 H-3 Z"/>'
                f'<path d="M3 -3 H7 a2.5 2.5 0 0 0 2.5 -2.5 V-10 a2.5 2.5 0 0 0 -5 0 V-6 H3 Z"/></g>')
    def horseshoe(op):
        # Opening upward, the lucky way.
        return f'<path d="M-6 -6 V1 A6 6 0 0 0 6 1 V-6" fill="none" stroke="#8a5a3a" stroke-opacity="{op}" stroke-width="2.6" stroke-linecap="round"/>'
    pts = scatter(rnd, W, H, 15, 42)
    parts = []
    for i, (x, y) in enumerate(pts):
        k = i % 3
        if k == 0:
            body = rot(cactus(.32), rnd.uniform(-8, 8), rnd.uniform(.85, 1.1))
        elif k == 1:
            body = rot(horseshoe(.28), rnd.uniform(-30, 30))
        else:
            body = rot(star5('#b5672f', .25, rnd.uniform(5, 7)), rnd.uniform(-20, 20))
        parts.append(wrapped(W, H, x, y, body))
    dots = ''.join(f'<circle cx="{rnd.uniform(0,W):.1f}" cy="{rnd.uniform(0,H):.1f}" r="{rnd.uniform(.6,1.2):.1f}" fill="#b89567" fill-opacity=".35"/>' for _ in range(26))
    tile('wild-west.svg', W, H, '#e6cfa6', dots + ''.join(parts))

def christmas():
    # Cozy Christmas on snow: snowflakes, holly, candy canes, little trees and stars in red, green and frost blue.
    rnd = random.Random(25)
    W = H = 220
    red, green, frost, gold = '#c8303a', '#2f7a4a', '#8fb0c8', '#d9a83a'
    def snowflake(op, r=8):
        arms = ''.join(
            f'<g transform="rotate({a})"><path d="M0 0 V{-r} M0 {-r*.55:.1f} L{-r*.25:.1f} {-r*.8:.1f} M0 {-r*.55:.1f} L{r*.25:.1f} {-r*.8:.1f}"/></g>'
            for a in range(0, 360, 60)
        )
        return f'<g fill="none" stroke="{frost}" stroke-opacity="{op}" stroke-width="1.3" stroke-linecap="round">{arms}</g>'
    def holly(op):
        leaf = f'<path d="M0 0 C3 -2 4 -6 9 -7 C8 -4 10 -2 9 0 C10 2 8 4 9 7 C4 6 3 2 0 0 Z" fill="{green}" fill-opacity="{op}"/>'
        return (f'<g transform="rotate(-20)">{leaf}</g><g transform="rotate(200)">{leaf}</g>'
                f'<circle cx="-1" cy="2" r="2.4" fill="{red}" fill-opacity="{op+.1:.2f}"/><circle cx="2.5" cy="3" r="2.4" fill="{red}" fill-opacity="{op+.1:.2f}"/><circle cx="0.5" cy="-1" r="2.4" fill="{red}" fill-opacity="{op+.1:.2f}"/>')
    def candy_cane(op):
        d = 'M0 10 V-5 A4 4 0 0 1 8 -5'
        return (f'<path d="{d}" fill="none" stroke="#ffffff" stroke-opacity="{min(1, op+.4):.2f}" stroke-width="3.6" stroke-linecap="round"/>'
                f'<path d="{d}" fill="none" stroke="{red}" stroke-opacity="{op+.1:.2f}" stroke-width="3.6" stroke-linecap="butt" stroke-dasharray="2.5 2.5"/>')
    def tree(op):
        return (f'<path d="M0 -10 L6 -2 H3 L8 5 H-8 L-3 -2 H-6 Z" fill="{green}" fill-opacity="{op}"/>'
                f'<rect x="-1.5" y="5" width="3" height="3" fill="#8a5a3a" fill-opacity="{op}"/>' + star5(gold, op + .15, 2.6).replace('<path', '<path transform="translate(0 -11)"', 1))
    pts = scatter(rnd, W, H, 16, 42)
    parts = []
    for i, (x, y) in enumerate(pts):
        k = i % 5
        if k == 0:
            body = rot(snowflake(.55, rnd.uniform(6, 8)), rnd.uniform(0, 30))
        elif k == 1:
            body = rot(holly(.45), rnd.uniform(-30, 30))
        elif k == 2:
            body = rot(candy_cane(.45), rnd.uniform(-25, 25))
        elif k == 3:
            body = tree(.4)
        else:
            body = rot(star5(gold, .4, rnd.uniform(5, 7)), rnd.uniform(-20, 20))
        parts.append(wrapped(W, H, x, y, body))
    dots = ''.join(f'<circle cx="{rnd.uniform(0,W):.1f}" cy="{rnd.uniform(0,H):.1f}" r="{rnd.uniform(.8,1.6):.1f}" fill="{frost}" fill-opacity=".35"/>' for _ in range(26))
    tile('christmas.svg', W, H, '#f6f1e8', dots + ''.join(parts))

os.makedirs(OUT, exist_ok=True)
christmas()
writing_desk()
fantasy()
mystery()
spooky()
storybook()
wild_west()
cobblestone()
lace()
sage_leaves()
starship()
print('ok')
