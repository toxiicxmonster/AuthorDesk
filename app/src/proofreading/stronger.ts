/**
 * Stronger single words for weak verb + adverb pairs ("ran quickly" → "sprinted") and intensifier + adjective pairs
 * ("very tired" → "exhausted"): the craft advice behind "cut the adverb", with something concrete to write instead.
 * Verbs are listed in every form so the replacement keeps the tense: [base, past, -ing, -s].
 */

type Forms = [string, string, string, string];

const v = (s: string): Forms => s.split(' ') as Forms;

/** [verb forms, adverbs that soften it, stronger verbs (same order of forms)] */
const VERB_ADVERB: [Forms, string[], Forms[]][] = [
  [v('run ran running runs'), ['quickly', 'fast', 'rapidly', 'hastily', 'hurriedly'], [v('sprint sprinted sprinting sprints'), v('race raced racing races'), v('dash dashed dashing dashes')]],
  [v('walk walked walking walks'), ['slowly', 'leisurely', 'casually'], [v('amble ambled ambling ambles'), v('stroll strolled strolling strolls'), v('saunter sauntered sauntering saunters')]],
  [v('walk walked walking walks'), ['quickly', 'fast', 'briskly', 'hurriedly'], [v('stride strode striding strides'), v('hurry hurried hurrying hurries'), v('march marched marching marches')]],
  [v('walk walked walking walks'), ['heavily', 'wearily', 'tiredly'], [v('trudge trudged trudging trudges'), v('plod plodded plodding plods'), v('lumber lumbered lumbering lumbers')]],
  [v('walk walked walking walks'), ['quietly', 'silently', 'softly', 'stealthily'], [v('creep crept creeping creeps'), v('tiptoe tiptoed tiptoeing tiptoes'), v('sneak snuck sneaking sneaks')]],
  [v('walk walked walking walks'), ['proudly', 'confidently', 'arrogantly'], [v('strut strutted strutting struts'), v('swagger swaggered swaggering swaggers'), v('stride strode striding strides')]],
  [v('say said saying says'), ['quietly', 'softly', 'gently'], [v('murmur murmured murmuring murmurs'), v('whisper whispered whispering whispers')]],
  [v('say said saying says'), ['loudly'], [v('shout shouted shouting shouts'), v('call called calling calls'), v('bellow bellowed bellowing bellows')]],
  [v('say said saying says'), ['angrily', 'sharply', 'harshly', 'furiously'], [v('snap snapped snapping snaps'), v('snarl snarled snarling snarls'), v('growl growled growling growls')]],
  [v('say said saying says'), ['sadly', 'miserably'], [v('sigh sighed sighing sighs'), v('lament lamented lamenting laments')]],
  [v('say said saying says'), ['happily', 'cheerfully', 'brightly'], [v('chirp chirped chirping chirps'), v('beam beamed beaming beams')]],
  [v('say said saying says'), ['nervously', 'hesitantly', 'uncertainly'], [v('stammer stammered stammering stammers'), v('falter faltered faltering falters'), v('stutter stuttered stuttering stutters')]],
  [v('say said saying says'), ['quickly', 'hastily', 'hurriedly'], [v('blurt blurted blurting blurts')]],
  [v('say said saying says'), ['mockingly', 'sarcastically', 'scornfully'], [v('sneer sneered sneering sneers'), v('scoff scoffed scoffing scoffs')]],
  [v('say said saying says'), ['indistinctly', 'grumpily', 'irritably'], [v('mutter muttered muttering mutters'), v('grumble grumbled grumbling grumbles'), v('mumble mumbled mumbling mumbles')]],
  [v('look looked looking looks'), ['angrily', 'furiously', 'fiercely'], [v('glare glared glaring glares'), v('scowl scowled scowling scowls')]],
  [v('look looked looking looks'), ['quickly', 'briefly'], [v('glance glanced glancing glances'), v('peek peeked peeking peeks')]],
  [v('look looked looking looks'), ['closely', 'carefully', 'intently'], [v('study studied studying studies'), v('scrutinize scrutinized scrutinizing scrutinizes'), v('peer peered peering peers')]],
  [v('look looked looking looks'), ['longingly', 'dreamily'], [v('gaze gazed gazing gazes')]],
  [v('eat ate eating eats'), ['quickly', 'hungrily', 'greedily', 'fast'], [v('devour devoured devouring devours'), v('gobble gobbled gobbling gobbles'), v('wolf wolfed wolfing wolfs')]],
  [v('eat ate eating eats'), ['slowly', 'delicately'], [v('nibble nibbled nibbling nibbles'), v('pick picked picking picks')]],
  [v('drink drank drinking drinks'), ['quickly', 'greedily', 'fast'], [v('gulp gulped gulping gulps'), v('guzzle guzzled guzzling guzzles')]],
  [v('drink drank drinking drinks'), ['slowly', 'delicately'], [v('sip sipped sipping sips')]],
  [v('close closed closing closes'), ['loudly', 'hard', 'forcefully', 'angrily'], [v('slam slammed slamming slams')]],
  [v('shut shut shutting shuts'), ['loudly', 'hard', 'forcefully', 'angrily'], [v('slam slammed slamming slams')]],
  [v('hit hit hitting hits'), ['hard', 'forcefully', 'violently'], [v('smash smashed smashing smashes'), v('slam slammed slamming slams'), v('pound pounded pounding pounds')]],
  [v('hold held holding holds'), ['tightly', 'firmly'], [v('clutch clutched clutching clutches'), v('grip gripped gripping grips'), v('clench clenched clenching clenches')]],
  [v('cry cried crying cries'), ['loudly', 'hard', 'uncontrollably'], [v('sob sobbed sobbing sobs'), v('wail wailed wailing wails'), v('bawl bawled bawling bawls')]],
  [v('cry cried crying cries'), ['quietly', 'softly'], [v('weep wept weeping weeps'), v('sniffle sniffled sniffling sniffles')]],
  [v('laugh laughed laughing laughs'), ['quietly', 'softly'], [v('chuckle chuckled chuckling chuckles'), v('titter tittered tittering titters')]],
  [v('laugh laughed laughing laughs'), ['loudly', 'hard', 'uncontrollably'], [v('roar roared roaring roars'), v('howl howled howling howls'), v('guffaw guffawed guffawing guffaws')]],
  [v('smile smiled smiling smiles'), ['widely', 'broadly', 'happily'], [v('grin grinned grinning grins'), v('beam beamed beaming beams')]],
  [v('smile smiled smiling smiles'), ['smugly', 'slyly', 'mockingly'], [v('smirk smirked smirking smirks')]],
  [v('breathe breathed breathing breathes'), ['heavily', 'hard', 'quickly'], [v('pant panted panting pants'), v('gasp gasped gasping gasps'), v('wheeze wheezed wheezing wheezes')]],
  [v('move moved moving moves'), ['quickly', 'fast', 'swiftly'], [v('dart darted darting darts'), v('rush rushed rushing rushes'), v('zip zipped zipping zips')]],
  [v('move moved moving moves'), ['slowly', 'carefully'], [v('inch inched inching inches'), v('edge edged edging edges'), v('creep crept creeping creeps')]],
  [v('go went going goes'), ['quickly', 'fast', 'hurriedly'], [v('hurry hurried hurrying hurries'), v('rush rushed rushing rushes'), v('hasten hastened hastening hastens')]],
  [v('throw threw throwing throws'), ['hard', 'forcefully', 'violently'], [v('hurl hurled hurling hurls'), v('fling flung flinging flings'), v('launch launched launching launches')]],
  [v('pull pulled pulling pulls'), ['hard', 'forcefully', 'suddenly', 'sharply'], [v('yank yanked yanking yanks'), v('wrench wrenched wrenching wrenches'), v('jerk jerked jerking jerks')]],
  [v('push pushed pushing pushes'), ['hard', 'forcefully', 'roughly'], [v('shove shoved shoving shoves'), v('thrust thrust thrusting thrusts'), v('ram rammed ramming rams')]],
  [v('touch touched touching touches'), ['gently', 'lightly', 'softly'], [v('brush brushed brushing brushes'), v('graze grazed grazing grazes'), v('stroke stroked stroking strokes')]],
  [v('shake shook shaking shakes'), ['violently', 'uncontrollably', 'badly'], [v('tremble trembled trembling trembles'), v('shudder shuddered shuddering shudders'), v('quake quaked quaking quakes')]],
  [v('sleep slept sleeping sleeps'), ['lightly', 'briefly'], [v('doze dozed dozing dozes'), v('nap napped napping naps')]],
  [v('write wrote writing writes'), ['quickly', 'hastily', 'hurriedly'], [v('scribble scribbled scribbling scribbles'), v('scrawl scrawled scrawling scrawls'), v('jot jotted jotting jots')]],
  [v('ask asked asking asks'), ['angrily', 'sharply'], [v('demand demanded demanding demands')]],
  [v('ask asked asking asks'), ['quietly', 'softly'], [v('murmur murmured murmuring murmurs')]],
  [v('fall fell falling falls'), ['suddenly', 'heavily', 'hard'], [v('plunge plunged plunging plunges'), v('collapse collapsed collapsing collapses'), v('crash crashed crashing crashes')]],
  [v('sit sat sitting sits'), ['heavily', 'wearily'], [v('slump slumped slumping slumps'), v('flop flopped flopping flops'), v('sink sank sinking sinks')]],
  [v('want wanted wanting wants'), ['badly', 'desperately', 'really'], [v('crave craved craving craves'), v('long longed longing longs'), v('yearn yearned yearning yearns')]],
  [v('like liked liking likes'), ['really', 'truly'], [v('love loved loving loves'), v('adore adored adoring adores'), v('relish relished relishing relishes')]],
  [v('dislike disliked disliking dislikes'), ['strongly', 'intensely', 'really'], [v('loathe loathed loathing loathes'), v('detest detested detesting detests'), v('despise despised despising despises')]],
  [v('try tried trying tries'), ['hard', 'desperately'], [v('strive strove striving strives'), v('struggle struggled struggling struggles'), v('strain strained straining strains')]],
];

