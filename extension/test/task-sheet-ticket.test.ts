// The task sheet writing a ticket (T-80), with the built extension against the vscode stand-in and a gh
// that keeps one issue in a file: where the GitHub tracker says "edits": true, Edit opens the sheet with the
// issue's own title and body, and Save reaches gh issue edit, then refreshes the task from the issue. When
// someone changed the issue after the sheet opened, Save writes nothing and sends both versions back. Run
// after npm run build.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import type { TaskSheet } from '../src/model/task-sheet.ts';
import { TASK_SHEET_DONE, TASK_SHEET_MESSAGE, TASK_SHEET_ROWS } from '../src/model/task-sheet.ts';
import { makeRepo } from '../../packages/core/test/support.ts';
import { activate, fakeVscode, sandboxEnv, until } from './vscode.ts';

const dist = fileURLToPath(new URL('../dist/extension.js', import.meta.url));

type Tab = ReturnType<typeof fakeVscode>['panels'][number];
type Msg = { type?: string; sheet?: TaskSheet; model?: { tasks?: { projects: { root: string }[] } }; [k: string]: unknown };

const s = {} as { fake: ReturnType<typeof fakeVscode>; started: ReturnType<typeof activate>; repo: string; root: string; tab: Tab; issue: string; log: string; restore: () => void };

/**
 * A gh that knows one issue, #7 of o/r, kept in a file so a test can change it as a colleague would: auth
 * token answers, issue view prints it, issue edit writes its title and body (from stdin) and issue close
 * closes it, each logging what it was asked, and the repo has no Project. Everything else fails, as the
 * sandbox's other tools do.
 */
const GH = `import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
const [issue, log] = [process.env.FAKE_GH_ISSUE, process.env.FAKE_GH_LOG];
const args = process.argv.slice(2);
if (args[0] === 'auth' && args[1] === 'token') { console.log('tok'); process.exit(0); }
if (args[0] === 'issue' && args[1] === 'view' && args[2] === '7') { process.stdout.write(readFileSync(issue, 'utf8')); process.exit(0); }
if (args[0] === 'api' && args[1] === 'graphql') { console.log(JSON.stringify({ data: { repository: { projectsV2: { nodes: [] } } } })); process.exit(0); }
if (args[0] === 'issue' && args[1] === 'close' && args[2] === '7') {
  const i = JSON.parse(readFileSync(issue, 'utf8'));
  appendFileSync(log, JSON.stringify({ args }) + '\\n');
  writeFileSync(issue, JSON.stringify({ ...i, state: 'CLOSED', stateReason: 'COMPLETED' }));
  process.exit(0);
}
if (args[0] === 'issue' && args[1] === 'edit' && args[2] === '7') {
  const i = JSON.parse(readFileSync(issue, 'utf8'));
  const title = args.find((a) => a.startsWith('--title='));
  const body = args.includes('--body-file') ? readFileSync(0, 'utf8') : undefined;
  appendFileSync(log, JSON.stringify({ args, body }) + '\\n');
  if (title) i.title = title.slice('--title='.length);
  if (body !== undefined) i.body = body;
  writeFileSync(issue, JSON.stringify(i));
  process.exit(0);
}
process.exit(1);
`;

