// A plan's conversation in its own panel (T-111), in the built extension against the vscode stand-in: Make a plan
// opens it for a task with no plan, beside the task's page, or as a tab when that page is narrow; Discuss's quote
// reaches it once it's ready; and a change redraws the panel and the page alike. Run after npm run build.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makeRepo } from '../../packages/core/test/support.ts';
import { analyze, readAnalysis } from '../../packages/core/src/analyze.ts';
import { parseConfig, type Config } from '../../packages/core/src/config.ts';
import { run as runCommand, type RunOptions, type RunResult } from '../../packages/core/src/exec.ts';
import { readLedger } from '../../packages/core/src/ledger.ts';
import { repoPaths } from '../../packages/core/src/paths.ts';
import { startPlan } from '../../packages/core/src/plan-opening.ts';
import { NOTE_APPROVED, talkPlan } from '../../packages/core/src/plan-talk.ts';
import { fakeRunner } from '../../packages/core/test/support.ts';
import { activate, fakeVscode, sandboxEnv, until } from './vscode.ts';

const dist = fileURLToPath(new URL('../dist/extension.js', import.meta.url));

type Tab = ReturnType<typeof fakeVscode>['panels'][number];
type Msg = { type?: string; model?: { kind: string; key: string; title: string; loading?: boolean; filling?: boolean; talk?: { stage: string; ask: string | null; send: unknown } | null }; [k: string]: unknown };

/** What the stand-in for Claude Code answers a message with, as its schema asks. */
const TALK_ANSWER = { type: 'result', subtype: 'success', is_error: false, session_id: 'sess-open', total_cost_usd: 0.1, structured_output: { reply: 'Two years, as you said.', proposals: [] } };

const s = {} as { fake: ReturnType<typeof fakeVscode>; started: ReturnType<typeof activate>; repo: string; root: string; tab: Tab; id: string; restore: () => void; acc: (...a: string[]) => void };

