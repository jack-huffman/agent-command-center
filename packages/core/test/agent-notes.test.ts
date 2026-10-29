// An agent's note to a person (T-146): its shape, the API names it wraps, and the old notes it splits. The
// notes here are made up, real-shaped: the fields, people and paths are invented.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BLOCK_SHAPE, codeNames, composeNote, isApiName, NOTE_HEADLINE_MAX, NOTE_OPTIONS_MAX, NOTE_SHAPE_WORDS, noteHeadline, noteShape, shapeProblems } from '../src/agent-notes.ts';
import { NOTE_LIMITS } from '../src/ledger.ts';

/** The note the person's screenshot showed, in shape: a headline, three numbered problems inline, each with a/b options. */
const WALL = 'Plan v2 contradicts itself, so nothing can land without a person\'s choice. (1) The plan keeps the region on Account, but the criteria name Territory_Region__c on Opportunity: which is right? a) keep Account.Region__c (recommended) b) add Territory_Region__c. (2) The record page Deal_Record_Page.flexipage-meta.xml is named twice; which layout wins? a) the sales layout b) the service layout. (3) The report type Deals_With_Regions needs the permission set Sales_Ops_Access, which the plan leaves out. I recommend b: a) drop the report b) add the permission set under force-app/main/default/permissionsets.';

/** Old notes as builders wrote them, each with the shape it should be drawn in. */
const OLD: { name: string; note: string; headline: string; items: { text: string; options?: string[]; recommended?: string }[] }[] = [
  {
    name: 'the wall: (1) (2) (3), each with a) b)',
    note: WALL,
    headline: 'Plan v2 contradicts itself, so nothing can land without a person\'s choice.',
    items: [
      { text: 'The plan keeps the region on Account, but the criteria name Territory_Region__c on Opportunity: which is right?', options: ['keep Account.Region__c (recommended)', 'add Territory_Region__c'], recommended: 'a' },
      { text: 'The record page Deal_Record_Page.flexipage-meta.xml is named twice; which layout wins?', options: ['the sales layout', 'the service layout'] },
      { text: 'The report type Deals_With_Regions needs the permission set Sales_Ops_Access, which the plan leaves out. I recommend b:', options: ['drop the report', 'add the permission set under force-app/main/default/permissionsets'], recommended: 'b' },
    ],
  },
  {
    name: '1. 2. markers, with a short lead-in kept on the headline',
    note: 'The deploy can\'t go on. Two things: 1. The org alias acme-qa isn\'t signed in. 2. jordan-kim owns the sandbox and hasn\'t answered.',
    headline: 'The deploy can\'t go on. Two things:',
    items: [{ text: 'The org alias acme-qa isn\'t signed in.' }, { text: 'jordan-kim owns the sandbox and hasn\'t answered.' }],
  },
  {
    name: 'a longer second sentence before the markers is a thing of its own',
    note: 'Blocked on a field. The ticket and the plan disagree about which object owns the rollout date, and both read as final. 1) Which object? 2) Who signs off?',
    headline: 'Blocked on a field.',
    items: [{ text: 'The ticket and the plan disagree about which object owns the rollout date, and both read as final.' }, { text: 'Which object?' }, { text: 'Who signs off?' }],
  },
  {
    name: 'options with no numbered things: one question, its options',
    note: 'Which field holds the region? (a) Region__c, or (b) a new Territory__c. Recommended: (b)',
    headline: 'Which field holds the region?',
    items: [{ text: '', options: ['Region__c', 'a new Territory__c. Recommended: (b)'], recommended: 'b' }],
  },
];

const plain = (s: ReturnType<typeof noteShape>) => s && { headline: s.headline, items: s.items.map((i) => ({ text: i.text, ...(i.options.length ? { options: i.options.map((o) => o.text) } : {}), ...(i.options.some((o) => o.recommended) ? { recommended: i.options.find((o) => o.recommended)!.label } : {}) })) };

test('an old note recorded as one paragraph splits where its shape allows: headline, a bullet per thing, its options and the one recommended', () => {
  let n = 0;
  for (const o of OLD) {
    assert.deepEqual(plain(noteShape(o.note)), { headline: o.headline, items: o.items }, o.name);
    n++;
  }
  assert.equal(n, OLD.length, 'every old note was split');
  assert.ok(n >= 4);
});

test('a note with no markers keeps its paragraph, and an empty or missing note has no shape', () => {
  assert.equal(noteShape('acc gate run errors on validate'), null, 'a short note');
  assert.equal(noteShape('A long paragraph with no markers. It goes on about the plan. And on. It never says (1) once more than once.'), null, 'one marker is no run');
  assert.equal(noteShape('Version 2. Then step 3. Then done.'), null, 'numbers that aren\'t a run from 1');
  assert.equal(noteShape(''), null);
  assert.equal(noteShape(null), null);
  assert.equal(noteShape(undefined), null);
});

test('a note written as markdown bullets reads as written: option lines under an item, inline options, a line carried on', () => {
  const s = noteShape('Two things block it.\n- Which field holds the region?\n  a) Region__c (recommended)\n  b) a new field\n    on Account\n- The path force-app/x is wrong');
  assert.deepEqual(plain(s), {
    headline: 'Two things block it.',
    items: [{ text: 'Which field holds the region?', options: ['Region__c (recommended)', 'a new field on Account'], recommended: 'a' }, { text: 'The path force-app/x is wrong' }],
  });
  assert.deepEqual(plain(noteShape('- First is the headline\n- then a thing')), { headline: 'First is the headline', items: [{ text: 'then a thing' }] }, 'no line before the bullets: the first is the headline');
  assert.deepEqual(plain(noteShape(composeNote('Pick one.', ['Which? a) x b) y'])))?.items, [{ text: 'Which?', options: ['x', 'y'] }]);
});

