/**
 * Themes. A theme is five base colours; every other UI colour is derived from them so a custom theme
 * always looks coherent. Built-in themes and user themes use the same shape.
 */

export interface ThemeColors {
  /** App background behind panels. */
  background: string;
  /** Panels, toolbars, cards. */
  panel: string;
  /** The writing page. */
  page: string;
  /** Main text. */
  text: string;
  /** Buttons, links, highlights. */
  accent: string;
}

/**
 * A picture behind everything (where the background colour shows): fitted to the window, or repeated as a tile.
 * `fade` (0–90) washes it with the background colour so text on it stays readable.
 */
export interface ThemeBackground {
  /** An image URL: a built-in file ("./themes/…") or a picture the author chose (a data: URL). */
  image: string;
  mode: 'fit' | 'repeat';
  fade: number;
}

export interface ThemeDef {
  id: string;
  name: string;
  colors: ThemeColors;
  background?: ThemeBackground | null;
  builtIn?: boolean;
}

export const BUILTIN_THEMES: ThemeDef[] = [
  {
    id: 'paper',
    name: 'Paper',
    builtIn: true,
    colors: { background: '#f7f5f0', panel: '#ffffff', page: '#fffdf8', text: '#2b2a27', accent: '#7a5c2e' },
  },
  {
    id: 'sepia',
    name: 'Sepia',
    builtIn: true,
    colors: { background: '#e9dfc9', panel: '#f4ecda', page: '#f7efdc', text: '#3b2f22', accent: '#8b3f22' },
  },
  {
    id: 'velvet',
    name: 'Velvet Sheets',
    builtIn: true,
    // For steamy romance: deep wine and candlelight, rose-gold accents, a whisper of lace behind it all.
    colors: { background: '#2a0f17', panel: '#3a1621', page: '#2f121a', text: '#f7e4e7', accent: '#f08aa0' },
    background: { image: './themes/lace.svg', mode: 'repeat', fade: 20 },
  },
  {
    id: 'sage',
    name: 'Sage',
    builtIn: true,
    // A herb garden: sprigs of sage scattered behind the panels.
    colors: { background: '#cfdbc3', panel: '#e5ecdc', page: '#f4f6ed', text: '#26301f', accent: '#4f6e45' },
    background: { image: './themes/sage-leaves.svg', mode: 'repeat', fade: 10 },
  },
  {
    id: 'cottage',
    name: 'Cozy Cottage',
    builtIn: true,
    // A cobbled lane outside, cream paper, chocolate ink and a terracotta door.
    colors: { background: '#b7a893', panel: '#f2e4d2', page: '#fdf8f0', text: '#3b2a20', accent: '#a04e3a' },
    background: { image: './themes/cobblestone.svg', mode: 'repeat', fade: 30 },
  },
  {
    id: 'night',
    name: 'Night',
    builtIn: true,
    colors: { background: '#1b1c20', panel: '#24252b', page: '#202126', text: '#e6e3dc', accent: '#d9b26f' },
  },
  {
    id: 'starship',
    name: 'Starship',
    builtIn: true,
    // Sci-fi: a ship's console in deep space, cyan readouts over faint circuitry and stars.
    colors: { background: '#0b1220', panel: '#121c30', page: '#0e1626', text: '#dde9f6', accent: '#4fd8e8' },
    background: { image: './themes/starship.svg', mode: 'repeat', fade: 0 },
  },
];

const HEX = /^#([0-9a-f]{6})$/i;

export function isHex(s: string): boolean {
  return HEX.test(s);
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: number[]): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

/** Mix two colours; t = share of b (0..1). */
export function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
}

