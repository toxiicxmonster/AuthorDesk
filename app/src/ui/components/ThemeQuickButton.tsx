import { updateSettings, useSettings } from '../../storage/settings';
import { BUILTIN_THEMES } from '../theme';
import { Menu } from './Menu';
import { Icon } from './Icon';
import { href, useRoute } from '../router';

/** One-click theme switching from the top bar. */
export function ThemeQuickButton() {
  const s = useSettings();
  const route = useRoute();
  const themes = [{ id: 'system', name: 'Match my device' }, ...BUILTIN_THEMES, ...s.customThemes];
  return (
    <Menu
      label="Change theme"
      items={[
        ...themes.map((t) => ({ label: `${s.theme === t.id ? '✓ ' : ' '}${t.name}`, run: () => void updateSettings({ theme: t.id }) })),
        { label: 'Create or edit themes…', run: () => (location.hash = route.projectId ? href(route.projectId, 'settings') : '#/settings') },
      ]}
    >
      <Icon name="theme" />
    </Menu>
  );
}
