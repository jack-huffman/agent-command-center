// Talk it through on a task's page (T-98): the conversation's model, its messages, the extension's side of
// Send, Use this and Open in Claude Code, and the page's controls: Discuss, quote, send, reply, proposal, Use this.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Analysis } from '../../packages/core/src/analyze.ts';
import { writeAnalysis } from '../../packages/core/src/analyze.ts';
import { parseConfig, type Config } from '../../packages/core/src/config.ts';
import { run } from '../../packages/core/src/exec.ts';
import { mutate, readLedger, upsertTasks } from '../../packages/core/src/ledger.ts';
import { repoPaths } from '../../packages/core/src/paths.ts';
import { CHANGE_APPROVED } from '../../packages/core/src/plan-choices.ts';
import { NOTE_APPROVED, type PlanTalk, readTalk, TALK_SESSION_VAR } from '../../packages/core/src/plan-talk.ts';
import { GENERIC_CONFIG, makeRepo, tempDir } from '../../packages/core/test/support.ts';
import { claudeArgs, talkArgs, Talks, useArgs } from '../src/logic/talk.ts';
import { isFromWebview } from '../src/model/messages.ts';
import { TALK_DONE, TALK_LOOK, TALK_NOTE, TALK_REF, TALK_WHO, ticketTalk } from '../src/model/talk.ts';
import type { TicketModel } from '../src/model/task-page.ts';
import { samplePlan, sampleAnalyses } from '../scripts/fixtures/analysis.ts';
import { sampleTalk, sampleTalkTicket, TALK_STATE } from '../scripts/fixtures/talk.ts';
import { area as talkArea } from '../src/talk.ts';
import { type PageElement, pageDom } from './page-dom.ts';

const NOW = Date.parse('2026-10-22T12:00:00Z');
const REF = { project: '/r', task: 'ACME-21' };
const plan21 = (): Analysis => sampleAnalyses(NOW)['ACME-21']!;
const model = (more: Partial<Parameters<typeof ticketTalk>[0]> = {}) =>
  ticketTalk({ task: { id: 'ACME-21', state: 'todo' }, analysis: plan21(), analyzing: false, talk: sampleTalk(NOW), running: false, open: [], ref: REF, ...more });

// ---------------------------------------------------------------- the model

test('the conversation\'s model: who and when, the quote, each proposal in words, and Use this, Send and Make a new version', () => {
  const s = model()!;
  assert.deepEqual(s.turns.map((t) => [t.name, t.icon, t.by]), [['You', 'account', 'jordan'], ['Planning agent', 'hubot', null], ['Claude Code', 'terminal', 'jordan']]);
  assert.deepEqual(s.turns[0]!.about, sampleTalk(NOW).turns[0]!.about);
  assert.deepEqual(s.turns[1]!.proposals.map((p) => [p.words, !!p.used, p.use]), [
    ['Choose Open deals only for Which converted leads get roles', false, { disabled: null }],
    ['Note on the plan: Step 3: add a test that a closed opportunity gets no role.', true, null],
  ]);
  assert.deepEqual(s.turns[2]!.recorded, ['Note on the plan: Run the backfill batch outside business hours.']);
  assert.deepEqual([s.look, s.note, s.send, s.running], [TALK_LOOK.said, TALK_NOTE, { disabled: null }, false]);
  assert.deepEqual(s.newVersion, { command: 'acc.task.analyze', label: 'Make a new version', icon: 'refresh', ref: REF });
  assert.deepEqual(s.claude, { disabled: null });
  assert.equal(TALK_WHO.plan.name, 'The plan');
  // A Claude Code session still open says so.
  assert.equal(model({ open: ['cc-acme-21'] })!.turns[2]!.open, true);
});