before(async () => {
  const { at, restore } = sandboxEnv('acc-conversation-', (name) => (name === 'claude' ? `case "$*" in *--json-schema*) echo '${JSON.stringify(TALK_ANSWER)}';; *) exit 1;; esac\n` : 'exit 1\n'));
  s.restore = restore;
  s.repo = makeRepo({ '.acc/config.json': JSON.stringify({ schema: 1, project: 'Tool', environments: [{ name: 'main', default: true }], trackers: [] }), '.gitignore': '.claude/worktrees/\n' });
  s.fake = fakeVscode(s.repo);
  const version = (JSON.parse(readFileSync(join(dist, '..', '..', 'package.json'), 'utf8')) as { version: string }).version;
  s.started = activate(dist, s.fake, { 'acc.welcomed': true, 'acc.machineItems': { at: Date.now(), profile: 'generic', version, items: [{ id: 'A1.git', part: 'machine', title: 'git', status: 'pass', detail: '' }] } });
  const { calls, panels } = s.fake;
  await until(() => calls.contexts.get('acc.profile') === 'generic' && calls.contexts.has('acc.step.A1.git'), 60_000);
  await until(() => calls.contexts.get('acc.hasProject') === true && readdirSync(at('state', 'questions')).length > 0, 60_000);
  const accBin = join(dist, '..', 'bin', 'acc.mjs');
  s.acc = (...a: string[]) => {
    const r = spawnSync(process.execPath, [accBin, ...a], { cwd: s.repo, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr || r.stdout);
  };
  s.acc('add', 'Write the report');
  await calls.commands.get('acc.tasks.refresh')!();
  await calls.commands.get('acc.open.tasks')!();
  s.tab = panels[0]!;
  s.tab.receive!({ type: 'ready' });
  const home = s.tab.posted.at(-1) as { model: { tasks: { projects: { root: string; columns: { cards: { id: string }[] }[] }[] } } };
  const p = home.model.tasks.projects[0]!;
  s.root = p.root;
  s.id = p.columns.flatMap((c) => c.cards.map((x) => x.id))[0]!;
});

after(() => {
  s.started?.stop();
  delete createRequire(import.meta.url).cache[dist];
  s.restore();
});

const stateFor = (msgs: Msg[], key: string, kind: string): Msg | undefined => msgs.filter((m) => m.type === 'state' && m.model?.kind === kind && m.model.key === key && !m.model.loading && !m.model.filling).at(-1);

/** The task's own page, as acc.task.show opens it, ready, and how wide it says it is. */
async function pageFor(key: string, width: number): Promise<Tab> {
  const { calls, panels } = s.fake;
  const from = calls.executed.length;
  s.tab.receive!({ type: 'run', command: 'acc.task.show', ref: { project: s.root, task: key } });
  const [, args] = calls.executed.slice(from).find(([id]) => id === 'acc.task.show')!;
  const n = panels.length;
  await calls.commands.get('acc.task.show')!(...args);
  const page = panels.length > n ? panels.at(-1)! : panels.find((x) => x.viewType === 'acc.ticket' && x.html.includes(`<title>${key}</title>`))!;
  page.receive!({ type: 'ready' });
  await until(() => !!stateFor(page.posted as Msg[], key, 'ticket'));
  page.receive!({ type: 'page-width', project: s.root, task: key, width });
  return page;
}

/** The conversation's panel the last open made, ready, with its first model. */
async function panelOpened(n: number, key = s.id): Promise<Tab> {
  await until(() => s.fake.panels.length > n);
  const panel = s.fake.panels.at(-1)!;
  panel.receive!({ type: 'ready' });
  await until(() => !!stateFor(panel.posted as Msg[], key, 'conversation'));
  return panel;
}

test('ConversationPanels: Make a plan for a task with no plan opens its conversation beside the page, at its question; again, the same panel comes forward with the quote', async () => {
  const page = await pageFor(s.id, 1400);
  const n = s.fake.panels.length;
  const from = s.fake.calls.executed.length;
  page.receive!({ type: 'run', command: 'acc.task.analyze', ref: { project: s.root, task: s.id } });
  // The page asks for Make a plan; the stand-in records the command, and runs it as VS Code would.
  await until(() => s.fake.calls.executed.slice(from).some(([id]) => id === 'acc.task.analyze'));
  const [, args] = s.fake.calls.executed.slice(from).find(([id]) => id === 'acc.task.analyze')!;
  await s.fake.calls.commands.get('acc.task.analyze')!(...args);
  const panel = await panelOpened(n);
  assert.deepEqual([panel.viewType, panel.title, panel.column], ['acc.conversation', `${s.id} · Plan conversation`, s.fake.api.ViewColumn.Beside]);
  assert.match(panel.html, /data-view="conversation"/);
  const m = stateFor(panel.posted as Msg[], s.id, 'conversation')!.model!;
  assert.deepEqual([m.title, m.talk?.stage, m.talk?.ask], [`${s.id} · Plan conversation`, 'opening', 'What do you want to do here, and what are you thinking?']);
  // Again: the same panel comes forward, and no second one opens.
  page.receive!({ type: 'conversation-open', project: s.root, task: s.id, about: { ref: 'd1', text: 'Where the report lives' } });
  await until(() => panel.revealed > 0);
  assert.equal(s.fake.panels.length, n + 1);
  await until(() => (panel.posted as Msg[]).some((x) => x.type === 'conversation-quote'));
  assert.deepEqual((panel.posted as Msg[]).filter((x) => x.type === 'conversation-quote').at(-1), { type: 'conversation-quote', project: s.root, task: s.id, ref: 'd1', text: 'Where the report lives' });
  panel.close!();
  page.close!();
});

test('edge case: on a page narrower than the two would share, the conversation opens as a tab of its own', async () => {
  const page = await pageFor(s.id, 620);
  const n = s.fake.panels.length;
  page.receive!({ type: 'conversation-open', project: s.root, task: s.id });
  const panel = await panelOpened(n);
  assert.equal(panel.column, s.fake.api.ViewColumn.Active);
  panel.close!();
  page.close!();
});

test('a change shows in the panel and on the page at once: the task blocked, the conversation can\'t be added to in either', async () => {
  const page = await pageFor(s.id, 1400);
  const n = s.fake.panels.length;
  page.receive!({ type: 'conversation-open', project: s.root, task: s.id });
  const panel = await panelOpened(n);
  const pageFrom = page.posted.length;
  const panelFrom = panel.posted.length;
  s.acc('set', s.id, 'blocked', '--reason', 'Waiting on the numbers');
  await s.fake.calls.commands.get('acc.tasks.refresh')!();
  await until(() => stateFor(panel.posted.slice(panelFrom) as Msg[], s.id, 'conversation')?.model?.talk === null);
  await until(() => !!stateFor(page.posted.slice(pageFrom) as Msg[], s.id, 'ticket'));
  assert.equal(stateFor(page.posted.slice(pageFrom) as Msg[], s.id, 'ticket')!.model!.talk ?? null, null, 'the page agrees');
  s.acc('set', s.id, 'todo');
  await s.fake.calls.commands.get('acc.tasks.refresh')!();
  await until(() => stateFor(panel.posted as Msg[], s.id, 'conversation')?.model?.talk?.stage === 'opening');
  panel.close!();
  page.close!();
});

/** Make a plan, run from the Command Center's tab (the board or its modal), as VS Code would run it. */
async function makePlanFrom(host: Tab, key: string): Promise<void> {
  const from = s.fake.calls.executed.length;
  host.receive!({ type: 'run', command: 'acc.task.analyze', ref: { project: s.root, task: key } });
  await until(() => s.fake.calls.executed.slice(from).some(([id]) => id === 'acc.task.analyze'));
  const [, args] = s.fake.calls.executed.slice(from).find(([id]) => id === 'acc.task.analyze')!;
  await s.fake.calls.commands.get('acc.task.analyze')!(...args);
}

test('Make a plan from the board\'s modal opens the ticket\'s page first and the panel beside it, and the modal closes onto the pair', async () => {
  const { panels, api } = s.fake;
  const n = panels.length;
  const from = s.tab.posted.length;
  s.tab.receive!({ type: 'task-modal-open', project: s.root, key: s.id });
  await until(() => (s.tab.posted.slice(from) as Msg[]).some((m) => m.type === 'task-modal' && m.model?.key === s.id && !m.model.loading && !m.model.filling));
  await makePlanFrom(s.tab, s.id);
  await until(() => panels.length >= n + 2);
  const [page, panel] = [panels[n]!, panels[n + 1]!];
  assert.deepEqual([page.viewType, page.column, panel.viewType, panel.column], ['acc.ticket', api.ViewColumn.Active, 'acc.conversation', api.ViewColumn.Beside]);
  assert.deepEqual((s.tab.posted.slice(from) as Msg[]).filter((m) => m.type === 'task-modal-shut'), [{ type: 'task-modal-shut', project: s.root, key: s.id }], 'the modal is asked to close, once');
  // The modal is gone for the extension too: a redraw after this draws only the tab.
  const after = s.tab.posted.length;
  await s.fake.calls.commands.get('acc.tasks.refresh')!();
  assert.ok(!(s.tab.posted.slice(after) as Msg[]).some((m) => m.type === 'task-modal'), 'nothing draws the closed modal again');
  panel.close!();
  page.close!();
});

test('edge case: Make a plan from the board with no page and no modal open still opens the ticket\'s page; with the page already open, no second one opens', async () => {
  const { panels, api } = s.fake;
  const n = panels.length;
  await makePlanFrom(s.tab, s.id);
  await until(() => panels.length >= n + 2);
  const [page, panel] = [panels[n]!, panels[n + 1]!];
  assert.deepEqual([page.viewType, page.title, page.column, panel.viewType, panel.column], ['acc.ticket', s.id, api.ViewColumn.Active, 'acc.conversation', api.ViewColumn.Beside]);
  panel.close!();
  assert.deepEqual(panels.slice(n).map((x) => x.viewType), ['acc.ticket', 'acc.conversation'], 'one page and one panel opened');
  // The page is open now: Open conversation opens the panel beside it and no second page.
  const m = panels.length;
  page.receive!({ type: 'ready' });
  page.receive!({ type: 'page-width', project: s.root, task: s.id, width: 1400 });
  page.receive!({ type: 'conversation-open', project: s.root, task: s.id });
  await until(() => panels.length > m);
  assert.deepEqual(panels.slice(m).map((x) => x.viewType), ['acc.conversation'], 'only the panel opens');
  panels.at(-1)!.close!();
  page.close!();
});

test('the panel and the page agree: Use this and a message in the panel show on the page\'s plan and line; approving on the page shows in the panel', async () => {
  const result = (structured: unknown): RunResult => ({ code: 0, stderr: '', stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 'sess-open', structured_output: structured }) });
  const PLAN = {
    verdict: 'ready', summary: 'A custom object keeps each change.', requirements: { goal: '', criteria: [], assumptions: [], outOfScope: [] }, questions: [], findings: [], split: [],
    decisions: [{ title: 'Where history is kept', why: 'Two years.', options: [
      { id: '', name: 'Field history', means: '', pros: [], cons: ['18 months only'], effort: 'S', risks: [], touches: [] },
      { id: '', name: 'Custom object', means: '', pros: [], cons: ['More to build'], effort: 'M', risks: [], touches: [] },
    ], recommended: 'Custom object', because: 'Two years.' }],
    approach: { plan: ['Make Stage_History__c'], files: [], refactors: [], risks: [], tests: [], size: 'M' },
  };
  const proposals = [{ kind: 'choose', decision: 'd1', option: 'Custom object', why: 'Two years of history.' }, { kind: 'note', text: 'Keep it for the pipeline report.', why: 'So the plan says why.' }];
  const answers = [{ understood: 'Two years.', unsure: [], questions: [] }, PLAN, { reply: 'Use a custom object.', proposals }];
  let calls = 0;
  const fake = fakeRunner({});
  const run = (cmd: string, args: string[], opts?: RunOptions): RunResult => (cmd === 'claude' ? result(answers[calls++]!) : fake(cmd, args, opts));
  // A second task, with its plan made and one reply that proposes a choice and a note, by core's own functions.
  s.acc('add', 'Keep the stage history');
  const config = parseConfig(JSON.parse(readFileSync(join(s.repo, '.acc', 'config.json'), 'utf8'))).config as Config;
  const paths = repoPaths(s.repo, runCommand);
  const key = readLedger(paths.ledger).tasks.at(-1)!.id;
  const deps = { run, now: () => new Date(), env: {} };
  startPlan(paths, config, key, 'Two years.', { ...deps, uuid: () => 'sess-open' }, 'human:me');
  analyze(paths, config, key, deps);
  talkPlan(paths, config, key, 'Where should it live?', null, deps, 'human:me');
  assert.equal(calls, 3, 'the stand-in answered each of the three');
  await s.fake.calls.commands.get('acc.tasks.refresh')!();
  const page = await pageFor(key, 1400);
  const n = s.fake.panels.length;
  page.receive!({ type: 'conversation-open', project: s.root, task: key });
  const panel = await panelOpened(n, key);
  type Proposal = { id: string; used: unknown; ask: string | null };
  const talkOf = (tab: Tab, kind: 'ticket' | 'conversation', from = 0) => stateFor(tab.posted.slice(from) as Msg[], key, kind)?.model?.talk as { line: { words: string } | null; turns: { id: string; proposals: Proposal[] }[] } | undefined;
  const turn = talkOf(panel, 'conversation')!.turns.find((t) => t.proposals.length)!;
  assert.deepEqual([talkOf(page, 'ticket')!.line?.words, turn.proposals.map((p) => p.used)], ['Conversation · 4 messages', [null, null]], 'both start with the four messages and the proposals unused');
  // Use this, in the panel: the plan has the choice, and the panel and the page both say so.
  const pageFrom = page.posted.length;
  panel.receive!({ type: 'talk-use', project: s.root, task: key, turn: turn.id, proposal: turn.proposals[0]!.id });
  await until(() => readAnalysis(paths, key)?.decisions?.[0]?.choice !== undefined);
  const d1 = readAnalysis(paths, key)!.decisions![0]!;
  assert.equal(d1.choice!.option, d1.options.find((o) => o.name === 'Custom object')!.id, 'the plan has the proposed option');
  await until(() => !!talkOf(panel, 'conversation')!.turns.find((t) => t.id === turn.id)!.proposals[0]!.used);
  await until(() => !!talkOf(page, 'ticket', pageFrom)?.turns.find((t) => t.id === turn.id)?.proposals[0]?.used);
  // A message, in the panel: the page's line counts it too.
  const panelFrom = panel.posted.length;
  const sentFrom = page.posted.length;
  panel.receive!({ type: 'talk-send', project: s.root, task: key, text: 'Why a custom object?' });
  await until(() => talkOf(panel, 'conversation', panelFrom)?.line?.words === 'Conversation · 6 messages', 30_000);
  await until(() => talkOf(page, 'ticket', sentFrom)?.line?.words === 'Conversation · 6 messages', 30_000);
  // Approve, on the page (Review plan's last step): the panel's note, not yet used, now asks first.
  assert.equal(talkOf(panel, 'conversation')!.turns.find((t) => t.id === turn.id)!.proposals[1]!.ask, null, 'before it, the note asks nothing');
  const approveFrom = panel.posted.length;
  page.receive!({ type: 'plan-approve', project: s.root, task: key });
  await until(() => talkOf(panel, 'conversation', approveFrom)?.turns.find((t) => t.id === turn.id)?.proposals[1]?.ask === NOTE_APPROVED, 30_000);
  panel.close!();
  page.close!();
});
