import { useEffect, useState } from 'react';
import { updateSettings, useSettings } from '../../storage/settings';
import { BUILTIN_THEMES, allThemes, applyTheme, contrast, isHex, parseThemeFile, resolveTheme, themeTokens, type ThemeBackground, type ThemeColors, type ThemeDef } from '../theme';
import { Modal } from './common';
import { confirmDialog, toast } from '../store';
import { saveFile, fileSafe } from '../../importExport/download';
import { newId } from '../../domain/ids';

const COLOR_FIELDS: { key: keyof ThemeColors; label: string; hint: string }[] = [
  { key: 'background', label: 'Background', hint: 'Behind everything' },
  { key: 'panel', label: 'Panels', hint: 'Sidebars, toolbars, cards' },
  { key: 'page', label: 'Writing page', hint: 'Where your words go' },
  { key: 'text', label: 'Text', hint: 'All writing and labels' },
  { key: 'accent', label: 'Accent', hint: 'Buttons, links, highlights' },
];

/** A miniature of the app drawn in a theme's colours. */
function Swatch({ colors, background }: { colors: ThemeColors; background?: ThemeBackground | null }) {
  const t = themeTokens(colors);
  const picture = background?.image
    ? {
        backgroundImage: `linear-gradient(color-mix(in srgb, ${colors.background} ${background.fade}%, transparent), color-mix(in srgb, ${colors.background} ${background.fade}%, transparent)), url("${background.image.startsWith('data:') ? background.image : new URL(background.image, document.baseURI).href}")`,
        backgroundSize: background.mode === 'fit' ? '100% 100%, cover' : '100% 100%, 60px auto',
        backgroundPosition: 'center',
      }
    : {};
  return (
    <div className="swatch" style={{ background: colors.background, ...picture, borderColor: t['--line'] }} aria-hidden>
      <div className="sw-side" style={{ background: colors.panel, borderColor: t['--line'] }}>
        <i style={{ background: t['--accent-soft'] }} />
        <i style={{ background: t['--line'] }} />
        <i style={{ background: t['--line'] }} />
      </div>
      <div className="sw-page" style={{ background: colors.page, color: colors.text }}>
        <b>Aa</b>
        <i style={{ background: colors.text }} />
        <i style={{ background: colors.text, width: '70%' }} />
        <span style={{ background: colors.accent }} />
      </div>
    </div>
  );
}