test('edge cases: no plan draws no section; nothing said has no Make a new version; a reply on its way, a plan being made, a stale proposal, or past the build turn things off', () => {
  assert.equal(model({ analysis: null }), null);
  const none = model({ talk: { v: 1, task: 'ACME-21', turns: [] } })!;
  assert.deepEqual([none.look, none.turns, none.newVersion], [TALK_LOOK.none, [], null]);
  const busy = model({ running: true })!;
  assert.deepEqual([busy.look, busy.send, busy.newVersion?.disabled], [TALK_LOOK.running, { disabled: 'Wait for the planning agent\'s reply.' }, 'Wait for the planning agent\'s reply.']);
  assert.equal(busy.turns[1]!.proposals[0]!.use?.disabled, 'Wait for the planning agent\'s reply.');
  assert.equal(model({ analyzing: true })!.claude?.disabled, 'Its plan is being made. Wait for it to finish.');
  // A newer plan without that option: Use this is off with why.
  const changed = samplePlan(NOW, 'changed');
  assert.equal(model({ analysis: changed })!.turns[1]!.proposals[0]!.use?.disabled, 'Open deals only isn\'t an option in the plan any more.');
  const built = model({ task: { id: 'ACME-21', state: 'running' } })!;
  assert.deepEqual([built.send, built.claude, built.newVersion, built.turns[1]!.proposals[0]!.use], [null, null, null, null]);
});

test('on an approved plan, using a proposal asks first in acc\'s words; picking what\'s chosen asks nothing', () => {
  const approved = samplePlan(NOW, 'approved');
  const talk: PlanTalk = { v: 1, task: 'ACME-21', turns: [{ id: 't1', who: 'agent', by: 'a', at: '', version: 2, text: 'x', proposals: [
    { id: 'p1', kind: 'choose', decision: 'd2', option: 'Open deals only', text: '', why: '' },
    { id: 'p2', kind: 'choose', decision: 'd2', option: 'From now on', text: '', why: '' },
    { id: 'p3', kind: 'note', text: 'n', why: '' },
  ] }] };
  assert.deepEqual(model({ analysis: approved, talk })!.turns[0]!.proposals.map((p) => p.ask), [CHANGE_APPROVED, null, NOTE_APPROVED]);
  assert.deepEqual(model({ talk })!.turns[0]!.proposals.map((p) => p.ask), [null, null, null], 'not approved: nothing to ask');
});

test('the page sends a message, Use this and Open in Claude Code; edge case: an empty message, a bad reference, or a yes that isn\'t true is refused', () => {
  const ok = (m: Record<string, unknown>) => isFromWebview({ project: '/r', task: 'ACME-21', ...m });
  assert.ok(ok({ type: 'talk-send', text: 'Why?' }));
  assert.ok(ok({ type: 'talk-send', text: 'Why?', about: 'd1.b' }));
  assert.ok(!ok({ type: 'talk-send', text: '   ' }), 'nothing to say');
  assert.ok(!ok({ type: 'talk-send', text: 'x'.repeat(4001) }));
  assert.ok(!ok({ type: 'talk-send', text: 'Why?', about: '../d1' }));
  assert.ok(ok({ type: 'talk-use', turn: 't2', proposal: 'p1' }));
  assert.ok(ok({ type: 'talk-use', turn: 't2', proposal: 'p1', yes: true }));
  assert.ok(!ok({ type: 'talk-use', turn: 't2', proposal: 'p1', yes: false }));
  assert.ok(!ok({ type: 'talk-use', turn: 'x', proposal: 'p1' }));
  assert.ok(ok({ type: 'talk-claude' }));
  assert.ok(!isFromWebview({ type: 'talk-claude', project: '/r', task: '../X' }));
  assert.deepEqual(['d1', 'd12.c', 's3', 'r1', 'q2', 'd1.', 'x1', ''].map((r) => TALK_REF.test(r)), [true, true, true, true, true, false, false, false]);
});

// ---------------------------------------------------------------- the extension's side

/** A repo with ACME-21 to do and its plan, as acc keeps them. */
function planRepo() {
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG) });
  const config = parseConfig(GENERIC_CONFIG).config as Config;
  const paths = repoPaths(dir, run);
  mutate(paths, () => new Date(NOW), (l, emit) => {
    upsertTasks(l, config, [{ source: { kind: 'jira', key: 'ACME-21' }, title: 'Contact roles missing on converted leads', brief: 'Converting a lead drops its contact roles.' }], 'human', 'human:test', emit, () => new Date(NOW));
  });
  writeAnalysis(paths, { ...plan21(), task: readLedger(paths.ledger).tasks[0]!.id });
  return { dir, paths };
}

