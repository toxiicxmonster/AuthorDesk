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

export interface ThemeDef {
  id: string;
  name: string;
  colors: ThemeColors;
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
    id: 'pastel-blue',
    name: 'Pastel Blue',
    builtIn: true,
    colors: { background: '#dde9f5', panel: '#eef4fb', page: '#f7fafd', text: '#1e2b3a', accent: '#3f6f9f' },
  },
  {
    id: 'sage',
    name: 'Sage',
    builtIn: true,
    colors: { background: '#cfdbc3', panel: '#e5ecdc', page: '#f4f6ed', text: '#26301f', accent: '#4f6e45' },
  },
  {
    id: 'cottage',
    name: 'Cozy Cottage',
    builtIn: true,
    // Warm wood surroundings, cream paper, chocolate ink and a terracotta accent.
    colors: { background: '#d9c2a7', panel: '#f2e4d2', page: '#fdf8f0', text: '#3b2a20', accent: '#a04e3a' },
  },
  {
    id: 'night',
    name: 'Night',
    builtIn: true,
    colors: { background: '#1b1c20', panel: '#24252b', page: '#202126', text: '#e6e3dc', accent: '#d9b26f' },
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

/** Expand the five base colours into every CSS token the app uses. */
export function themeTokens(c: ThemeColors): Record<string, string> {
  const dark = isDark(c);
  return {
    '--bg': c.background,
    '--surface': c.panel,
    '--surface-2': mix(c.panel, c.text, dark ? 0.08 : 0.05),
    '--line': mix(c.panel, c.text, dark ? 0.18 : 0.14),
    '--text': c.text,
    '--text-2': mix(c.text, c.panel, 0.28),
    '--muted': mix(c.text, c.panel, 0.48),
    '--accent': c.accent,
    '--accent-soft': mix(c.panel, c.accent, dark ? 0.22 : 0.16),
    '--on-accent': onColor(c.accent),
    '--focus': dark ? '#7fb0ea' : '#2f6db5',
    '--danger': dark ? '#e4836f' : '#a33b2b',
    '--warn': dark ? '#e0b04c' : '#8a6100',
    '--ok': dark ? '#7cc48a' : '#2f6b3a',
    '--err-line': dark ? '#e4836f' : '#c0392b',
    '--warn-line': dark ? '#e0b04c' : '#c58b00',
    '--style-line': dark ? '#7fb0ea' : '#4a7fb5',
    '--note-line': dark ? '#6fcf8f' : '#2e8b57',
    '--echo-line': dark ? '#4fd1d1' : '#12898f',
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
  root.dataset.theme = isDark(theme.colors) ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.colors.panel);
}

/** Validate a theme loaded from a file. Returns null if it isn't a usable theme. */
export function parseThemeFile(json: unknown): ThemeDef | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as { name?: unknown; colors?: Record<string, unknown> };
  const keys: (keyof ThemeColors)[] = ['background', 'panel', 'page', 'text', 'accent'];
  if (typeof o.name !== 'string' || !o.colors || !keys.every((k) => typeof o.colors![k] === 'string' && isHex(o.colors![k] as string))) return null;
  return {
    id: `custom-${crypto.getRandomValues(new Uint32Array(2)).join('')}`,
    name: o.name.slice(0, 40),
    colors: Object.fromEntries(keys.map((k) => [k, (o.colors![k] as string).toLowerCase()])) as unknown as ThemeColors,
  };
}
