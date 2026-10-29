// The wording check on a draft update for a client (T-151): an agent's words in a draft pass the Simplified Technical
// English check before acc writes it. acc's own text and a person's edit aren't checked. The drafts are made up.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { draftWordingWords, refuseDraftWording } from '../src/draft-wording.ts';
import { AccError } from '../src/exec.ts';
import type { Task } from '../src/ledger.ts';
import { noteWording } from '../src/note-wording.ts';
import { claimUpdate, draftUpdate, listUpdates, markPosted } from '../src/updates.ts';
import { tempDir } from './support.ts';

const now = () => new Date('2026-10-29T12:00:00Z');
const store = () => ({ updates: join(tempDir(), 'acc', 'updates') });
const jira: Pick<Task, 'id' | 'source'> = { id: 'ACME-12', source: { kind: 'jira', key: 'ACME-12', url: 'https://acme.atlassian.net/browse/ACME-12' } };
const pr = { number: 38, url: 'https://github.com/acme/service/pull/38' };
const HARD = 'We will reach out to the team; then it ships.';

test('a draft whose agent\'s words have a hard finding is not written, and acc gives each finding and its fix', () => {
  const paths = store();
  const agent = [{ where: 'The sentence for the client', text: HARD }];
  assert.throws(() => draftUpdate(paths, jira, { event: 'pr-opened', pr, context: { summary: HARD }, agent }, 'acc land', now), (e: Error) => {
    assert.ok(e instanceof AccError && e.code === 'refused');
    assert.equal(e.message, draftWordingWords(noteWording(agent)));
    assert.match(e.message, /^The agent's words in the draft update don't pass the Simplified Technical English check \(2 findings\), so acc wrote no draft\. Write each line again with its fix:\n- The sentence for the client: /);
    return true;
  });
  assert.ok(!existsSync(paths.updates) || readdirSync(paths.updates).filter((f) => f.endsWith('.json')).length === 0, 'no draft is written');
  // Written again in plain words, it is drafted, with acc's own words around it.
  const u = draftUpdate(paths, jira, { event: 'pr-opened', pr, context: { summary: 'Totals now add up on the invoice page.' }, agent: [{ where: 'The sentence for the client', text: 'Totals now add up on the invoice page.' }] }, 'acc land', now)!;
  assert.equal(u.text, 'The change is ready for review: https://github.com/acme/service/pull/38\nTotals now add up on the invoice page.');
});

test('a planning agent\'s question with a hard finding is not drafted; code in backticks is left alone', () => {
  const paths = store();
  assert.throws(() => draftUpdate(paths, jira, { event: 'question', question: 'q1', text: 'x', agent: [{ where: 'Question q1', text: 'Should we reach out to sales?' }] }, 'human:jordan', now), /- Question q1: /);
  assert.equal(listUpdates(paths).length, 0);
  assert.ok(draftUpdate(paths, jira, { event: 'question', question: 'q1', text: 'x', agent: [{ where: 'Question q1', text: 'Should `a; b` run first?' }] }, 'human:jordan', now));
});

test('an edge case: acc\'s own text, and a draft with no agent\'s words, are never checked', () => {
  const paths = store();
  // Text acc makes itself (a field's text from names and values, the ticket's title) goes in with no agent's lines.
  assert.notEqual(noteWording([{ where: 'x', text: HARD }]).length, 0, 'the text would fail the check');
  assert.ok(draftUpdate(paths, jira, { event: 'pr-opened', pr, context: { summary: HARD } }, 'acc land', now));
  assert.ok(draftUpdate(paths, jira, { event: 'changes', text: HARD }, 'acc land', now));
  assert.ok(draftUpdate(paths, jira, { event: 'merged', env: 'Dev', agent: [] }, 'acc sync', now), 'an empty list checks nothing');
  // A task with no ticket gets no draft, and nothing is checked or refused.
  assert.equal(draftUpdate(paths, { id: 'T-1', source: { kind: 'manual', key: null, url: null } }, { event: 'pr-opened', pr, agent: [{ where: 'x', text: HARD }] }, 'acc land', now), null);
});

test('a person\'s edit of a draft is not checked: it posts as they wrote it', () => {
  const paths = store();
  const u = draftUpdate(paths, jira, { event: 'merged', env: 'Dev' }, 'acc sync', now)!;
  claimUpdate(paths, u.id, 'human:jordan', now);
  assert.equal(markPosted(paths, u.id, { by: 'human:jordan', text: HARD }, now).posted?.text, HARD);
});

// ---------------------------------------------------------------- mutants: the checks above catch them

/** A module with one change, imported from a folder of its own; its imports still reach acc's modules. */
async function mutant<T>(module: string, from: string, to: string): Promise<T> {
  const text = readFileSync(new URL(`../src/${module}`, import.meta.url), 'utf8');
  assert.ok(text.includes(from), `the mutant's line is still in ${module}: ${from}`);
  const changed = text.replace(from, to).replace(/from '\.\/([\w/-]+\.ts)'/g, (_, f: string) => `from '${new URL(`../src/${f}`, import.meta.url).href}'`);
  const file = join(tempDir('mutant-'), module);
  writeFileSync(file, changed);
  return await import(pathToFileURL(file).href) as T;
}

/** Whether a draftUpdate writes a draft whose agent's words have a hard finding. */
function hardDraftWritten(draft: typeof draftUpdate): boolean {
  const paths = store();
  try {
    draft(paths, jira, { event: 'pr-opened', pr, context: { summary: HARD }, agent: [{ where: 'The sentence for the client', text: HARD }] }, 'acc land', now);
  } catch {
    return false;
  }
  return listUpdates(paths).length > 0;
}

test('acc\'s own draftUpdate writes no draft with a hard finding', () => {
  assert.equal(hardDraftWritten(draftUpdate), false);
});

test('a mutant of draftUpdate that skips the agent\'s words, and writes a hard draft, is caught', async () => {
  const m = await mutant<typeof import('../src/updates.ts')>('updates.ts', 'refuseDraftWording(input.agent ?? []);', 'refuseDraftWording([]);');
  assert.equal(hardDraftWritten(m.draftUpdate), true, 'the mutant wrote the hard draft, and the check saw it');
});

test('a mutant of the draft check that finds and still lets the draft through is caught', async () => {
  const m = await mutant<typeof import('../src/draft-wording.ts')>('draft-wording.ts', 'if (found.length) throw', 'if (found.length < 0) throw');
  const agent = [{ where: 'x', text: HARD }];
  assert.throws(() => refuseDraftWording(agent), /wrote no draft/);
  assert.doesNotThrow(() => m.refuseDraftWording(agent), 'the mutant lets it through, and the check saw it');
});
