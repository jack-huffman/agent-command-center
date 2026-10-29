// The wording check on an agent's note to a person (T-149): each line passes the Simplified Technical English
// check before acc records it, with text in backticks and the API names acc codes left alone. The notes are made up.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { NOTE_RULE, NOTE_STE_RULE } from '../src/agent-notes.ts';
import { AccError } from '../src/exec.ts';
import { doneLines, findingLine, NOTE_FIX_TRIES, noteFixPrompt, noteLines, noteWording, noteWordingWords, refuseNoteWording, verdictLines } from '../src/note-wording.ts';
import { tempDir } from './support.ts';

const LONG = 'The page shows the region on each deal for every sales rep in each of the three teams when the deal is open and the stage is past the first one.';

test('a note\'s lines are its headline, then a thing per bullet, each option line with the thing above it', () => {
  const lines = noteLines('Two things block it.\n- The field is missing.\n- Which layout?\n  - a) sales\n  - b) service');
  assert.deepEqual(lines.map((l) => l.where), ['Headline', 'Thing 1', 'Thing 2', 'Thing 2', 'Thing 2']);
  assert.equal(lines[1]!.text, '- The field is missing.');
  assert.deepEqual(noteLines('Which queue?\n- Today it is Tier 2.', 'The question for the client').map((l) => l.where), ['The question for the client, headline', 'The question for the client, thing 1']);
});

test('edge case: an empty note, a blank line and a note with no bullets: nothing to check, or the headline alone', () => {
  assert.deepEqual(noteLines(''), []);
  assert.deepEqual(noteWording([]), []);
  assert.deepEqual(noteLines('One line.\n\n').map((l) => l.where), ['Headline']);
  assert.deepEqual(doneLines(null), []);
});

test('each hard finding comes with where it is and its fix: a semicolon, a long sentence, a phrasal verb, an "and" left at the end', () => {
  const found = noteWording(noteLines(`The gate failed; the test is new.\n- ${LONG}\n- Reach out to the client.\n- Add the field and`));
  assert.deepEqual(found.map((f) => [f.where, f.rule]), [['Headline', 'semicolon'], ['Thing 1', 'long-sentence'], ['Thing 2', 'phrasal-verb'], ['Thing 3', 'dangling-conjunction']]);
  assert.match(found[0]!.message, /Split into separate sentences/);
  assert.match(found[1]!.message, /cap 25\)\. Split it\./);
  // A headline is checked as an item too: one left on "and" is caught.
  assert.equal(noteWording([{ where: 'Headline', text: 'It needs the field and' }])[0]?.rule, 'dangling-conjunction');
});

test('edge case: advisory findings pass: a passive or a compound tense is often right to keep', () => {
  assert.deepEqual(noteWording(noteLines('The field was removed.\n- The test has failed twice.')), []);
});

test('text in backticks is code, and so is each API name acc codes: the check leaves both alone', () => {
  assert.deepEqual(noteWording(noteLines('The gate runs `npm test; npm run lint` and fails.')), []);
  // Bare names, as a builder writes them: a path that says check and verify, and a field with a semicolon after it in code.
  assert.deepEqual(noteWording(noteLines('Thing to fix.\n- scripts/check/verify.ts reads Check_Verify__c.')), []);
  // The same words outside code are a synonym rotation.
  assert.equal(noteWording(noteLines('Check the field, then verify the page.'))[0]?.rule, 'synonym-rotation');
});

test('each line is checked on its own, so a synonym in one line never counts against another', () => {
  assert.deepEqual(noteWording(noteLines('Check the field.\n- Verify the page.')), []);
});

test('a finish note is checked by its part, and a review by its summary, its sentence for the client and each finding', () => {
  const done = doneLines({ landed: ['It adds the field.', 'It shows; it hides.'], moved: [], open: ['Kick off the import.'] });
  assert.deepEqual(done.map((l) => l.where), ['What landed 1', 'What landed 2', 'Still open 1']);
  assert.deepEqual(noteWording(done).map((f) => f.where), ['What landed 2', 'Still open 1']);
  const v = { summary: 'Changes: the test is missing.', client: 'Regions show on deals.', findings: [{ message: 'Add a test; it has none.', must: true }] };
  assert.deepEqual(verdictLines(v).map((l) => l.where), ['Summary', 'For the client', 'Finding 1']);
  assert.deepEqual(noteWording(verdictLines(v)).map((f) => f.where), ['Finding 1']);
  // edge case: an older verdict with no sentence for the client.
  assert.deepEqual(verdictLines({ summary: 'Passes.', findings: [] }).map((l) => l.where), ['Summary']);
});

