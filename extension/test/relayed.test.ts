// What acc recorded reaches a person in process words (GH-163): a step autopilot couldn't take, a hold, a
// block and a move say "Run the checks", never "Run acc gate run". These tests feed core's own messages
// through the boundary (logic/relayed.ts) and every view built from it, and pin where the hub reads them.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { analysisProblems } from '../../packages/core/src/analyze.ts';
import { autopilotMode } from '../../packages/core/src/autopilot.ts';
import type { AutopilotRecord } from '../../packages/core/src/autopilot-log.ts';
import type { Config } from '../../packages/core/src/config.ts';
import { emptyLedger, type Task } from '../../packages/core/src/ledger.ts';
import type { RepoPaths } from '../../packages/core/src/paths.ts';
import { autopilotNotices } from '../src/logic/autopilot.ts';
import { reasonInWords, rowInWords, stepInWords } from '../src/logic/relayed.ts';
import type { TaskRow } from '../src/logic/shared.ts';
import { autopilotLook, filesLook } from '../src/model/cards.ts';
import { autopilotStepLook } from '../src/model/history.ts';
import { homeModel } from '../src/model/home.ts';
import { ticketModel } from '../src/model/task-page.ts';
import type { Hub } from '../src/hub.ts';
import { deriveRows } from '../src/task-rows.ts';
import { WORD_RULES } from '../scripts/words.ts';
import { hub, root, row } from './support.ts';

const rulesHit = (s: string): string[] => WORD_RULES.filter((r) => r.pattern.test(s)).map((r) => r.name);

/** Why autopilot couldn't review a task, as acc's review refuses it (packages/core/src/review.ts). */
const REVIEW_REFUSED = 'AV-5\'s checks aren\'t settled on e7f8a9b: validate. Run acc gate run in its worktree, or waive them, then review.';
/** Why it couldn't land one, as acc's land refuses it (packages/core/src/land.ts). */
const LAND_REFUSED = 'AV-5 hasn\'t been reviewed on e7f8a9b. Run acc review AV-5 first.';
/** A builder's block, in its own words. */
const BLOCKED = 'acc gate run errors on validate: the Dev login has expired. Log in again, then I can run acc gate run.';

