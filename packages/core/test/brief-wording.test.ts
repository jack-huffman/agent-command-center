// The wording check on a task's acceptance criteria (T-148): the items under a brief's Acceptance criteria
// heading, each checked on its own; a hard finding refuses with its line, rule and fix; advice goes on; code
// is left alone. The briefs are made up.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  briefAdviceLines, briefCriteria, briefWording, briefWordingWords, CRITERIA_TITLE, criterionLine, refuseBriefWording, STE_RULE_WORDS,
} from '../src/brief-wording.ts';
import { CRITERIA_PARTS } from '../src/criteria.ts';
import { AccError } from '../src/exec.ts';
import { requirementWording, STE_RULES } from '../src/ste.ts';
import { parseConfig } from '../src/config.ts';
import { emptyLedger, type Ledger, upsertTasks } from '../src/ledger.ts';
import { SF_CONFIG, tempDir } from './support.ts';

const brief = (...criteria: string[]) => ['## Goal', '', 'Regions show on each deal.', '', '## Acceptance criteria', '', ...criteria.map((c) => `- [ ] ${c}`), ''].join('\n');

test('the criteria are the list items under the Acceptance criteria heading, with their lines', () => {
  const b = brief('The page shows the region.', 'A deal with no region shows None.');
  assert.deepEqual(briefCriteria(b), [{ line: 7, text: 'The page shows the region.' }, { line: 8, text: 'A deal with no region shows None.' }]);
  // Ticked, plain and numbered items count, at any heading level; a line indented under an item goes on with it.
  const more = '### acceptance criteria\n- [x] One.\n* Two\n  goes on.\n1. Three.\n#### Inside\n- Four.\n## Next\n- Not one.';
  assert.deepEqual(briefCriteria(more).map((c) => c.text), ['One.', 'Two goes on.', 'Three.', 'Four.']);
});

test('edge case: a brief with no criteria heading, an empty one, or items only in a code fence has no criteria', () => {
  assert.deepEqual(briefCriteria(''), []);
  assert.deepEqual(briefCriteria('Do the thing; then the other.\n- Kick off the run.'), []);
  assert.deepEqual(briefCriteria('## Acceptance criteria\n\n## Notes\n- Kick off.'), []);
  assert.deepEqual(briefCriteria('## Acceptance criteria\n```\n- Kick off; now.\n```\n- [ ]   \n'), []);
  assert.deepEqual(briefWording('Text before; any heading.'), [], 'a semicolon outside the criteria is not checked');
});

test('a brief whose criteria pass has no findings, and refuseBriefWording lets it through', () => {
  const b = brief('The page shows the region of each deal.', 'A deal with no region shows None.');
  assert.deepEqual(briefWording(b), []);
  assert.deepEqual(refuseBriefWording(b, 'T-9'), []);
});

test('each hard rule is found on its criterion, with its line, its rule and its fix', () => {
  const b = brief('The page shows the region; it loads fast.', 'Kick off the import.', 'The page is seamless.', 'Perform an analysis of the deals.',
    `The importer reads every row of the file and writes each row to the table that the team uses for the reports at the end of the month.`,
    'Check the field, then verify the value.', 'The page shows the region and');
  const found = briefWording(b);
  assert.deepEqual(found.map((f) => [f.criterion, f.line, f.rule, f.level]), [
    [1, 7, 'semicolon', 'hard'], [2, 8, 'phrasal-verb', 'hard'], [3, 9, 'marketing-adjective', 'hard'], [4, 10, 'nominalization', 'hard'],
    [5, 11, 'long-sentence', 'hard'], [6, 12, 'synonym-rotation', 'hard'], [7, 13, 'dangling-conjunction', 'hard'],
  ]);
  assert.equal(criterionLine(found[0]!), '- Line 7 (criterion 1), semicolon: STE bans the semicolon (Rule 8.1). Split into separate sentences. [;]');
  // A dangling "and" matches the whole item, which isn't repeated.
  assert.equal(criterionLine(found[6]!), '- Line 13 (criterion 7), dangling-conjunction: List item ends with a coordinating conjunction. Complete the item or join it with the next item.');
});