test('acc\'s arguments keep a message\'s words as words, and Use this says yes only when told', () => {
  assert.deepEqual(talkArgs('ACME-21', '--not a flag'), ['plan', 'talk', 'ACME-21', '--message=--not a flag', '--json']);
  assert.deepEqual(talkArgs('ACME-21', 'Why?', 'd1.b'), ['plan', 'talk', 'ACME-21', '--message=Why?', '--about=d1.b', '--json']);
  assert.deepEqual(useArgs('ACME-21', 't2', 'p1'), ['plan', 'use', 'ACME-21', 't2', 'p1', '--json']);
  assert.deepEqual(useArgs('ACME-21', 't2', 'p1', true), ['plan', 'use', 'ACME-21', 't2', 'p1', '--yes', '--json']);
  assert.deepEqual(claudeArgs('ACME-21'), ['plan', 'claude', 'ACME-21', '--json']);
});

test('a message runs in the output panel, one at a time, and the page redraws as it starts and ends; a refusal says why', async () => {
  const { dir, paths } = planRepo();
  const asked: { args: string[]; label?: string }[] = [];
  let finish: (r: { code: number; stdout: string; stderr: string }) => void = () => {};
  const redraws: string[] = [];
  const talks = new Talks({
    paths: (root) => (root === dir ? paths : undefined),
    acc: (args, _cwd, label) => { asked.push({ args, label }); return new Promise((r) => { finish = r; }); },
    launch: () => {},
  }, (_root, id) => redraws.push(id));
  const going = talks.send(dir, 'acme-21', 'Why?', 'd1.b');
  assert.equal(talks.state(dir, 'ACME-21').running, true, 'the page shows it working');
  assert.deepEqual(await talks.send(dir, 'ACME-21', 'Again'), { ok: false, error: 'Wait for the planning agent\'s reply.' });
  finish({ code: 0, stdout: '{}', stderr: '' });
  assert.deepEqual(await going, { ok: true });
  assert.deepEqual(asked, [{ args: talkArgs('ACME-21', 'Why?', 'd1.b'), label: 'Talk ACME-21\'s plan through' }]);
  assert.deepEqual(redraws, ['ACME-21', 'ACME-21']);
  assert.equal(talks.state(dir, 'ACME-21').running, false);
  const refusing = new Talks({ paths: () => paths, acc: async () => ({ code: 1, stdout: JSON.stringify({ message: 'ACME-21 has no plan yet: acc analyze ACME-21.' }), stderr: '' }), launch: () => {} });
  const no = await refusing.use(dir, 'ACME-21', 't2', 'p1');
  assert.equal(no.ok, false);
  assert.doesNotMatch((no as { error: string }).error, /acc analyze/, 'in process words, never acc\'s');
  assert.deepEqual(await new Talks({ paths: () => undefined, acc: async () => ({ code: 0, stdout: '', stderr: '' }), launch: () => {} }).claude('/gone', 'ACME-21'), { ok: false, error: 'That project isn\'t open any more.' });
});

/** A stand-in for acc: `plan claude` writes the real brief with core's own openInClaude, and prints its launch. */
function fakeAcc(): string {
  const core = fileURLToPath(new URL('../../packages/core/src/', import.meta.url));
  const file = join(tempDir(), 'acc.mjs');
  writeFileSync(file, [
    `import { openInClaude } from ${JSON.stringify(join(core, 'plan-talk.ts'))};`,
    `import { parseConfig } from ${JSON.stringify(join(core, 'config.ts'))};`,
    `import { run } from ${JSON.stringify(join(core, 'exec.ts'))};`,
    `import { repoPaths } from ${JSON.stringify(join(core, 'paths.ts'))};`,
    `import { readFileSync } from 'node:fs';`,
    'const [, , what, sub, id] = process.argv;',
    `if (what !== 'plan' || sub !== 'claude') { console.log(JSON.stringify({ message: 'only plan claude' })); process.exit(1); }`,
    `const config = parseConfig(JSON.parse(readFileSync('.acc/config.json', 'utf8'))).config;`,
    `console.log(JSON.stringify(openInClaude(repoPaths(process.cwd(), run), config, id, 'human:jordan', () => new Date(), () => 'cc-test')));`,
  ].join('\n'));
  return file;
}

