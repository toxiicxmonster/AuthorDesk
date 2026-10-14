import type { CardType } from './schema';

export interface TemplateCard {
  title: string;
  summary?: string;
  type?: CardType;
  /** Where in the book this beat usually falls, as a share of the way through (0–1). */
  at?: number;
}

export interface BoardTemplate {
  id: string;
  name: string;
  description: string;
  lanes: { title: string; cards: TemplateCard[] }[];
}

const beat = (title: string, at: number, summary: string): TemplateCard => ({ title, at, summary, type: 'beat' });

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
      {
        title: 'Act I — Setup',
        cards: [
          beat('Opening image / status quo', 0.01, 'Who the protagonist is and what their world is like before the story changes it.'),
          beat('Inciting incident', 0.12, 'The event that disturbs the status quo and starts the story.'),
          beat('First plot point', 0.25, 'The protagonist commits; no going back.'),
        ],
      },
      {
        title: 'Act II — Confrontation',
        cards: [
          beat('Rising complications', 0.37, 'Obstacles grow; each attempt makes things harder.'),
          beat('Midpoint', 0.5, 'A reversal or revelation that changes the goal.'),
          beat('Second plot point / crisis', 0.75, 'The lowest point; everything seems lost and a hard choice is forced.'),
        ],
      },
      {
        title: 'Act III — Resolution',
        cards: [beat('Climax', 0.9, 'The final confrontation, where the central question is answered.'), beat('Resolution', 0.98, 'The new normal; what changed.')],
      },
    ],
  },
  {
    id: 'beat-sheet',
    name: 'Save the Cat (15 beats)',
    description: 'The fifteen-beat sheet popularised by Save the Cat, adapted for novels. Use only what helps.',
    lanes: [
      {
        title: 'Act One',
        cards: [
          beat('Opening image', 0.01, 'A snapshot of the hero’s life and flaws before the change.'),
          beat('Theme stated', 0.05, 'Someone hints at the lesson the hero will have to learn.'),
          beat('Setup', 0.08, 'The hero’s world, wants and what’s missing.'),
          beat('Catalyst', 0.1, 'The life-changing event that kicks off the story.'),
          beat('Debate', 0.15, 'The hero hesitates: should they go?'),
        ],
      },
      {
        title: 'Act Two A',
        cards: [
          beat('Break into two', 0.2, 'The hero chooses to act and enters a new world.'),
          beat('B story', 0.22, 'A new relationship that carries the theme.'),
          beat('Fun and games', 0.35, 'The promise of the premise: the story the reader came for.'),
          beat('Midpoint', 0.5, 'A false victory or false defeat; the stakes rise.'),
        ],
      },
      {
        title: 'Act Two B',
        cards: [
          beat('Bad guys close in', 0.62, 'Outside pressure grows and inner doubts return.'),
          beat('All is lost', 0.75, 'The lowest point; something or someone is lost.'),
          beat('Dark night of the soul', 0.78, 'The hero wallows, then finds the truth they needed.'),
        ],
      },
      {
        title: 'Act Three',
        cards: [
          beat('Break into three', 0.8, 'A new plan, fusing the A and B stories.'),
          beat('Finale', 0.9, 'The hero proves they’ve changed and sets things right.'),
          beat('Final image', 0.99, 'The opposite of the opening image: proof of change.'),
        ],
      },
    ],
  },
  {
    id: 'heros-journey',
    name: "Hero's Journey (12 stages)",
    description: 'Departure, initiation and return.',
    lanes: [
      {
        title: 'Departure',
        cards: [
          beat('Ordinary world', 0.03, 'The hero at home, before the adventure.'),
          beat('Call to adventure', 0.1, 'A problem or opportunity appears.'),
          beat('Refusal of the call', 0.15, 'Fear or duty holds the hero back.'),
          beat('Meeting the mentor', 0.2, 'Someone gives advice, a gift or courage.'),
          beat('Crossing the threshold', 0.25, 'The hero leaves the known world.'),
        ],
      },
      {
        title: 'Initiation',
        cards: [
          beat('Tests, allies, enemies', 0.38, 'The hero learns the new world’s rules.'),
          beat('Approach to the inmost cave', 0.5, 'Preparing for the greatest danger.'),
          beat('Ordeal', 0.6, 'A life-or-death crisis; the hero faces their greatest fear.'),
          beat('Reward', 0.7, 'The hero seizes what they came for.'),
        ],
      },
      {
        title: 'Return',
        cards: [
          beat('The road back', 0.77, 'Consequences follow the hero home.'),
          beat('Resurrection', 0.9, 'A final test where everything is at stake.'),
          beat('Return with the elixir', 0.98, 'The hero comes home changed, bringing something to share.'),
        ],
      },
    ],
  },
  {
    id: 'seven-point',
    name: 'Seven-point structure',
    description: 'Hook to resolution, built backwards from the ending (Dan Wells’s seven points).',
    lanes: [
      { title: 'Beginning', cards: [beat('Hook', 0.02, 'The starting state: the opposite of the resolution.'), beat('Plot turn 1', 0.15, 'Something changes and sets the story in motion.')] },
      {
        title: 'Middle',
        cards: [
          beat('Pinch point 1', 0.35, 'Pressure from the antagonist forces the hero to act.'),
          beat('Midpoint', 0.5, 'The hero moves from reacting to acting.'),
          beat('Pinch point 2', 0.62, 'More pressure: the plan fails, things look hopeless.'),
        ],
      },
      { title: 'End', cards: [beat('Plot turn 2', 0.75, 'The hero finds the last piece they need.'), beat('Resolution', 0.95, 'The climax, and the end state.')] },
    ],
  },
];

/** Where a beat card usually falls in a book, by its title in any built-in template; null for unknown cards. */
export function beatPosition(title: string): number | null {
  const t = title.trim().toLowerCase();
  for (const tpl of BUILTIN_TEMPLATES) for (const lane of tpl.lanes) for (const c of lane.cards) if (c.at !== undefined && c.title.toLowerCase() === t) return c.at;
  return null;
}