test('acc\'s own refusals reach a person with no command or path left, and each still says what to do', () => {
  const said = [
    REVIEW_REFUSED, LAND_REFUSED, BLOCKED,
    // Asked of core itself: autopilot's refusal for an autonomy not built, and a dispatch held for its analysis.
    autopilotMode({ autonomy: 'dispatch' }).refusal!,
    ...analysisProblems({ analyses: join(root, 'no-analyses-here') } as RepoPaths, { profile: 'salesforce' } as Config, { id: 'AV-9', state: 'todo' } as Task),
  ];
  assert.equal(said.length, 5);
  for (const s of said) assert.ok(rulesHit(s).length, `the sample names a command or a path as acc writes it: ${s}`);
  const words = said.map((s) => reasonInWords(s));
  for (const w of words) assert.deepEqual(rulesHit(w), [], w);
  assert.deepEqual(words.slice(0, 3), [
    'AV-5\'s checks aren\'t settled on e7f8a9b: validate. Run the checks in its worktree, or waive them, then review.',
    'AV-5 hasn\'t been reviewed on e7f8a9b. Review AV-5 with an agent first.',
    '"Run the checks" errors on validate: the Dev login has expired. Log in again, then I can run the checks.',
  ]);
  assert.match(words[3]!, /in the project's settings/);
  assert.match(words[4]!, /"Analyze AV-9 before the build"/);
});

test('a failed autopilot step whose reason names acc gate run reaches the notice, History, the card and the Overview in process words', () => {
  const at = '2026-10-10T12:00:00.000Z';
  const raw: AutopilotRecord[] = [
    { seq: 1, at, task: 'AV-5', step: 'review', outcome: 'failed', reason: REVIEW_REFUSED },
    { seq: 2, at, task: 'AV-6', step: 'review', outcome: 'done', verdict: 'changes', reason: 'Run acc gate run again: the validate check never ran.' },
    { seq: 3, at, task: 'AV-7', step: 'resume', outcome: 'done', reason: 'I ran acc gate run and it failed on tests.' },
  ];
  const steps = raw.map(stepInWords);
  const notices = autopilotNotices(steps, ['AV-5', 'AV-6', 'AV-7'].map((id) => ({ id, source: { kind: 'jira', key: id }, history: [] })));
  assert.equal(notices.length, 3);
  assert.equal(notices[0]!.text, 'Autopilot couldn\'t review AV-5: AV-5\'s checks aren\'t settled on e7f8a9b: validate. Run the checks in its worktree, or waive them, then review.');
  const history = steps.map((s) => autopilotStepLook(s).detail ?? '');
  for (const t of [...notices.map((n) => n.text), ...history]) assert.deepEqual(rulesHit(t), [], t);
  // As the hub reads it raw, the same step names the command: the boundary is what changes it.
  assert.ok(rulesHit(autopilotNotices(raw.slice(0, 1), [])[0]!.text).length);

  const failed = rowInWords({ ...row('AV-5', 'review', 'needs-you'), run: { worktree: '/w', branch: 'task/AV-5' }, autopilot: { step: 'review', reason: REVIEW_REFUSED } });
  assert.equal(autopilotLook(failed)!.label, 'Needs you: autopilot couldn\'t review: AV-5\'s checks aren\'t settled on e7f8a9b: validate. Run the checks in its worktree, or waive them, then review.');
  const h = { ...hub(), taskRows: () => [failed] };
  const m = homeModel({ hub: h, section: 'overview', boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set() } });
  const item = m.overview.attention.find((a) => a.title === 'AV-5 Task AV-5')!;
  assert.equal(item.detail, 'Acme · AV-5\'s checks aren\'t settled on e7f8a9b: validate. Run the checks in its worktree, or waive them, then review. Do it by hand, or a new commit lets autopilot try again.');
});

test('a held task that failed to start, a review\'s summary and a stopped builder\'s last words reach its card in process words', () => {
  const held = rowInWords({ ...row('AV-9', 'todo', 'needs-you'), deps: [], files: { known: true, shares: [], first: [], held: { at: 't', failed: 'AV-9 hasn\'t been analyzed yet: acc analyze AV-9.', byAutopilot: true } } });
  assert.equal(filesLook(held)!.label, 'Needs you: autopilot couldn\'t start it: AV-9 hasn\'t been analyzed yet: "Analyze AV-9 before the build".');
  const r = rowInWords({ ...row('AV-1', 'running', 'needs-you'), review: { verdict: 'changes', summary: 'See .acc/rules.md: run acc gate run first.', current: true }, stopped: { said: 'Waiting on acc done.' }, queue: { place: 1, of: 1, ahead: null, phase: 'held', why: 'Run acc sync first.' } });
  assert.deepEqual([r.review!.summary, r.stopped!.said, r.queue!.why], ['See the project\'s rules: run the checks first.', 'Waiting on "Finish the task".', 'Refresh from GitHub first.']);
});

test('deriveRows, where the hub reads the ledger, puts a failed step\'s reason in process words', () => {
  const task = {
    id: 'AV-5', title: 'Task AV-5', brief: '', source: { kind: 'jira', key: 'AV-5', url: null }, environment: 'devbox', deps: [], labels: [], state: 'review', blocker: null,
    run: { worktree: '/w', branch: 'task/AV-5' }, pr: null, history: [], createdAt: '', updatedAt: '',
    autopilot: { failed: { step: 'review', sha: 'e7f8a9b', state: 'review', reason: REVIEW_REFUSED, at: '2026-10-10T12:00:00.000Z' } },
  } as unknown as Task;
  const fake = { agentsAt: 0, agentsError: null, agents: [] } as unknown as Hub;
  const [r] = deriveRows(fake, { ...emptyLedger(), tasks: [task] });
  assert.deepEqual(r!.autopilot, { step: 'review', reason: 'AV-5\'s checks aren\'t settled on e7f8a9b: validate. Run the checks in its worktree, or waive them, then review.' });
});

