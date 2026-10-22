// The Command Center's words for someone new (T-96): each main action's name, what its button says it does
// and doesn't, and the five first steps. firstSteps() itself is driven in a browser by behaviour.ts's case
// "first steps: Got it hides the five steps"; this file pins its words and what reads them.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { addToWorkTitle, BUILD_IT_TITLE, explains, FIRST_STEPS, MAKE_PLAN_TITLE, OPEN_PULL_REQUEST_TITLE, WORDS } from '../webview/plain-words.ts';
import { RETIRED, WORD_RULES } from '../scripts/words.ts';
import { PROCESSES } from '../src/logic/processes.ts';

const root = join(import.meta.dirname, '..');
const retired = WORD_RULES.find((r) => r.name === 'a retired word')!;
const byName = WORD_RULES.find((r) => r.name === 'acc by name')!;

test('the new words are the person\'s choice, and none is a retired word or says acc', () => {
  assert.deepEqual(WORDS, { addToWork: 'Add to my work', myWork: 'My work', makePlan: 'Make a plan', buildIt: 'Build it', openPullRequest: 'Open pull request', sentBack: 'Sent back', acceptAnyway: 'Accept anyway' });
  for (const w of Object.values(WORDS)) assert.ok(!retired.pattern.test(w) && !byName.pattern.test(w), w);
  assert.ok(RETIRED.length === 8);
});

test('each main action\'s explanation says what it does and what it doesn\'t', () => {
  assert.equal(addToWorkTitle('Jira'), 'Adds this ticket to your work here, so an agent can plan it and, once you approve, build it. Nothing changes in Jira.');
  assert.match(MAKE_PLAN_TITLE, /^An agent studies the ticket, the code and the org, and proposes a plan with options for you to choose\. It changes nothing\.$/);
  assert.match(BUILD_IT_TITLE, /^An agent builds the plan on its own copy of the project\. Nothing reaches the project until you merge it\.$/);
  // Open pull request opens the pull request and never merges it, so it says where the merge happens.
  assert.match(OPEN_PULL_REQUEST_TITLE, /opens its pull request\. It merges there/);
  for (const t of [addToWorkTitle('GitHub'), MAKE_PLAN_TITLE, BUILD_IT_TITLE, OPEN_PULL_REQUEST_TITLE]) assert.ok(!byName.pattern.test(t) && !retired.pattern.test(t), t);
});

test('edge cases: a button with no explanation keeps its label as its title, and every way to build explains the same', () => {
  assert.equal(explains('acc.task.show', 'Open'), 'Open', 'not a main action');
  assert.equal(explains('', ''), '', 'nothing at all');
  assert.equal(explains('acc.task.analyze', WORDS.makePlan), `Make a plan: ${MAKE_PLAN_TITLE}`, 'the label stays whole in the title');
  for (const c of ['acc.task.dispatch', 'acc.task.dispatchWith', 'acc.task.dispatchCloud', 'acc.task.dispatchAnyway', 'acc.task.dispatchAgain']) assert.equal(explains(c, 'X'), `X: ${BUILD_IT_TITLE}`, c);
  assert.equal(explains('acc.task.land', WORDS.openPullRequest), `Open pull request: ${OPEN_PULL_REQUEST_TITLE}`);
  // The process names say the same words as the buttons.
  assert.deepEqual(['dispatch', 'analyze'].map((a) => PROCESSES.find((p) => p.acc.includes(a))!.name), [WORDS.buildIt, WORDS.makePlan]);
});

test('the five first steps, in order, each with an icon; the Tasks tab draws them from firstSteps(), which reads the tab\'s memory', () => {
  assert.deepEqual(FIRST_STEPS.map((s) => s.step), ['Add a ticket to your work', 'Make a plan', 'Choose and approve', 'Build it', 'Review and merge']);
  assert.ok(FIRST_STEPS.every((s) => /^[a-z-]+$/.test(s.icon)), 'a codicon name each');
  const page = readFileSync(join(root, 'webview', 'first-steps.ts'), 'utf8');
  assert.match(page, /export function firstSteps\(\): HTMLElement \| null \{\n {2}if \(memory\(\)\.firstStepsSeen\) return null;/, 'dismissed, it draws nothing');
  const tasks = readFileSync(join(root, 'webview', 'tasks.ts'), 'utf8');
  assert.match(tasks, /m\.projects\.some\(\(p\) => p\.boards\.length\) \? firstSteps\(\) : null/, 'only with a tracker connected');
});