test('a hard finding refuses with a count, each line, rule and fix, and the task named when there is one', () => {
  const b = brief('The page shows the region; it loads fast.', 'Kick off the import.');
  assert.throws(() => refuseBriefWording(b, 'T-9'), (e: unknown) => {
    assert.ok(e instanceof AccError && e.code === 'refused');
    assert.equal(e.message, [
      'T-9\'s acceptance criteria don\'t pass the Simplified Technical English check (2 findings), so acc wrote nothing. Write each criterion again with its fix, then run the command again:',
      '- Line 7 (criterion 1), semicolon: STE bans the semicolon (Rule 8.1). Split into separate sentences. [;]',
      '- Line 8 (criterion 2), phrasal-verb: Soft phrasal verb. Use the single plain verb (start, contact, read, begin). [Kick off]',
    ].join('\n'));
    return true;
  });
  assert.match(briefWordingWords(briefWording(brief('Kick off.')), null), /^The acceptance criteria don't pass the Simplified Technical English check \(1 finding\)/);
});

test('advisory findings are advice: they never refuse, and they come back to show', () => {
  const b = brief('The region is shown on the page.', 'The team has used the old page.');
  const advice = refuseBriefWording(b, 'T-9');
  assert.deepEqual(advice.map((f) => [f.criterion, f.rule, f.level]), [[1, 'passive-voice', 'advisory'], [2, 'present-perfect', 'advisory']]);
  assert.deepEqual(briefAdviceLines(advice), [
    'Advice on the wording of the acceptance criteria. It doesn\'t stop the command:',
    '- Line 7 (criterion 1), passive-voice: Possible passive voice. Name the actor and use an active verb, unless the actor is unknown or irrelevant. [is shown]',
    '- Line 8 (criterion 2), present-perfect: Compound tense. Use simple past/present unless current relevance is the point (then keep and flag). [has used]',
  ]);
  assert.deepEqual(briefAdviceLines([]), []);
});

test('code in backticks and bare API names are left alone, and each criterion is checked on its own', () => {
  assert.deepEqual(briefWording(brief('`acc add; acc edit` refuses the brief.', 'The page reads Kick_Off__c from the deal.')), []);
  // check in one criterion and verify in another are not a synonym rotation.
  assert.deepEqual(briefWording(brief('Check the field.', 'Verify the value.')), []);
});

test('the heading is the drafted criteria\'s own, and every rule has words for a person', () => {
  assert.equal(CRITERIA_PARTS.criteria, CRITERIA_TITLE);
  assert.deepEqual(Object.keys(STE_RULE_WORDS).sort(), [...new Set([...STE_RULES.map((r) => r.id), 'long-sentence', 'synonym-rotation', 'dangling-conjunction'])].sort());
  assert.ok(Object.values(STE_RULE_WORDS).every((w) => w.length > 0));
});

// ---------------------------------------------------------------- edits, and the mutants the checks catch

const config = parseConfig(JSON.parse(JSON.stringify(SF_CONFIG))).config!;
const clock = () => new Date('2026-10-29T12:00:00Z');

/** A manual T-1 and a Jira ACME-7, as acc adds them. */
function ledger(): Ledger {
  const l = emptyLedger();
  upsertTasks(l, config, [
    { source: { kind: 'manual', key: 'T-1' }, title: 'Regions on deals', brief: 'Old brief' },
    { source: { kind: 'jira', key: 'ACME-7', url: 'https://acme.example/browse/ACME-7' }, title: 'From Jira', brief: brief('Kick off the import; then stop.') },
  ], 'human', 'human:test', () => {}, clock);
  return l;
}

type Edit = typeof import('../src/edit.ts');
const BAD = brief('Kick off the import; then stop.');

/** Whether an edit to T-1's brief that fails the check is written: its brief changed, or an event went out. */
function writesBadBrief(m: Edit): boolean {
  const l = ledger();
  const events: unknown[] = [];
  try {
    m.editTask(l, config, 'T-1', { brief: BAD }, 'human', 'human:pat', (e) => events.push(e), clock);
  } catch {
    // Refused: what follows says whether it wrote first.
  }
  return l.tasks[0]!.brief !== 'Old brief' || events.length > 0;
}

test('an edit whose criteria fail is refused, writes nothing, and one that passes keeps its advice', async () => {
  const m = await import('../src/edit.ts');
  const l = ledger();
  assert.throws(() => m.editTask(l, config, 'T-1', { brief: BAD }, 'human', 'human:pat', () => {}, clock), /T-1's acceptance criteria don't pass .*\(2 findings\)/);
  assert.equal(l.tasks[0]!.brief, 'Old brief');
  assert.equal(l.tasks[0]!.edits, undefined);
  const ok = m.editTask(l, config, 'T-1', { brief: brief('The region is shown on the page.') }, 'human', 'human:pat', () => {}, clock);
  assert.deepEqual(ok.changed, ['brief']);
  assert.deepEqual(ok.advice.map((f) => f.rule), ['passive-voice']);
  // An edit that leaves the brief alone isn't checked: a brief written before the check stays editable.
  l.tasks[0]!.brief = BAD;
  assert.deepEqual(m.editTask(l, config, 'T-1', { notes: 'Use the sandbox.' }, 'human', 'human:pat', () => {}, clock).changed, ['notes']);
});

test('edge case: a tracker\'s ticket is never refused for its wording: its intake keeps the client\'s words', async () => {
  const l = ledger();
  // Its brief came in with two hard findings, and an edit to what acc keeps for it goes on.
  assert.equal(briefWording(l.tasks[1]!.brief).filter((f) => f.level === 'hard').length, 2);
  const r = (await import('../src/edit.ts')).editTask(l, config, 'ACME-7', { notes: 'Ask Jordan.' }, 'human', 'human:pat', () => {}, clock);
  assert.deepEqual([r.changed, r.advice], [['notes'], []]);
  // Intake refreshes it with the same words, and refuses nothing.
  const again = upsertTasks(l, config, [{ source: { kind: 'jira', key: 'ACME-7' }, title: 'From Jira', brief: brief('Reach out to the team; now.') }], 'human', 'human:test', () => {}, clock);
  assert.deepEqual([again.updated, again.errors], [['ACME-7'], []]);
  // Its plan still shows the findings on the criteria it reads back, as advice (T-12).
  const read = briefCriteria(l.tasks[1]!.brief).map((c) => c.text);
  assert.deepEqual(requirementWording({ goal: '', criteria: read, assumptions: [], outOfScope: [] }).map((f) => f.rule), ['phrasal-verb', 'semicolon']);
});

/** A source module with one change, imported from a folder of its own; its imports still reach acc's modules. */
async function mutant<T>(file: string, from: string, to: string): Promise<T> {
  const src = new URL(`../src/${file}`, import.meta.url);
  const text = readFileSync(src, 'utf8');
  assert.ok(text.includes(from), `the mutant's line is still in ${file}: ${from}`);
  const changed = text.replace(from, to).replace(/from '\.\/([\w/-]+\.ts)'/g, (_, f: string) => `from '${new URL(`../src/${f}`, import.meta.url).href}'`);
  const out = join(tempDir('mutant-'), file);
  writeFileSync(out, changed);
  return await import(pathToFileURL(out).href) as T;
}

test('acc\'s own edit writes no brief that fails the check', async () => {
  assert.equal(writesBadBrief(await import('../src/edit.ts')), false);
});

test('a mutant that skips the check on an edit is caught', async () => {
  const m = await mutant<Edit>('edit.ts', 'refuseBriefWording(next.brief, id)', '[]');
  assert.equal(writesBadBrief(m), true, 'the mutant wrote the brief, and the check saw it');
});

test('a mutant that finds the hard findings and still lets the brief through is caught', async () => {
  const m = await mutant<typeof import('../src/brief-wording.ts')>('brief-wording.ts', 'if (hard.length) throw', 'if (hard.length < 0) throw');
  assert.doesNotThrow(() => m.refuseBriefWording(BAD), 'the mutant let the brief through');
  assert.throws(() => refuseBriefWording(BAD), /2 findings/, 'and acc\'s own refuses it');
});
