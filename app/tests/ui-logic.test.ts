import { BUILTIN_THEMES, contrast, exportThemeFile, themeTokens, parseThemeFile, resolveTheme, mix, onColor } from '../src/ui/theme';
import { matchScore } from '../src/ui/components/QuickSwitcher';
import { resetDbForTests, db } from '../src/storage/db';
import { createSampleProject } from '../src/storage/sample';

describe('themes', () => {
  it('ships three readable built-in themes', () => {
    expect(BUILTIN_THEMES.map((t) => t.name)).toEqual(['Paper', 'Writing Desk', 'Sepia', 'Sage', 'Medieval', 'Storybook', 'Wild West', 'Christmas', 'Romance', 'Fantasy', 'Mystery', 'Spooky', 'Starship', 'Night']);
    for (const t of BUILTIN_THEMES) {
      expect(contrast(t.colors.text, t.colors.page)).toBeGreaterThanOrEqual(7);
      expect(contrast(t.colors.text, t.colors.panel)).toBeGreaterThanOrEqual(4.5);
      const tokens = themeTokens(t.colors);
      expect(contrast(tokens['--on-accent'], t.colors.accent)).toBeGreaterThanOrEqual(3);
    }
  });
  it('derives dark-mode tokens for dark themes', () => {
    expect(themeTokens(BUILTIN_THEMES.find((t) => t.id === 'night')!.colors)['color-scheme']).toBe('dark');
    expect(themeTokens(BUILTIN_THEMES[0].colors)['color-scheme']).toBe('light');
  });
  it('resolves system, legacy and custom theme settings', () => {
    const custom = [{ id: 'custom-1', name: 'Mine', colors: { ...BUILTIN_THEMES[0].colors, accent: '#123456' } }];
    expect(resolveTheme('system', custom, true).id).toBe('night');
    expect(resolveTheme('system', custom, false).id).toBe('paper');
    expect(resolveTheme('dark', custom, false).id).toBe('night');
    expect(resolveTheme('custom-1', custom, false).name).toBe('Mine');
    expect(resolveTheme('deleted-theme', custom, false).id).toBe('paper');
  });
  it('validates imported theme files', () => {
    expect(parseThemeFile({ name: 'Ocean', colors: { background: '#001122', panel: '#112233', page: '#223344', text: '#EEEEEE', accent: '#33AAFF' } })?.colors.text).toBe('#eeeeee');
    expect(parseThemeFile({ name: 'Bad', colors: { background: 'red' } })).toBeNull();
    // A background picture travels inside the theme file; a link to a website is not taken.
    const colors = { background: '#001122', panel: '#112233', page: '#223344', text: '#eeeeee', accent: '#33aaff' };
    expect(parseThemeFile({ name: 'Stone', colors, background: { image: 'data:image/png;base64,iVBORw0KGgo=', mode: 'fit', fade: 40 } })?.background).toEqual({
      image: 'data:image/png;base64,iVBORw0KGgo=',
      mode: 'fit',
      fade: 40,
    });
    expect(parseThemeFile({ name: 'Web', colors, background: { image: 'https://example.com/a.png', mode: 'fit', fade: 40 } })?.background).toBeNull();
    expect(parseThemeFile({ name: 'Odd', colors, background: { image: './themes/lace.svg', mode: 'sideways', fade: 400 } })?.background).toEqual({ image: './themes/lace.svg', mode: 'repeat', fade: 30 });
  });

  it('exports a theme as one file with its picture inside, which imports back the same', async () => {
    const mine = { ...BUILTIN_THEMES.find((t) => t.id === 'velvet')!, id: 'custom-1', name: 'Romance (my version)', builtIn: undefined };
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    const file = await exportThemeFile(mine, async (url) => {
      expect(url).toBe('./themes/lace.svg');
      return new Blob([svg], { type: 'image/svg+xml' });
    });
    const json = JSON.parse(file);
    expect(json).toMatchObject({ format: 'authordesk-theme', version: 1, name: 'Romance (my version)', colors: mine.colors, background: { mode: 'repeat', fade: 20 } });
    expect(json.background.image).toBe(`data:image/svg+xml;base64,${btoa(svg)}`);
    const back = parseThemeFile(json)!;
    expect(back.name).toBe('Romance (my version)');
    expect(back.colors).toEqual(mine.colors);
    expect(back.background).toEqual(json.background);
    expect(back.id).not.toBe('custom-1'); // a new theme on the friend's computer
    expect(parseThemeFile('nope')).toBeNull();
  });
  it('mixes colours and picks readable text on accents', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(onColor('#ffff00')).toBe('#1a1a1a');
    expect(onColor('#202060')).toBe('#ffffff');
  });
});

describe('quick switcher matching', () => {
  it('ranks prefix over word-start over substring over loose letters', () => {
    const p = matchScore('Chapter 12', 'chap');
    const w = matchScore('The Harbourmaster', 'harb');
    const s = matchScore('Shipwreck', 'wreck');
    const l = matchScore('Elara Voss', 'evs');
    expect(p).toBeGreaterThan(w);
    expect(w).toBeGreaterThan(s);
    expect(s).toBeGreaterThan(l);
    expect(l).toBeGreaterThan(0);
    expect(matchScore('Elara', 'xyz')).toBe(0);
  });
  it('ignores punctuation and matches every typed word', () => {
    const labels = ['Theme: Sepia', 'Theme: Sage', 'Theme: Pastel Blue', 'Message in the lens'];
    const best = (q: string) => labels.slice().sort((a, b) => matchScore(b, q) - matchScore(a, q))[0];
    expect(best('theme sage')).toBe('Theme: Sage');
    expect(best('pastel')).toBe('Theme: Pastel Blue');
    expect(matchScore('Theme: Sage', 'sage theme')).toBeGreaterThan(matchScore('Theme: Sepia', 'sage theme'));
  });
});

describe('sample project', () => {
  it('creates a complete, linked sample book', async () => {
    resetDbForTests();
    const { projectId, firstSceneId } = await createSampleProject();
    const scene = await db.scenes.get(firstSceneId);
    expect(scene?.wordCount).toBeGreaterThan(50);
    expect(scene?.referenceIds.length).toBe(2);
    expect(await db.chapters.where('projectId').equals(projectId).count()).toBe(3);
    expect(await db.references.where('projectId').equals(projectId).count()).toBe(4);
    expect(await db.boardCards.where('projectId').equals(projectId).count()).toBe(4);
    expect(await db.timelineEvents.where('projectId').equals(projectId).count()).toBe(2);
  });
});

describe('theme readability', () => {
  it('keeps muted and secondary text readable on every background, in every built-in theme', async () => {
    const { BUILTIN_THEMES, contrast, themeTokens } = await import('../src/ui/theme');
    for (const t of BUILTIN_THEMES) {
      const k = themeTokens(t.colors);
      for (const bg of ['--bg', '--surface', '--surface-2', '--page']) {
        expect(contrast(k['--muted'], k[bg]), `${t.id} muted on ${bg}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(k['--text-2'], k[bg]), `${t.id} text-2 on ${bg}`).toBeGreaterThanOrEqual(5.5);
      }
    }
  });
});