/** [adjective, stronger single words]; triggered by very/really/so/extremely/incredibly/terribly/quite. */
const INTENSIFIED: Record<string, string[]> = {
  tired: ['exhausted', 'drained', 'weary'],
  big: ['huge', 'enormous', 'massive'],
  large: ['huge', 'vast', 'massive'],
  small: ['tiny', 'minute', 'minuscule'],
  little: ['tiny', 'minuscule'],
  happy: ['elated', 'thrilled', 'overjoyed'],
  sad: ['miserable', 'heartbroken', 'devastated'],
  angry: ['furious', 'livid', 'enraged'],
  scared: ['terrified', 'petrified', 'panicked'],
  afraid: ['terrified', 'petrified'],
  cold: ['freezing', 'frigid', 'icy'],
  hot: ['scorching', 'sweltering', 'blistering'],
  good: ['excellent', 'superb', 'outstanding'],
  bad: ['terrible', 'awful', 'dreadful'],
  hungry: ['starving', 'ravenous', 'famished'],
  thirsty: ['parched'],
  quiet: ['silent', 'hushed', 'still'],
  loud: ['deafening', 'thunderous', 'booming'],
  old: ['ancient', 'aged', 'decrepit'],
  pretty: ['beautiful', 'stunning', 'lovely'],
  beautiful: ['gorgeous', 'stunning', 'exquisite'],
  ugly: ['hideous', 'grotesque'],
  smart: ['brilliant', 'clever', 'gifted'],
  stupid: ['idiotic', 'foolish', 'senseless'],
  dirty: ['filthy', 'grimy', 'squalid'],
  clean: ['spotless', 'immaculate', 'pristine'],
  wet: ['soaked', 'drenched', 'sodden'],
  dry: ['parched', 'arid', 'bone-dry'],
  dark: ['pitch-black', 'inky', 'murky'],
  bright: ['dazzling', 'blinding', 'brilliant'],
  funny: ['hilarious', 'uproarious'],
  important: ['crucial', 'vital', 'essential'],
  difficult: ['grueling', 'arduous', 'punishing'],
  hard: ['grueling', 'arduous', 'punishing'],
  easy: ['effortless', 'simple'],
  surprised: ['astonished', 'stunned', 'astounded'],
  worried: ['anxious', 'frantic', 'distraught'],
  boring: ['tedious', 'dull', 'monotonous'],
  strong: ['powerful', 'mighty', 'formidable'],
  weak: ['feeble', 'frail'],
  fast: ['rapid', 'swift', 'breakneck'],
  quick: ['rapid', 'swift'],
  slow: ['sluggish', 'plodding', 'glacial'],
  sure: ['certain', 'positive', 'convinced'],
  rich: ['wealthy', 'affluent', 'loaded'],
  poor: ['destitute', 'impoverished'],
  nice: ['kind', 'lovely', 'delightful'],
  mean: ['cruel', 'vicious', 'spiteful'],
  upset: ['distraught', 'devastated', 'shaken'],
  excited: ['thrilled', 'ecstatic', 'eager'],
  calm: ['serene', 'tranquil', 'placid'],
  busy: ['swamped', 'frantic', 'hectic'],
  sick: ['ill', 'nauseous', 'feverish'],
  heavy: ['leaden', 'hefty', 'weighty'],
  full: ['packed', 'crammed', 'overflowing'],
  empty: ['barren', 'deserted', 'desolate'],
  serious: ['grave', 'solemn', 'severe'],
  long: ['endless', 'interminable', 'lengthy'],
  short: ['brief', 'fleeting', 'curt'],
  clear: ['obvious', 'unmistakable', 'plain'],
  different: ['distinct', 'unlike', 'unrecognizable'],
  confused: ['baffled', 'bewildered', 'perplexed'],
  embarrassed: ['mortified', 'humiliated'],
  hurt: ['wounded', 'injured', 'devastated'],
  painful: ['agonizing', 'excruciating'],
  lonely: ['isolated', 'forlorn', 'desolate'],
};

