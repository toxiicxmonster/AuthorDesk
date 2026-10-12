import { db } from './db';
import { createChapter, createProject, createRecord, createCard, updateRecord, createScene } from './repo';
import { createReference } from '../domain/references';
import type { DocJson } from '../domain/schema';

const p = (...parts: (string | { text: string; ref: string })[]) => ({
  type: 'paragraph',
  content: parts.map((x) => (typeof x === 'string' ? { type: 'text', text: x } : { type: 'text', text: x.text, marks: [{ type: 'refLink', attrs: { refId: x.ref } }] })),
});

/** A small original sample book so new users can explore every feature with real-looking content. */
export async function createSampleProject(): Promise<{ projectId: string; firstSceneId: string }> {
  const { project, book } = await createProject('The Salt Lamp (sample)', { bookTitle: 'The Salt Lamp' });
  const pid = project.id;

  const mara = await createReference(pid, 'character', 'Mara Quill', {
    aliases: ['Mara', 'the keeper’s girl'],
    summary: 'Seventeen, stubborn, keeps the lighthouse running since her father vanished.',
    fields: { role: 'Protagonist', appearance: 'Salt-stiff braid, ink on her fingers.', goals: 'Find out what happened to her father.', flaws: 'Trusts no one, including herself.' },
    favorite: true,
  });
  const tobias = await createReference(pid, 'character', 'Tobias Wren', {
    aliases: ['Tobias'],
    summary: 'The harbourmaster. Kind, until it costs him something.',
    fields: { role: 'Supporting', voice: 'Speaks in weather proverbs.' },
  });
  const lighthouse = await createReference(pid, 'location', 'Gull Point Light', {
    summary: 'A lighthouse on a spit of black rock, two hundred and twelve steps to the lamp.',
    fields: { sensory: 'Kerosene, wet stone, the lamp’s slow tick.' },
  });
  const harbour = await createReference(pid, 'location', 'Saltmouth Harbour', { summary: 'A fishing town that pretends not to see the lighthouse.' });
  await updateRecord('references', mara.id, { links: [{ targetId: lighthouse.id, label: 'lives here' }, { targetId: tobias.id, label: 'distrusts' }] });
  await createRecord('dictionary', pid, { word: 'Saltmouth' });

  const thread = await createRecord('plotThreads', pid, {
    name: 'Where is Father?',
    description: 'Mara’s father disappeared during the winter storm.',
    stakes: 'If Mara can’t prove he was taken, the town will close the light.',
    keyCharacterIds: [mara.id],
    status: 'open',
    resolution: '',
  });

  // Chapter 1 (created with the project)
  const ch1 = (await db.chapters.where('bookId').equals(book.id).first())!;
  await updateRecord('chapters', ch1.id, { title: 'The Lamp', summary: 'Mara keeps the light alone and finds a message in the lens.' });
  const s1 = (await db.scenes.where('chapterId').equals(ch1.id).first())!;
  const doc1: DocJson = {
    type: 'doc',
    content: [
      p({ text: 'Mara', ref: mara.id }, ' climbed the two hundred and twelve steps the way her father had taught her: counting out loud, so the dark would know she was not afraid of it.'),
      p('At the top, the lamp ticked like a patient clock. She trimmed the wick, wiped the salt from the glass, and that was when she saw the letters scratched into the lens.'),
      p('Not here. Look below.'),
      { type: 'horizontalRule' },
      p('By morning she had decided not to tell ', { text: 'Tobias', ref: tobias.id }, '. Which was why, of course, he was the first person waiting at the bottom of the stairs.'),
    ],
  };
  await db.scenes.delete(s1.id);
  await createScene(pid, ch1.id, 'Counting the steps', doc1, { id: s1.id } as never);
  await updateRecord('scenes', s1.id, { title: 'Counting the steps', povCharacterId: mara.id, locationId: lighthouse.id, plotThreadIds: [thread.id], timeMarker: 'Day 1, night', status: 'written', summary: 'Mara finds the scratched message.' });

  const ch2 = await createChapter(pid, book.id, 'The Harbourmaster', { withScene: false });
  await updateRecord('chapters', ch2.id, { summary: 'Tobias offers help that sounds like a warning.' });
  const s2 = await createScene(pid, ch2.id, 'Fog on the quay', {
    type: 'doc',
    content: [
      p('“Fog’s a liar,” ', { text: 'Tobias', ref: tobias.id }, ' said. “Makes near things far and far things near.” He did not look at the lighthouse when he said it.'),
      p('Mara kept her hands in her pockets, where he couldn’t see them shaking.'),
    ],
  });
  await updateRecord('scenes', s2.id, { povCharacterId: mara.id, locationId: harbour.id, plotThreadIds: [thread.id], timeMarker: 'Day 2, dawn', status: 'drafting' });

  const ch3 = await createChapter(pid, book.id, 'Below', { withScene: false });
  await createScene(pid, ch3.id, 'Scene 1', { type: 'doc', content: [p('(Your turn — what does Mara find below the lighthouse?)')] });

  // Board
  const lanes = (await db.boardLanes.where('bookId').equals(book.id).toArray()).sort((a, b) => a.order - b.order);
  await createCard(pid, book.id, lanes[0].id, { title: 'Message in the lens', summary: 'The inciting discovery.', type: 'beat', status: 'written', chapterId: ch1.id, sceneId: s1.id, povCharacterId: mara.id, plotThreadIds: [thread.id] });
  await createCard(pid, book.id, lanes[0].id, { title: 'Tobias warns her off', type: 'scene', status: 'drafting', chapterId: ch2.id, sceneId: s2.id, povCharacterId: mara.id });
  await createCard(pid, book.id, lanes[1].id, { title: 'The tunnel under the rock', summary: 'Smugglers’ passage — father’s boots in the silt?', type: 'idea', status: 'idea' });
  await createCard(pid, book.id, lanes[2].id, { title: 'Who scratched the message?', type: 'question', status: 'idea', tags: ['mystery'] });

  // Timeline
  await createRecord('timelineEvents', pid, { bookId: book.id, title: 'Father disappears in the storm', when: 'Midwinter, a year ago', sortKey: 0, description: '', characterIds: [], locationId: lighthouse.id, chapterId: null, sceneId: null, plotThreadIds: [thread.id] });
  await createRecord('timelineEvents', pid, { bookId: book.id, title: 'Mara finds the message', when: 'Day 1', sortKey: 10, description: '', characterIds: [mara.id], locationId: lighthouse.id, chapterId: ch1.id, sceneId: s1.id, plotThreadIds: [thread.id] });

  await createRecord('notes', pid, {
    title: 'How lighthouse lamps worked',
    body: 'Fresnel lenses focused a small flame into a beam visible for miles. Keepers trimmed wicks through the night — “wickies”.',
    url: '',
    tags: ['research'],
    referenceIds: [lighthouse.id],
  });

  return { projectId: pid, firstSceneId: s1.id };
}