test('a task page says why it\'s blocked, and why it moved, in process words, whoever wrote it', () => {
  const task = {
    id: 'AV-3', title: 'Task AV-3', brief: '', source: { kind: 'jira', key: 'AV-3', url: null }, environment: 'devbox', deps: [], labels: [], state: 'blocked', blocker: BLOCKED,
    run: null, pr: null, createdAt: '', updatedAt: '',
    history: [
      { at: '2026-10-10T11:00:00.000Z', from: 'running', to: 'blocked', by: 'builder:AV-3', reason: BLOCKED },
      { at: '2026-10-10T10:00:00.000Z', from: 'review', to: 'rework', by: 'reviewer', reason: 'Edits .acc/config.json without a decision.' },
    ],
  } as unknown as Task;
  const page = ticketModel({ project: '/r', tracker: null, trackerTitle: null, trackerKind: null, key: 'AV-3', ticket: null, loading: false, error: null, connect: null, checks: [], row: row('AV-3', 'blocked', 'blocked'), task });
  assert.equal(page.acc!.blocker, '"Run the checks" errors on validate: the Dev login has expired. Log in again, then I can run the checks.');
  assert.deepEqual(page.acc!.history.map((h) => h.reason), ['Edits the project\'s settings without a decision.', page.acc!.blocker]);
});

test('edge cases: no reason, an empty one, text with no command, a step read twice, and the files and branch a row names stay as they were', () => {
  const at = '2026-10-10T12:00:00.000Z';
  const none: AutopilotRecord = { seq: 1, at, task: 'AV-1', step: 'review', outcome: 'done', verdict: 'pass' };
  assert.equal(stepInWords(none), none, 'a step with no reason is the same step');
  const empty: AutopilotRecord = { ...none, outcome: 'failed', reason: '' };
  assert.equal(stepInWords(empty), empty, 'nor does an empty reason change it');
  const failed: AutopilotRecord = { seq: 2, at, task: 'AV-1', step: 'land', outcome: 'failed', reason: LAND_REFUSED };
  assert.equal(stepInWords(failed), stepInWords(failed), 'a step the hub hands out again is the one already in words');
  assert.equal(failed.reason, LAND_REFUSED, 'the record the log keeps is left as acc wrote it');
  assert.deepEqual([reasonInWords(null), reasonInWords(undefined), reasonInWords('')], [null, null, null]);
  const push = 'git push refused task/AV-5: ! [rejected] (fetch first)';
  assert.equal(reasonInWords(push), push, 'a reason that names no acc command is as it was');
  const plain = { ...row('AV-2', 'review', 'needs-you'), run: { worktree: '/r/.acc/worktrees/AV-2', branch: 'task/AV-2-docs' }, pr: { number: 3, url: 'u', state: 'open', conflicts: ['.acc/config.json', 'docs/DECISIONS.md'] }, files: { known: true, shares: [{ task: 'AV-1', files: ['.acc/rules.md'] }], first: [], held: null } } as TaskRow;
  assert.deepEqual(rowInWords(plain), plain, 'its files, branch and worktree are the work itself');
});

test('the hub reads autopilot\'s log and each task\'s row through the boundary, and the screenshot fixtures do too', () => {
  const src = (f: string) => readFileSync(join(root, f), 'utf8');
  assert.match(src('src/hub.ts'), /autopilotLog\(root: string\): AutopilotRecord\[\] \{[^}]*\.records\.map\(stepInWords\)/);
  assert.match(src('src/task-rows.ts'), /return rowInWords\(\{\n\s+id: t\.id,/);
  assert.match(src('scripts/fixtures/hub.ts'), /sampleTasks\(now\)\.map\(rowInWords\)/);
  assert.match(src('scripts/fixtures/hub.ts'), /sampleAutopilot\(now\)\.map\(stepInWords\)/);
});