test('composeNote writes a headline and a bullet per item, and drops a blank item', () => {
  assert.equal(composeNote('  Stuck on   two things. ', ['first', ' ', 'second  thing']), 'Stuck on two things.\n- first\n- second thing');
  assert.equal(composeNote('Only a headline.'), 'Only a headline.');
  assert.equal(composeNote('Two things.\n- one   here\n  a)  x', ['three']), 'Two things.\n- one here\n  a) x\n- three', 'a headline with its own bullets keeps its lines and their indent');
});

test('noteHeadline is a shape\'s headline, or a paragraph\'s first sentence, and empty for no note', () => {
  assert.equal(noteHeadline(WALL), 'Plan v2 contradicts itself, so nothing can land without a person\'s choice.');
  assert.equal(noteHeadline('One thing. And another thing after it.'), 'One thing.');
  assert.equal(noteHeadline('no stop at all'), 'no stop at all');
  assert.equal(noteHeadline(null), '');
});

test('shapeProblems refuses a wall of text with words that say how to split it, and passes a shaped note', () => {
  const [why, ...more] = shapeProblems(WALL);
  assert.equal(more.length, 0);
  assert.match(why!, new RegExp(`one long paragraph \\(${WALL.length} characters; a headline takes at most ${NOTE_HEADLINE_MAX}\\)`));
  assert.ok(why!.includes(BLOCK_SHAPE), 'it says the command that splits it');
  assert.ok(why!.endsWith(NOTE_SHAPE_WORDS));
  assert.match(NOTE_SHAPE_WORDS, /a\) … b\) … c\) …, at most three/);
  assert.deepEqual(shapeProblems('acc gate run errors on validate'), [], 'a short note is fine');
  assert.deepEqual(shapeProblems(composeNote('Plan v2 contradicts itself.', ['Which object? a) Account (recommended) b) Opportunity', 'The page is named twice.'])), []);
  assert.deepEqual(shapeProblems('x'.repeat(NOTE_HEADLINE_MAX)), [], 'at the limit, not past it');
});

test('shapeProblems refuses a thing that is too long, and a question with more than three options', () => {
  const long = shapeProblems(composeNote('Short.', ['y'.repeat(NOTE_LIMITS.chars + 1)]));
  assert.deepEqual(long, [`Thing 1 is ${NOTE_LIMITS.chars + 1} characters; one takes at most ${NOTE_LIMITS.chars}. Split it into more --item lines, or say it shorter.`]);
  const four = shapeProblems(composeNote('Pick.', ['ok', 'Which? a) w b) x c) y d) z']));
  assert.equal(NOTE_OPTIONS_MAX, 3);
  assert.deepEqual(four, ['Thing 2 gives 4 options; a person picks from at most 3. Keep the 3 that matter, and mark the one you recommend.']);
});

test('codeNames wraps API names, paths, branches, files and commands it recognises', () => {
  const cases: [string, string][] = [
    ['Set Region__c on Account.', 'Set `Region__c` on Account.'],
    ['Read Account.Region__c and ns__Thing__mdt, then Deal__r.', 'Read `Account.Region__c` and `ns__Thing__mdt`, then `Deal__r`.'],
    ['The permission set Sales_Ops_Access (and ACC_ROLE).', 'The permission set `Sales_Ops_Access` (and `ACC_ROLE`).'],
    ['Its field Opportunity.StageName.', 'Its field `Opportunity.StageName`.'],
    ['In force-app/main/default and ./run.sh, or ~/notes/a.md.', 'In `force-app/main/default` and `./run.sh`, or `~/notes/a.md`.'],
    ['On task/T-9-region, edit extension/x.ts.', 'On `task/T-9-region`, edit `extension/x.ts`.'],
    ['See package.json and Deal_Page.flexipage-meta.xml.', 'See `package.json` and `Deal_Page.flexipage-meta.xml`.'],
    [`Run ${'gi'}t push, then npm run build, then sf project deploy start.`, `Run \`${'gi'}t push\`, then \`npm run build\`, then \`sf project deploy start\`.`],
  ];
  for (const [given, want] of cases) assert.equal(codeNames(given), want, given);
  assert.equal(cases.length, 8);
});

test('codeNames leaves ordinary words, links, dates, and/or, and text already in backticks alone, and none stays none', () => {
  const same = [
    'The plan contradicts itself, so nothing can land.',
    'See https://example.com/a_b/c.ts and www.example.com/x_y.',
    'Either and/or works; dated 10/29/2026; written w/o a field.',
    'Already `Region__c` and ``Deal__c `x` `` in code.',
    'Node.js reads it; e.g. a word; i.e. another.',
    'Mail jordan_kim@example.com; an _emphasis_ and __init__.',
    'The git history and the npm registry.',
  ];
  for (const s of same) assert.equal(codeNames(s), s, s);
  assert.equal(codeNames(null), null);
  assert.equal(codeNames(''), '');
  assert.equal(isApiName('Region__c'), true);
  assert.equal(isApiName('region'), false);
  assert.equal(isApiName(''), false);
});