export function luminance(hex: string): number {
  const c = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** WCAG contrast ratio (1–21). 4.5+ is comfortable for body text. */
export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

export function isDark(t: ThemeColors): boolean {
  return luminance(t.background) < 0.2;
}

/** Pick black or white text for use on top of a colour (e.g. accent buttons). */
export function onColor(hex: string): string {
  return contrast(hex, '#ffffff') >= contrast(hex, '#1a1a1a') ? '#ffffff' : '#1a1a1a';
}

/**
 * Text softened toward the panel colour as far as `wanted`, but never so far that it drops below `minContrast`
 * against any of the backgrounds it's used on (muted hints must stay readable in every theme).
 */
function softened(c: ThemeColors, wanted: number, minContrast: number, backgrounds: readonly string[]): string {
  for (let f = wanted; f > 0; f -= 0.02) {
    const color = mix(c.text, c.panel, f);
    if (backgrounds.every((b) => contrast(color, b) >= minContrast)) return color;
  }
  return c.text;
}

/** Expand the five base colours into every CSS token the app uses. */
export function themeTokens(c: ThemeColors): Record<string, string> {
  const dark = isDark(c);
  const surface2 = mix(c.panel, c.text, dark ? 0.08 : 0.05);
  const behind = [c.background, c.panel, surface2, c.page];
  return {
    '--bg': c.background,
    '--surface': c.panel,
    '--surface-2': surface2,
    '--line': mix(c.panel, c.text, dark ? 0.18 : 0.14),
    '--text': c.text,
    // WCAG AA for small text is 4.5:1; secondary text gets a little more.
    '--text-2': softened(c, 0.28, 5.5, behind),
    '--muted': softened(c, 0.48, 4.5, behind),
    '--accent': c.accent,
    '--accent-soft': mix(c.panel, c.accent, dark ? 0.22 : 0.16),
    '--on-accent': onColor(c.accent),
    '--focus': dark ? '#7fb0ea' : '#2f6db5',
    '--danger': dark ? '#e4836f' : '#a33b2b',
    '--warn': dark ? '#e0b04c' : '#7a5600',
    '--ok': dark ? '#7cc48a' : '#2f6b3a',
    '--err-line': dark ? '#e4836f' : '#c0392b',
    '--warn-line': dark ? '#e0b04c' : '#c58b00',
    '--style-line': dark ? '#7fb0ea' : '#4a7fb5',
    '--note-line': dark ? '#6fcf8f' : '#2e8b57',
    '--echo-line': dark ? '#4fd1d1' : '#12898f',
    '--hard-line': dark ? '#f0a060' : '#d35400',
    '--conflict-line': dark ? '#c39bd3' : '#8e44ad',
    '--page': c.page,
    '--shadow': dark ? '0 1px 2px rgba(0,0,0,.3), 0 4px 16px rgba(0,0,0,.3)' : '0 1px 2px rgba(0,0,0,.06), 0 4px 16px rgba(0,0,0,.06)',
    'color-scheme': dark ? 'dark' : 'light',
  };
}

export function allThemes(custom: ThemeDef[]): ThemeDef[] {
  return [...BUILTIN_THEMES, ...custom];
}

/** Resolve the theme setting ('system', a theme id, or legacy 'light'/'dark'). */
export function resolveTheme(setting: string, custom: ThemeDef[], prefersDark: boolean): ThemeDef {
  const id = setting === 'system' ? (prefersDark ? 'night' : 'paper') : setting === 'light' ? 'paper' : setting === 'dark' ? 'night' : setting;
  return allThemes(custom).find((t) => t.id === id) ?? BUILTIN_THEMES[0];
}

export function applyTheme(theme: ThemeDef) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(themeTokens(theme.colors))) {
    if (k === 'color-scheme') root.style.colorScheme = v;
    else root.style.setProperty(k, v);
  }
  const bg = theme.background;
  if (bg?.image) {
    // A full address: a relative one in a custom property is read against the stylesheet's folder, not the app's.
    const url = bg.image.startsWith('data:') ? bg.image : new URL(bg.image, document.baseURI).href;
    root.style.setProperty('--bg-image', `url("${url.replace(/"/g, '%22')}")`);
    root.style.setProperty('--bg-fade', `${Math.max(0, Math.min(90, bg.fade))}%`);
    root.dataset.bgMode = bg.mode;
  } else {
    root.style.removeProperty('--bg-image');
    root.style.removeProperty('--bg-fade');
    delete root.dataset.bgMode;
  }
  root.dataset.theme = isDark(theme.colors) ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.colors.panel);
}

/** A theme's background picture from a file or settings, or null if it isn't a usable one. */
export function parseBackground(v: unknown): ThemeBackground | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as { image?: unknown; mode?: unknown; fade?: unknown };
  // Only pictures carried inside the theme (data: URLs) or the app's own files: never a link to another site.
  if (typeof o.image !== 'string' || !(/^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(o.image) || /^\.\/themes\/[\w-]+\.(svg|png|jpg|webp)$/.test(o.image))) return null;
  return { image: o.image, mode: o.mode === 'fit' ? 'fit' : 'repeat', fade: typeof o.fade === 'number' && o.fade >= 0 && o.fade <= 90 ? Math.round(o.fade) : 30 };
}

/** Validate a theme loaded from a file. Returns null if it isn't a usable theme. */
export function parseThemeFile(json: unknown): ThemeDef | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as { name?: unknown; colors?: Record<string, unknown>; background?: unknown };
  const keys: (keyof ThemeColors)[] = ['background', 'panel', 'page', 'text', 'accent'];
  if (typeof o.name !== 'string' || !o.colors || !keys.every((k) => typeof o.colors![k] === 'string' && isHex(o.colors![k] as string))) return null;
  return {
    id: `custom-${crypto.getRandomValues(new Uint32Array(2)).join('')}`,
    name: o.name.slice(0, 40),
    colors: Object.fromEntries(keys.map((k) => [k, (o.colors![k] as string).toLowerCase()])) as unknown as ThemeColors,
    background: parseBackground(o.background),
  };
}