const INTENSIFIERS = 'very|really|so|extremely|incredibly|terribly|awfully|super|truly';

const matchCase = (source: string, s: string) => (source[0] === source[0].toUpperCase() && source[0] !== source[0].toLowerCase() ? s[0].toUpperCase() + s.slice(1) : s);

export interface StrongerHit {
  start: number;
  end: number;
  original: string;
  replacements: string[];
  message: string;
}

const verbIndex = (() => {
  // verb form → [entryIndex, formIndex][]
  const m = new Map<string, [number, number][]>();
  VERB_ADVERB.forEach(([forms], e) => forms.forEach((f, i) => m.set(f, [...(m.get(f) ?? []), [e, i]])));
  return m;
})();

/** Verbs that don't take an object: words between them and the adverb must start with a preposition. */
const INTRANSITIVE = new Set(['run', 'walk', 'go', 'move', 'fall', 'sit', 'sleep', 'cry', 'laugh', 'smile', 'breathe', 'shake', 'try', 'look']);
const PREPOSITIONS = new Set(
  'at,to,across,into,through,down,up,along,over,toward,towards,around,past,out,back,away,off,onto,from,in,on,by,under,behind,beside,between,inside,outside,upstairs,downstairs,home'.split(','),
);
// What can open an object ("closed the door loudly", "held her hand tightly", "said it quietly").
const OBJECT_START = new Set('the,a,an,his,her,my,their,our,your,its,this,that,these,those,it,him,them,me,us,one,both'.split(','));
// Words that start a new clause or action: the adverb after them belongs to something else.
const CLAUSE_BREAK = new Set('and,but,or,so,then,while,as,because,when,that,which,who,if,until,before,after,where,though,although,to'.split(','));
/** How many words may sit between the verb and its adverb. */
const MAX_BETWEEN = 4;

