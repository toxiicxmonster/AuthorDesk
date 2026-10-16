'use strict';
// Remembers the window's size, position and whether it was maximised, so AuthorDesk opens the way it was left.
// A saved position on a monitor that's no longer connected is ignored (the window opens centred instead).
const fs = require('node:fs');
const path = require('node:path');
const { dataDir } = require('./paths.cjs');

const file = () => path.join(dataDir(), 'window.json');
const DEFAULT = { width: 1400, height: 900 };

/** Is enough of the rectangle on one of the displays to grab and move it? */
function visibleOn(bounds, displays) {
  return displays.some((d) => {
    const a = d.workArea;
    const w = Math.min(bounds.x + bounds.width, a.x + a.width) - Math.max(bounds.x, a.x);
    const h = Math.min(bounds.y + bounds.height, a.y + a.height) - Math.max(bounds.y, a.y);
    return w >= 120 && h >= 60;
  });
}

/** The size (and position, when it's still on screen) to open with, and whether to maximise. */
function loadState(displays) {
  try {
    const s = JSON.parse(fs.readFileSync(file(), 'utf8'));
    const ok = (n) => Number.isFinite(n);
    if (!ok(s.width) || !ok(s.height) || s.width < 360 || s.height < 400) return { ...DEFAULT, maximized: false };
    const bounds = { width: Math.round(s.width), height: Math.round(s.height) };
    if (ok(s.x) && ok(s.y) && visibleOn({ ...bounds, x: s.x, y: s.y }, displays)) Object.assign(bounds, { x: Math.round(s.x), y: Math.round(s.y) });
    return { ...bounds, maximized: !!s.maximized };
  } catch {
    return { ...DEFAULT, maximized: false };
  }
}

/** Saves the window's normal (not maximised) bounds and its maximised state. */
function saveState(win) {
  try {
    const b = win.getNormalBounds();
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify({ ...b, maximized: win.isMaximized() }));
  } catch {
    /* not worth bothering anyone about */
  }
}

module.exports = { loadState, saveState, visibleOn };