test('the refusal says acc recorded nothing, counts the findings and gives each fix; a note that passes is let through', () => {
  const found = noteWording(noteLines('It failed; again.\n- Kick off the run.'));
  const words = noteWordingWords(found);
  assert.match(words, /\(2 findings\), so acc recorded nothing\. Write the note again with each fix/);
  assert.ok(words.includes('- Headline: STE bans the semicolon (Rule 8.1). Split into separate sentences. [;]'), words);
  assert.ok(words.includes('- Thing 1: Soft phrasal verb.'), words);
  assert.equal(findingLine({ ...found[0]!, match: found[0]!.text }), '- Headline: STE bans the semicolon (Rule 8.1). Split into separate sentences.', 'a match that is the whole line is not said twice');
  assert.throws(() => refuseNoteWording(noteLines('It failed; again.')), (e: unknown) => e instanceof AccError && e.code === 'refused' && /1 finding\)/.test(e.message));
  assert.doesNotThrow(() => refuseNoteWording(noteLines('It failed again.\n- The test is new.')));
});

test('the reviewer is asked again with each finding, and builders and reviewers are told to write plain words', () => {
  const prompt = noteFixPrompt(noteWording([{ where: 'Finding 2', text: 'Add a test; it has none.' }]));
  assert.match(prompt, /keep your verdict and what each line says, and answer again with the whole review/);
  assert.ok(prompt.includes('- Finding 2: STE bans the semicolon'), prompt);
  assert.ok(NOTE_FIX_TRIES >= 1);
  assert.ok(NOTE_RULE.endsWith(NOTE_STE_RULE), 'the note rule carries the wording rule');
  assert.match(NOTE_STE_RULE, /Simplified Technical English \(ASD-STE100\)/);
});

// ---------------------------------------------------------------- mutants: the checks above catch them

type Mod = typeof import('../src/note-wording.ts');

/** The hard notes a module lets through: each one it records rather than refuse. None for acc's own. */
function hardLetThrough(m: Mod): string[] {
  const hard = ['It failed; again.', LONG, 'Reach out to the client.', '- Add the field and'];
  return hard.filter((text) => {
    try {
      m.refuseNoteWording([{ where: 'Headline', text }]);
      return true;
    } catch {
      return false;
    }
  });
}

/** note-wording.ts with one change, imported from a folder of its own; its imports still reach acc's modules. */
async function mutant(from: string, to: string): Promise<Mod> {
  const src = new URL('../src/note-wording.ts', import.meta.url);
  const text = readFileSync(src, 'utf8');
  assert.ok(text.includes(from), `the mutant's line is still in note-wording.ts: ${from}`);
  const changed = text.replace(from, to).replace(/from '\.\/([\w-]+\.ts)'/g, (_, f: string) => `from '${new URL(`../src/${f}`, import.meta.url).href}'`);
  const file = join(tempDir('mutant-'), 'note-wording.ts');
  writeFileSync(file, changed);
  return await import(pathToFileURL(file).href) as Mod;
}

test('acc\'s own check lets no hard note through', async () => {
  assert.deepEqual(hardLetThrough(await import('../src/note-wording.ts')), []);
});

test('a mutant that keeps only advisory findings, and lets a hard one through, is caught', async () => {
  const m = await mutant("filter((f) => f.level === 'hard')", "filter((f) => f.level === 'advisory')");
  assert.equal(hardLetThrough(m).length, 4, 'the mutant let each hard note through, and the check saw it');
});

test('a mutant that finds and still records the note is caught', async () => {
  const m = await mutant('if (found.length) throw', 'if (found.length < 0) throw');
  assert.equal(hardLetThrough(m).length, 4);
});