test('Open in Claude Code launches claude in plan mode in the main checkout, with the brief that holds the ticket, the plan and the conversation, and the page redraws when it ends', async () => {
  const { dir, paths } = planRepo();
  const terminals: { opts: Record<string, any>; sent: string[] }[] = [];
  let closed: (t: unknown) => void = () => {};
  const warned: string[] = [];
  const said: Record<string, unknown>[] = [];
  const refreshed: string[] = [];
  const code = {
    window: {
      createTerminal: (opts: Record<string, unknown>) => { const t = { opts, sent: [] as string[], show() {}, sendText(s: string) { t.sent.push(s); } }; terminals.push(t); return t; },
      onDidCloseTerminal: (f: (t: unknown) => void) => { closed = f; return { dispose() {} }; },
      showWarningMessage: (m: string) => { warned.push(m); },
    },
    ThemeIcon: class { id: string; constructor(id: string) { this.id = id; } },
  };
  const tickets: Record<string, any> = { refresh: (root: string) => refreshed.push(root), talk: null };
  talkArea.register({
    vscode: code, hub: { project: (root: string) => (root === dir ? { root: dir, ledgerPath: paths.ledger } : undefined), loadTasks: async () => {} }, tickets,
    sidebar: { helpers: {} }, accScript: fakeAcc(), subscribe: () => {},
  } as never);
  await tickets.talk.act({ type: 'talk-claude', project: dir, task: 'ACME-21' }, (m: Record<string, unknown>) => said.push(m));
  assert.deepEqual(warned, []);
  assert.deepEqual(said, [{ type: TALK_DONE, action: 'talk-claude', project: dir, task: 'ACME-21', ok: true }]);
  const t = terminals[0]!;
  assert.equal(t.opts.cwd, paths.root, 'the project\'s main checkout');
  assert.deepEqual(t.opts.env, { [TALK_SESSION_VAR]: 'ACME-21:cc-test' }, 'what it records lands on its turn');
  assert.match(t.sent[0]!, /^claude --permission-mode plan --session-id cc-test --name '.+ · plan' --allowedTools Read Grep Glob 'Bash\(acc plan choose ACME-21:\*\)'/);
  const brief = /Read (\/[^']+\.brief\.md) first/.exec(t.sent[0]!)![1]!;
  const text = readFileSync(brief, 'utf8');
  assert.match(text, /# ACME-21: Contact roles missing on converted leads/, 'the ticket');
  assert.match(text, /### d2\. Which converted leads get roles/, 'the latest plan');
  assert.match(text, /acc plan note ACME-21/, 'how to record to it');
  assert.equal(tickets.talk.state(dir, 'ACME-21').open[0], 'cc-test', 'open now');
  assert.equal(readTalk(paths, 'ACME-21').turns[0]!.who, 'claude-code');
  closed(t);
  assert.deepEqual(tickets.talk.state(dir, 'ACME-21').open, [], 'ended');
  assert.ok(refreshed.length >= 3, 'the page redraws as it opens, after, and when it ends');
  // A refusal shows as a warning and on the page.
  said.length = 0;
  await tickets.talk.act({ type: 'talk-use', project: dir, task: 'ACME-21', turn: 't1', proposal: 'p1' }, (m: Record<string, unknown>) => said.push(m));
  assert.equal(said[0]!.ok, false);
  assert.equal(warned.length, 1);
});

// ---------------------------------------------------------------- the page itself

const page = pageDom();
let kept: unknown;
(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: (m: unknown) => { page.sent.push(m); }, getState: () => kept, setState: (s: unknown) => { kept = s; } });
const { renderTalk, discussButton, talkPending, sendKey, useKey, kindOf, area } = await import('../webview/talk.ts');
const { planDecisions } = await import('../webview/plan.ts');
const { state } = await import('../webview/state.ts');

const buttons = (e: PageElement, label: string): PageElement[] => e.all().filter((x) => x.tagName === 'BUTTON' && x.textContent === label);
const drawn = () => new Promise<void>((r) => queueMicrotask(r));
const done = (msg: Record<string, unknown>) => (area.receive![TALK_DONE] as (m: unknown) => void)(msg);
const draw = (m: TicketModel) => renderTalk(m, m.talk!) as unknown as PageElement;

test('the conversation draws each turn with who and when, the quoted option, and its proposals; the next message\'s quote comes from memory', () => {
  kept = { opened: [], drafts: { ...TALK_STATE.drafts } };
  const m = sampleTalkTicket(NOW);
  const s = draw(m);
  const turns = s.all('talk-turn');
  assert.deepEqual(turns.map((t) => t.getAttribute('aria-label')), ['You (jordan)', 'Planning agent', 'Claude Code']);
  assert.match(turns[0]!.all('talk-quote')[0]!.textContent, /^Option d2\.b: Which converted leads get roles: Backfill too/);
  assert.equal(turns[1]!.all('talk-proposal').length, 2);
  assert.match(turns[1]!.all('talk-proposal')[1]!.textContent, /Used.*by jordan/);
  assert.match(turns[2]!.textContent, /It recorded.*Run the backfill batch/);
  assert.match(s.all('talk-about')[0]!.textContent, /Option d1\.a: Where the contact roles are made/);
  assert.equal(s.all('talk-box')[0]!.dataset.keep, sendKey(m.project, 'ACME-21'));
  assert.deepEqual(['d1', 'd1.a', 's1', 'r2', 'q1'].map(kindOf), ['choice', 'option', 'step', 'risk', 'question']);
});

test('Discuss on an option opens the conversation with it quoted and the cursor in the box; Send sends the words with what they\'re about, and a reply clears them', async () => {
  kept = { opened: [], drafts: {} };
  state.draw = () => {};
  const m = { ...sampleTalkTicket(NOW), talk: model({ talk: { v: 1, task: 'ACME-21', turns: [] } }) };
  assert.equal(draw(m).all('talk-turns').length + draw(m).all('talk-box').length, 0, 'closed: just Talk it through');
  assert.equal(buttons(draw(m), 'Talk it through').length, 1);
  const discuss = (planDecisions(m, 'ACME-21', m.analysis!.planState!) as unknown as PageElement).all('talk-discuss');
  const option = discuss.find((b) => b.getAttribute('aria-label') === 'Discuss Backfill too, for Which converted leads get roles')!;
  assert.ok(option, 'each option has Discuss, named for what it\'s about');
  option.click();
  const open = draw(m);
  const box = open.all('talk-box')[0]!;
  assert.match(open.all('talk-about')[0]!.textContent, /Option d2\.b: Which converted leads get roles: Backfill too/);
  await drawn();
  assert.equal(page.document.activeElement, box, 'the cursor is in the box');
  const send = buttons(open, 'Send')[0]!;
  assert.equal(send.disabled, true, 'nothing typed: nothing to send');
  (box as unknown as { value: string }).value = 'Would leaving them out break the quarterly report?';
  for (const f of box.listeners.get('input') ?? []) f({});
  page.sent.length = 0;
  send.click();
  assert.deepEqual(page.sent, [{ type: 'talk-send', project: m.project, task: 'ACME-21', text: 'Would leaving them out break the quarterly report?', about: 'd2.b' }]);
  assert.match(buttons(draw(m), 'Sending…')[0]!.textContent, /Sending…/);
  done({ action: 'talk-send', project: m.project, task: 'ACME-21', ok: true });
  assert.equal(talkPending.what(sendKey(m.project, 'ACME-21')), undefined);
  const after = draw(m);
  assert.equal(after.all('talk-about').length, 0, 'the quote is cleared');
  assert.equal((after.all('talk-box')[0] as unknown as { value: string }).value, '', 'and the words');
});

test('edge case: a message that didn\'t go keeps its words and says why; Discuss is gone past the build', () => {
  kept = { opened: [], drafts: { [sendKey('/Users/me/code/acme-service', 'ACME-21')]: 'Why?' } };
  const m = sampleTalkTicket(NOW);
  page.sent.length = 0;
  buttons(draw(m), 'Send')[0]!.click();
  done({ action: 'talk-send', project: m.project, task: 'ACME-21', ok: false, error: 'The planning agent is still answering.' });
  const s = draw(m);
  assert.match(s.textContent, /Your message didn't go: The planning agent is still answering\./);
  assert.equal((s.all('talk-box')[0] as unknown as { value: string }).value, 'Why?');
  const built = { ...m, talk: { ...m.talk!, send: null } };
  assert.equal((planDecisions(built, 'ACME-21', built.analysis!.planState!) as unknown as PageElement).all('talk-discuss').length, 0);
  assert.equal(draw(built).all('talk-box').length, 0);
});

test('Use this sends the proposal; on an approved plan it asks first, Keep the approval sends nothing, and Change it sends it with a yes', async () => {
  kept = { opened: [], drafts: {} };
  const m = sampleTalkTicket(NOW);
  page.sent.length = 0;
  buttons(draw(m), 'Use this')[0]!.click();
  assert.deepEqual(page.sent, [{ type: 'talk-use', project: m.project, task: 'ACME-21', turn: 't2', proposal: 'p1' }]);
  assert.equal(buttons(draw(m), 'Recording…').length, 1);
  done({ action: 'talk-use', project: m.project, task: 'ACME-21', turn: 't2', proposal: 'p1', ok: true });
  assert.equal(talkPending.what(useKey(m.project, 'ACME-21', 't2', 'p1')), undefined);
  // Approved: it asks, in acc's words.
  const approved = { ...m, talk: model({ analysis: samplePlan(NOW, 'approved') }) };
  page.sent.length = 0;
  buttons(draw(approved), 'Use this')[0]!.click();
  assert.deepEqual(page.sent, [], 'nothing goes before the person says');
  const asked = draw(approved).all('plan-confirm')[0]!;
  assert.equal(asked.getAttribute('role'), 'alertdialog');
  assert.equal(asked.all('pc-text')[0]!.textContent, CHANGE_APPROVED);
  await drawn();
  assert.equal(page.document.activeElement, buttons(asked, 'Keep the approval')[0]);
  buttons(asked, 'Keep the approval')[0]!.click();
  assert.equal(draw(approved).all('plan-confirm').length, 0);
  assert.deepEqual(page.sent, []);
  buttons(draw(approved), 'Use this')[0]!.click();
  buttons(draw(approved).all('plan-confirm')[0]!, 'Change it')[0]!.click();
  assert.deepEqual(page.sent, [{ type: 'talk-use', project: m.project, task: 'ACME-21', turn: 't2', proposal: 'p1', yes: true }]);
  done({ action: 'talk-use', project: m.project, task: 'ACME-21', turn: 't2', proposal: 'p1', ok: false, error: 'It changed.' });
  assert.match(draw(approved).textContent, /It wasn't recorded: It changed\./);
});

test('Make a new version runs the plan again, and Open in Claude Code asks for it; neither shows past the build', () => {
  kept = { opened: [], drafts: {} };
  const m = sampleTalkTicket(NOW);
  page.sent.length = 0;
  buttons(draw(m), 'Make a new version')[0]!.click();
  buttons(draw(m), 'Open in Claude Code')[0]!.click();
  assert.deepEqual(page.sent, [
    { type: 'run', command: 'acc.task.analyze', ref: { project: m.project, task: 'ACME-21' } },
    { type: 'talk-claude', project: m.project, task: 'ACME-21' },
  ]);
  assert.equal(buttons(draw(m), 'Opening…').length, 1);
  done({ action: 'talk-claude', project: m.project, task: 'ACME-21', ok: true });
  const built = { ...m, talk: { ...m.talk!, newVersion: null, claude: null, send: null } };
  assert.equal(buttons(draw(built), 'Make a new version').length + buttons(draw(built), 'Open in Claude Code').length, 0);
  assert.ok(discussButton('/r', 'ACME-21', 'd1', 'x', 'the choice x'), 'Discuss is built on its own');
});
