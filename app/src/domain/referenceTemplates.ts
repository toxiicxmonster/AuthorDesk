import type { ReferenceType } from './schema';

export interface FieldDef {
  key: string;
  label: string;
  multiline?: boolean;
}

export const REFERENCE_TYPE_LABELS: Record<ReferenceType, string> = {
  character: 'Character',
  location: 'Location',
  faction: 'Faction / Family',
  species: 'Species / Culture',
  item: 'Item / Tech / Magic',
  lore: 'Event / Lore',
  glossary: 'Glossary / Rule',
  research: 'Research',
};

export const REFERENCE_TYPE_ICONS: Record<ReferenceType, string> = {
  character: '👤',
  location: '📍',
  faction: '⚑',
  species: '🧬',
  item: '🗝',
  lore: '📜',
  glossary: '📖',
  research: '🔎',
};

const ml = (key: string, label: string): FieldDef => ({ key, label, multiline: true });
const sl = (key: string, label: string): FieldDef => ({ key, label });

export const REFERENCE_TEMPLATES: Record<ReferenceType, FieldDef[]> = {
  character: [
    sl('role', 'Role (protagonist, antagonist, supporting, minor…)'),
    ml('appearance', 'Physical appearance'),
    ml('personality', 'Personality and temperament'),
    ml('goals', 'Goals and motivations'),
    ml('fears', 'Fears and secrets'),
    ml('strengths', 'Strengths and skills'),
    ml('flaws', 'Flaws and limitations'),
    ml('backstory', 'Backstory'),
    ml('arc', 'Character arc'),
    ml('voice', 'Voice / dialogue notes'),
    sl('firstAppearance', 'First appearance'),
    sl('lastAppearance', 'Last known appearance'),
  ],
  location: [
    sl('region', 'Region / parent location'),
    ml('description', 'Description'),
    ml('sensory', 'Sights, sounds, smells'),
    ml('history', 'History'),
    ml('inhabitants', 'Inhabitants'),
  ],
  faction: [
    ml('purpose', 'Purpose / beliefs'),
    ml('structure', 'Leadership and structure'),
    ml('members', 'Notable members'),
    ml('allies', 'Allies and enemies'),
    ml('history', 'History'),
  ],
  species: [ml('traits', 'Traits'), ml('culture', 'Culture and customs'), sl('homeland', 'Homeland')],
  item: [
    sl('owner', 'Current owner'),
    ml('description', 'Description'),
    ml('powers', 'Powers / function'),
    ml('rules', 'Rules and costs'),
    ml('history', 'History'),
  ],
  lore: [sl('when', 'When'), ml('whatHappened', 'What happened'), ml('consequences', 'Consequences')],
  glossary: [ml('definition', 'Definition'), sl('usage', 'Usage example')],
  research: [sl('source', 'Source / URL'), sl('citation', 'Citation'), ml('findings', 'Findings')],
};

/** Plain-language descriptions for the "what would you like to add?" chooser. */
export const REFERENCE_TYPE_HINTS: Record<ReferenceType, string> = {
  character: 'A person (or creature) in your story',
  location: 'A city, house, room, planet…',
  faction: 'A family, guild, army, company',
  species: 'A people, race or culture',
  item: 'An object, weapon, technology or magic',
  lore: 'Something that happened, history, legend',
  glossary: 'An invented word, rule or term',
  research: 'Real-world facts and sources',
};