/** Weak verb + adverb (either order, or with a few words between) and intensifier + adjective, each with stronger rewrites. */
export function strongerWords(text: string): StrongerHit[] {
  const out: StrongerHit[] = [];
  const words = /[\p{L}'’-]+/gu;
  const toks: { w: string; s: number; e: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = words.exec(text))) toks.push({ w: m[0], s: m.index, e: m.index + m[0].length });
  const adverbsFor = (entry: number) => VERB_ADVERB[entry][1];

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const lower = t.w.toLowerCase();
    // Verb then adverb: "ran quickly", or with words between that belong with the verb ("closed the door loudly",
    // "walked across the room slowly"). The replacement keeps those words: "slammed the door".
    const verbs = verbIndex.get(lower);
    const next = toks[i + 1];
    const gapOk = (a: { e: number }, b: { s: number }) => /^ $/.test(text.slice(a.e, b.s));
    if (verbs) {
      found: for (let j = i + 1; j <= Math.min(i + 1 + MAX_BETWEEN, toks.length - 1); j++) {
        if (!gapOk(toks[j - 1], toks[j])) break;
        const adv = toks[j].w.toLowerCase();
        const between = toks.slice(i + 1, j).map((x) => x.w.toLowerCase());
        if (between.length && (CLAUSE_BREAK.has(between[between.length - 1]) || between.some((w) => CLAUSE_BREAK.has(w) || /ly$/.test(w) || verbIndex.has(w)))) break;
        for (const [e, form] of verbs) {
          if (!adverbsFor(e).includes(adv)) continue;
          if (between.length) {
            const base = VERB_ADVERB[e][0][0];
            const ok = PREPOSITIONS.has(between[0]) || (!INTRANSITIVE.has(base) && OBJECT_START.has(between[0]));
            if (!ok) continue;
          }
          const original = text.slice(t.s, toks[j].e);
          const middle = j > i + 1 ? text.slice(toks[i + 1].s, toks[j - 1].e) : '';
          const reps = VERB_ADVERB[e][2].map((f) => matchCase(t.w, f[form]) + (middle ? ` ${middle}` : ''));
          out.push({ start: t.s, end: toks[j].e, original, replacements: reps, message: `“${original}”: one precise verb says it more vividly than a verb propped up by an adverb.` });
          break found;
        }
      }
    }
    // Adverb then verb ("quickly ran").
    const prevVerbs = next ? verbIndex.get(next.w.toLowerCase()) : undefined;
    if (prevVerbs && next && gapOk(t, next)) {
      for (const [e, form] of prevVerbs) {
        if (!adverbsFor(e).includes(lower) || lower.length < 4) continue;
        const reps = VERB_ADVERB[e][2].map((f) => matchCase(t.w, f[form]));
        out.push({ start: t.s, end: next.e, original: text.slice(t.s, next.e), replacements: reps, message: `“${text.slice(t.s, next.e)}”: one precise verb says it more vividly than a verb propped up by an adverb.` });
        break;
      }
    }
    // Intensifier + adjective ("very tired" → "exhausted").
    if (new RegExp(`^(?:${INTENSIFIERS})$`, 'i').test(t.w) && next && gapOk(t, next)) {
      const strong = INTENSIFIED[next.w.toLowerCase()];
      if (strong) {
        out.push({
          start: t.s,
          end: next.e,
          original: text.slice(t.s, next.e),
          replacements: strong.map((s) => matchCase(t.w, s)),
          message: `“${text.slice(t.s, next.e)}”: a single stronger word lands harder than “${t.w.toLowerCase()}” + adjective.`,
        });
      }
    }
  }
  return out;
}