export function ThemePicker() {
  const s = useSettings();
  const [editing, setEditing] = useState<{ theme: ThemeDef; isNew: boolean } | null>(null);
  const custom = s.customThemes as ThemeDef[];
  const prefersDark = typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;

  const choose = (id: string) => void updateSettings({ theme: id });
  const startNew = (from: ThemeDef) =>
    setEditing({ theme: { id: `custom-${newId()}`, name: `${from.name} (my version)`, colors: { ...from.colors }, background: from.background ?? null }, isNew: true });

  const cards: { id: string; name: string; colors: ThemeColors; background?: ThemeBackground | null; custom?: ThemeDef }[] = [
    { id: 'system', name: 'Match my device', colors: resolveTheme('system', custom, prefersDark).colors },
    ...BUILTIN_THEMES.map((t) => ({ id: t.id, name: t.name, colors: t.colors, background: t.background })),
    ...custom.map((t) => ({ id: t.id, name: t.name, colors: t.colors, background: t.background, custom: t })),
  ];

  return (
    <div className="theme-picker">
      <div className="theme-grid" role="radiogroup" aria-label="Theme">
        {cards.map((c) => (
          <div key={c.id} className={`theme-card${s.theme === c.id ? ' on' : ''}`}>
            <button role="radio" aria-checked={s.theme === c.id} className="theme-choose" onClick={() => choose(c.id)}>
              <Swatch colors={c.colors} background={c.background} />
              <span className="theme-name">
                {s.theme === c.id && '✓ '}
                {c.name}
              </span>
              {c.id === 'system' && <span className="muted small">Paper by day, Night when your device is dark</span>}
            </button>
            {c.custom && (
              <div className="theme-actions">
                <button className="small" onClick={() => setEditing({ theme: c.custom!, isNew: false })}>
                  Edit
                </button>
                <button
                  className="small"
                  onClick={() =>
                    void saveFile(
                      JSON.stringify({ name: c.custom!.name, colors: c.custom!.colors, ...(c.custom!.background ? { background: c.custom!.background } : {}) }, null, 2),
                      `${fileSafe(c.custom!.name)}.authortheme.json`,
                      'application/json',
                    )
                  }
                >
                  Share
                </button>
                <button
                  className="small danger-text"
                  onClick={async () => {
                    if (!(await confirmDialog(`Delete “${c.name}”?`, 'This removes the theme from this device.', { confirmLabel: 'Delete', danger: true }))) return;
                    await updateSettings({ customThemes: custom.filter((t) => t.id !== c.id), theme: s.theme === c.id ? 'system' : s.theme });
                  }}
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        ))}
        <div className="theme-card create">
          <button className="theme-choose" onClick={() => startNew(resolveTheme(s.theme, custom, prefersDark))}>
            <div className="swatch plus" aria-hidden>
              +
            </div>
            <span className="theme-name">Create a theme</span>
            <span className="muted small">Starts from the current one</span>
          </button>
        </div>
      </div>
      <label className="button small">
        Import a theme file…
        <input
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            // A theme with a background picture carries it inside the file.
            if (f.size > 12_000_000) return toast('That file is too large to be a theme.', { kind: 'error' });
            let parsed: ThemeDef | null;
            try {
              parsed = parseThemeFile(JSON.parse(await f.text()));
            } catch {
              parsed = null;
            }
            if (!parsed) return toast('That file isn’t an AuthorDesk theme.', { kind: 'error' });
            await updateSettings({ customThemes: [...custom, parsed], theme: parsed.id });
            toast(`Added “${parsed.name}”`);
          }}
        />
      </label>
      {editing && (
        <ThemeEditor
          initial={editing.theme}
          isNew={editing.isNew}
          onClose={() => setEditing(null)}
          onSave={async (t) => {
            const next = editing.isNew ? [...custom, t] : custom.map((x) => (x.id === t.id ? t : x));
            await updateSettings({ customThemes: next, theme: t.id });
            setEditing(null);
            toast(`Saved “${t.name}”`);
          }}
          onStartFrom={(from) => setEditing({ theme: { ...editing.theme, colors: { ...from.colors }, background: from.background ?? null }, isNew: editing.isNew })}
        />
      )}
    </div>
  );
}

function Readability({ label, a, b, min }: { label: string; a: string; b: string; min: number }) {
  const r = contrast(a, b);
  const ok = r >= min;
  return (
    <li className={ok ? 'ok-text' : 'warn-text'}>
      {ok ? '✓' : '⚠'} {label}: {ok ? 'easy to read' : 'may be hard to read'} <span className="muted small">({r.toFixed(1)}:1)</span>
    </li>
  );
}