const issue = (title: string, body: string) => JSON.stringify({
  number: 7, title, body, state: 'OPEN', stateReason: null, author: { login: 'pat' }, assignees: [], labels: [{ name: 'docs', color: 'cccccc' }], comments: [],
  createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', url: 'https://github.com/o/r/issues/7', milestone: null,
});
const edits = (): { args: string[]; body?: string }[] => (existsSync(s.log) ? readFileSync(s.log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const ledger = () => join(s.repo, '.git', 'acc', 'ledger.json');
const task = () => (JSON.parse(readFileSync(ledger(), 'utf8')) as { tasks: { id: string; title: string; brief: string; labels: string[] }[] }).tasks.find((t) => t.id === 'GH-7')!;
const since = (tab: Tab, from: number): Msg[] => tab.posted.slice(from) as Msg[];

/** Opens the sheet for GH-7 over the Command Center, as Edit on its card does, and gives what it sent. */
async function openSheet(): Promise<TaskSheet> {
  const { calls } = s.fake;
  const from = s.tab.posted.length;
  const ran = calls.executed.length;
  s.tab.receive!({ type: 'run', command: 'acc.task.edit', ref: { project: s.root, task: 'GH-7' } });
  const asked = calls.executed.slice(ran).find(([id]) => id === 'acc.task.edit');
  if (asked) await calls.commands.get('acc.task.edit')!(...asked[1]);
  await until(() => since(s.tab, from).some((m) => m.type === TASK_SHEET_MESSAGE), 30_000, 'the sheet');
  return since(s.tab, from).find((m) => m.type === TASK_SHEET_MESSAGE)!.sheet!;
}

/** Sends the sheet's Save with what was written, and waits for how it went. */
async function save(sheet: TaskSheet, written: { title: string; brief: string }): Promise<Msg> {
  const from = s.tab.posted.length;
  s.tab.receive!({ type: 'task-sheet-go', project: s.root, task: 'GH-7', ...sheet.fields, ...written, base: sheet.ticketEdits!.base! });
  await until(() => since(s.tab, from).some((m) => m.type === TASK_SHEET_DONE), 60_000, 'Save\'s reply');
  return since(s.tab, from).find((m) => m.type === TASK_SHEET_DONE)!;
}

before(async () => {
  const { at, restore } = sandboxEnv('acc-task-sheet-ticket-', (name, at) => (name === 'gh' ? `exec "${process.execPath}" "${at('gh.mjs')}" "$@"\n` : 'exit 1\n'));
  s.restore = restore;
  writeFileSync(at('gh.mjs'), GH);
  s.issue = at('issue.json');
  s.log = at('gh-edits.log');
  writeFileSync(s.issue, issue('The title on GitHub', 'The body on GitHub.'));
  Object.assign(process.env, { FAKE_GH_ISSUE: s.issue, FAKE_GH_LOG: s.log });
  s.repo = makeRepo({
    '.acc/config.json': JSON.stringify({ schema: 1, project: 'Tool', environments: [{ name: 'main', default: true }], github: { repo: 'o/r', account: 'me' }, trackers: [{ kind: 'github', edits: true }] }),
    '.gitignore': '.claude/worktrees/\n',
  });
  const file = join(s.repo, '..', `${Date.now()}-gh7.json`);
  writeFileSync(file, JSON.stringify([{ source: { kind: 'github', key: '#7', url: 'https://github.com/o/r/issues/7' }, title: 'As intake brought it', brief: 'Old body.', labels: ['docs'] }]));
  const imported = spawnSync(process.execPath, [join(dist, '..', 'bin', 'acc.mjs'), 'import', '--file', file], { cwd: s.repo, encoding: 'utf8' });
  assert.equal(imported.status, 0, imported.stderr);
  s.fake = fakeVscode(s.repo);
  const version = (JSON.parse(readFileSync(join(dist, '..', '..', 'package.json'), 'utf8')) as { version: string }).version;
  s.started = activate(dist, s.fake, { 'acc.welcomed': true, 'acc.machineItems': { at: Date.now(), profile: 'generic', version, items: [{ id: 'A1.git', part: 'machine', title: 'git', status: 'pass', detail: '' }] } });
  const { calls, panels } = s.fake;
  await until(() => calls.contexts.get('acc.profile') === 'generic' && calls.contexts.has('acc.step.A1.git'), 60_000);
  await until(() => calls.contexts.get('acc.hasProject') === true && readdirSync(at('state', 'questions')).length > 0, 60_000);
  await calls.commands.get('acc.open.tasks')!();
  s.tab = panels[0]!;
  s.tab.receive!({ type: 'ready' });
  s.root = (s.tab.posted.at(-1) as Msg).model!.tasks!.projects[0]!.root;
});

after(() => {
  s.started?.stop();
  delete createRequire(import.meta.url).cache[dist];
  delete process.env.FAKE_GH_ISSUE;
  delete process.env.FAKE_GH_LOG;
  s.restore();
});

test('edits on: Edit opens the sheet with the issue\'s own text, and Save reaches gh issue edit, then refreshes the task from the issue (T-80)', async () => {
  const sheet = await openSheet();
  assert.deepEqual(sheet.ticketEdits?.base, { title: 'The title on GitHub', markdown: 'The body on GitHub.' }, 'read from the issue when it opened');
  assert.deepEqual([sheet.fields.title, sheet.fields.brief], ['The title on GitHub', 'The body on GitHub.'], 'not as intake brought it in');
  assert.deepEqual(sheet.ticketEdits!.rows.map((r) => [r.field, r.value]), [['status', 'Open'], ['assign', 'Nobody'], ['labels', 'docs']]);
  const done = await save(sheet, { title: 'A clearer title', brief: '- one\n- two' });
  assert.deepEqual([done.ok, done.task], [true, 'GH-7'], JSON.stringify(done));
  assert.deepEqual(edits(), [{ args: ['issue', 'edit', '7', '-R', 'o/r', '--title=A clearer title', '--body-file', '-'], body: '- one\n- two' }], 'the title as an argument, the body on stdin');
  await until(() => task().title === 'A clearer title', 30_000, 'the task refreshed from the issue');
  assert.equal(task().brief, '- one\n- two');
});

test('Save stops when the issue changed after the sheet opened: gh edits nothing, and both versions come back (T-80)', async () => {
  const sheet = await openSheet();
  const before = edits().length;
  writeFileSync(s.issue, issue('A colleague\'s title', 'A colleague\'s body.'));
  const done = await save(sheet, { title: 'My title', brief: 'My body.' });
  assert.deepEqual([done.ok, done.conflict], [false, { title: 'A colleague\'s title', markdown: 'A colleague\'s body.' }]);
  assert.equal(edits().length, before, 'nothing written');
  assert.equal(JSON.parse(readFileSync(s.issue, 'utf8')).title, 'A colleague\'s title');
  assert.equal(task().title, 'A clearer title', 'edge: the task is left as it was');
});

test('Change on the sheet\'s status goes through TicketEdits and pickField, the ticket page\'s quick pick, and sends the rows back as the issue has them (T-80)', async () => {
  const { calls } = s.fake;
  const shown: string[] = [];
  calls.pick = (items) => {
    shown.push(...items.map((i) => (i as { label: string }).label));
    return items.find((i) => (i as { label: string }).label === 'Close as completed');
  };
  const from = s.tab.posted.length;
  s.tab.receive!({ type: 'task-sheet-field', project: s.root, task: 'GH-7', field: 'status' });
  await until(() => since(s.tab, from).some((m) => m.type === TASK_SHEET_ROWS), 60_000, 'the rows');
  const r = since(s.tab, from).find((m) => m.type === TASK_SHEET_ROWS)! as Msg & { ok: boolean; rows: { field: string; value: string }[] };
  assert.deepEqual(shown, ['Close as completed', 'Close as not planned'], 'the moves an open issue can make');
  assert.deepEqual([r.ok, r.field, r.rows.find((x) => x.field === 'status')?.value], [true, 'status', 'Closed']);
  assert.deepEqual(edits().at(-1)!.args, ['issue', 'close', '7', '-R', 'o/r', '--reason', 'completed']);
  // Edge: cancelled, nothing changes and the rows come back as they are.
  calls.pick = () => undefined;
  const again = s.tab.posted.length;
  const before = edits().length;
  s.tab.receive!({ type: 'task-sheet-field', project: s.root, task: 'GH-7', field: 'status' });
  await until(() => since(s.tab, again).some((m) => m.type === TASK_SHEET_ROWS), 60_000, 'the rows again');
  const r2 = since(s.tab, again).find((m) => m.type === TASK_SHEET_ROWS)! as Msg & { ok: boolean; changed: boolean };
  assert.deepEqual([r2.ok, r2.changed, edits().length], [true, false, before]);
  calls.pick = undefined;
});
