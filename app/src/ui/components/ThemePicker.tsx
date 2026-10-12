import { useEffect, useState } from 'react';
import { updateSettings, useSettings } from '../../storage/settings';
import { BUILTIN_THEMES, allThemes, applyTheme, contrast, isHex, parseThemeFile, resolveTheme, themeTokens, type ThemeColors, type ThemeDef } from '../theme';
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
function Swatch({ colors }: { colors: ThemeColors }) {
  const t = themeTokens(colors);
  return (
    <div className="swatch" style={{ background: colors.background, borderColor: t['--line'] }} aria-hidden>
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
    setEditing({ theme: { id: `custom-${newId()}`, name: `${from.name} (my version)`, colors: { ...from.colors } }, isNew: true });

  const cards: { id: string; name: string; colors: ThemeColors; custom?: ThemeDef }[] = [
    { id: 'system', name: 'Match my device', colors: resolveTheme('system', custom, prefersDark).colors },
    ...BUILTIN_THEMES.map((t) => ({ id: t.id, name: t.name, colors: t.colors })),
    ...custom.map((t) => ({ id: t.id, name: t.name, colors: t.colors, custom: t })),
  ];

  return (
    <div className="theme-picker">
      <div className="theme-grid" role="radiogroup" aria-label="Theme">
        {cards.map((c) => (
          <div key={c.id} className={`theme-card${s.theme === c.id ? ' on' : ''}`}>
            <button role="radio" aria-checked={s.theme === c.id} className="theme-choose" onClick={() => choose(c.id)}>
              <Swatch colors={c.colors} />
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
                  onClick={() => void saveFile(JSON.stringify({ name: c.custom!.name, colors: c.custom!.colors }, null, 2), `${fileSafe(c.custom!.name)}.authortheme.json`, 'application/json')}
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
            if (f.size > 20_000) return toast('That file is too large to be a theme.', { kind: 'error' });
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
          onStartFrom={(from) => setEditing({ theme: { ...editing.theme, colors: { ...from.colors } }, isNew: editing.isNew })}
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

  // Live preview on the whole app; restored when the editor closes.
  useEffect(() => {
    applyTheme({ id: 'preview', name, colors });
  }, [colors, name]);
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
          <Swatch colors={colors} />
          <ul className="plain small readability">
            <Readability label="Text on the page" a={colors.text} b={colors.page} min={7} />
            <Readability label="Text on panels" a={colors.text} b={colors.panel} min={4.5} />
            <Readability label="Accent on panels" a={colors.accent} b={colors.panel} min={3} />
          </ul>
        </div>
      </div>
      <div className="dialog-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!name.trim()} onClick={() => onSave({ id: initial.id, name: name.trim() || 'My theme', colors })}>
          {isNew ? 'Save theme' : 'Save changes'}
        </button>
      </div>
    </Modal>
  );
}

export { allThemes };