function ThemeEditor({
  initial,
  isNew,
  onClose,
  onSave,
  onStartFrom,
}: {
  initial: ThemeDef;
  isNew: boolean;
  onClose: () => void;
  onSave: (t: ThemeDef) => void;
  onStartFrom: (t: ThemeDef) => void;
}) {
  const s = useSettings();
  const [name, setName] = useState(initial.name);
  const [colors, setColors] = useState<ThemeColors>(initial.colors);
  const [text, setText] = useState<ThemeColors>(initial.colors);
  const [background, setBackground] = useState<ThemeBackground | null>(initial.background ?? null);
  const [loading, setLoading] = useState(false);

  // Live preview on the whole app; restored when the editor closes.
  useEffect(() => {
    applyTheme({ id: 'preview', name, colors, background });
  }, [colors, name, background]);
  useEffect(() => setBackground(initial.background ?? null), [initial.background]);

  const choosePicture = async (file: File) => {
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return toast('Choose a picture: a JPEG, PNG, WebP or GIF.', { kind: 'error' });
    setLoading(true);
    try {
      const image = await pictureForTheme(file, background?.mode ?? 'fit');
      setBackground({ image, mode: background?.mode ?? 'fit', fade: background?.fade ?? 30 });
    } catch {
      toast('That picture could not be opened.', { kind: 'error' });
    } finally {
      setLoading(false);
    }
  };
  useEffect(
    () => () => applyTheme(resolveTheme(s.theme, s.customThemes as ThemeDef[], window.matchMedia('(prefers-color-scheme: dark)').matches)),
    // Restore only on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => setColors(initial.colors), [initial.colors]);
  useEffect(() => setText(initial.colors), [initial.colors]);

  const setColor = (k: keyof ThemeColors, v: string) => {
    setText((t) => ({ ...t, [k]: v }));
    const hex = v.startsWith('#') ? v : `#${v}`;
    if (isHex(hex)) setColors((c) => ({ ...c, [k]: hex.toLowerCase() }));
  };

  return (
    <Modal title={isNew ? 'Create a theme' : `Edit “${initial.name}”`} onClose={onClose} wide>
      <p className="muted small">Changes preview live across the whole app. Pick five colours; AuthorDesk works out the rest.</p>
      <label className="field">
        <span>Theme name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
      </label>
      <div className="row gap wrap">
        <span className="small muted">Start from:</span>
        {BUILTIN_THEMES.map((t) => (
          <button key={t.id} className="small" onClick={() => onStartFrom(t)}>
            {t.name}
          </button>
        ))}
      </div>
      <div className="theme-editor">
        <div className="color-fields">
          {COLOR_FIELDS.map((f) => (
            <div key={f.key} className="color-field">
              <input type="color" value={colors[f.key]} onChange={(e) => setColor(f.key, e.target.value)} aria-label={`${f.label} colour`} />
              <div className="grow">
                <strong>{f.label}</strong>
                <span className="muted small block">{f.hint}</span>
              </div>
              <input className="hex" value={text[f.key]} onChange={(e) => setColor(f.key, e.target.value.trim())} aria-label={`${f.label} hex code`} maxLength={7} />
            </div>
          ))}
        </div>
        <div>
          <Swatch colors={colors} background={background} />
          <ul className="plain small readability">
            <Readability label="Text on the page" a={colors.text} b={colors.page} min={7} />
            <Readability label="Text on panels" a={colors.text} b={colors.panel} min={4.5} />
            <Readability label="Accent on panels" a={colors.accent} b={colors.panel} min={3} />
          </ul>
        </div>
      </div>
      <fieldset className="field theme-bg">
        <legend>Background picture (optional)</legend>
        <p className="muted small">Shown behind everything, where the background colour would be. The writing page and panels stay plain so your words are easy to read.</p>
        <div className="row gap wrap">
          <label className="button small">
            {loading ? 'Opening…' : background ? 'Change picture…' : 'Choose a picture…'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void choosePicture(f);
              }}
            />
          </label>
          {background && (
            <button className="small" onClick={() => setBackground(null)}>
              Remove picture
            </button>
          )}
        </div>
        {background && (
          <>
            <div className="row gap wrap" role="radiogroup" aria-label="How the picture fills the background">
              <label className="check">
                <input type="radio" name="bg-mode" checked={background.mode === 'fit'} onChange={() => setBackground({ ...background, mode: 'fit' })} /> Fit to size
                <span className="muted small"> (one picture fills the window)</span>
              </label>
              <label className="check">
                <input type="radio" name="bg-mode" checked={background.mode === 'repeat'} onChange={() => setBackground({ ...background, mode: 'repeat' })} /> Repeat
                <span className="muted small"> (tiled, for patterns and textures)</span>
              </label>
            </div>
            <label className="field">
              <span>Soften the picture: {background.fade}%</span>
              <input type="range" min={0} max={90} step={5} value={background.fade} onChange={(e) => setBackground({ ...background, fade: Number(e.target.value) })} />
            </label>
          </>
        )}
      </fieldset>
      <div className="dialog-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!name.trim() || loading} onClick={() => onSave({ id: initial.id, name: name.trim() || 'My theme', colors, background })}>
          {isNew ? 'Save theme' : 'Save changes'}
        </button>
      </div>
    </Modal>
  );
}

/**
 * A chosen picture as a data: URL small enough to keep in the settings: up to 2400 pixels across for a fitted
 * picture, 1200 for a repeating tile (JPEG; PNG when it has see-through parts, so a pattern can show the colour).
 */
async function pictureForTheme(file: File, mode: ThemeBackground['mode']): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const max = mode === 'fit' ? 2400 : 1200;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const png = file.type === 'image/png' || file.type === 'image/gif';
  const seeThrough = png && ctx.getImageData(0, 0, canvas.width, canvas.height).data.some((v, i) => i % 4 === 3 && v < 250);
  return seeThrough ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.85);
}

export { allThemes };
