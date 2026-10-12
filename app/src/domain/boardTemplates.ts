import type { CardType } from './schema';

export interface BoardTemplate {
  id: string;
  name: string;
  description: string;
  lanes: { title: string; cards: { title: string; summary?: string; type?: CardType }[] }[];
}

/** Optional starter structures. All are editable after applying; none is required. */
export const BUILTIN_TEMPLATES: BoardTemplate[] = [
  {
    id: 'blank',
    name: 'Blank outline',
    description: 'Three empty lanes.',
    lanes: [{ title: 'Beginning', cards: [] }, { title: 'Middle', cards: [] }, { title: 'End', cards: [] }],
  },
  {
    id: 'three-act',
    name: 'Three-act structure',
    description: 'Setup, confrontation, resolution with key turning points.',
    lanes: [
      { title: 'Act I — Setup', cards: [{ title: 'Opening image / status quo', type: 'beat' }, { title: 'Inciting incident', type: 'beat' }, { title: 'First plot point', type: 'beat', summary: 'The protagonist commits; no going back.' }] },
      { title: 'Act II — Confrontation', cards: [{ title: 'Rising complications', type: 'beat' }, { title: 'Midpoint', type: 'beat', summary: 'A reversal or revelation that changes the goal.' }, { title: 'Second plot point / crisis', type: 'beat' }] },
      { title: 'Act III — Resolution', cards: [{ title: 'Climax', type: 'beat' }, { title: 'Resolution', type: 'beat' }] },
    ],
  },
  {
    id: 'beat-sheet',
    name: 'Fifteen-beat sheet',
    description: 'A popular screenwriting-style beat sheet (Save the Cat–style). Use only what helps.',
    lanes: [
      { title: 'Act One', cards: ['Opening image', 'Theme stated', 'Setup', 'Catalyst', 'Debate'].map((t) => ({ title: t, type: 'beat' as const })) },
      { title: 'Act Two A', cards: ['Break into two', 'B story', 'Fun and games', 'Midpoint'].map((t) => ({ title: t, type: 'beat' as const })) },
      { title: 'Act Two B', cards: ['Bad guys close in', 'All is lost', 'Dark night of the soul'].map((t) => ({ title: t, type: 'beat' as const })) },
      { title: 'Act Three', cards: ['Break into three', 'Finale', 'Final image'].map((t) => ({ title: t, type: 'beat' as const })) },
    ],
  },
  {
    id: 'heros-journey',
    name: "Hero's Journey",
    description: 'Departure, initiation and return.',
    lanes: [
      { title: 'Departure', cards: ['Ordinary world', 'Call to adventure', 'Refusal of the call', 'Meeting the mentor', 'Crossing the threshold'].map((t) => ({ title: t, type: 'beat' as const })) },
      { title: 'Initiation', cards: ['Tests, allies, enemies', 'Approach to the inmost cave', 'Ordeal', 'Reward'].map((t) => ({ title: t, type: 'beat' as const })) },
      { title: 'Return', cards: ['The road back', 'Resurrection', 'Return with the elixir'].map((t) => ({ title: t, type: 'beat' as const })) },
    ],
  },
];
