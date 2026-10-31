// Talk it through (T-98), drawn in the conversation's panel since T-111: the conversation's model, its messages, the extension's side of
// Send, Use this and Open in Claude Code, and the page's controls: Discuss, quote, send, reply, proposal, Use this.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Analysis } from '../../packages/core/src/analyze.ts';
import { writeAnalysis } from '../../packages/core/src/analyze.ts';
import { parseConfig, type Config } from '../../packages/core/src/config.ts';
import { run } from '../../packages/core/src/exec.ts';
import { mutate, readLedger, upsertTasks } from '../../packages/core/src/ledger.ts';
import { repoPaths } from '../../packages/core/src/paths.ts';
import { CHANGE_APPROVED } from '../../packages/core/src/plan-choices.ts';
import { NOTE_APPROVED, type PlanTalk, proposalStale, readTalk, TALK_SESSION_VAR } from '../../packages/core/src/plan-talk.ts';
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

/** ACME-21's conversation as if it was had on version `v` of the plan. */
const atVersion = (v: number): PlanTalk => { const t = sampleTalk(NOW); for (const x of t.turns) x.version = v; return t; };

// ---------------------------------------------------------------- the model

test('the conversation\'s model: who and when, the quote, each proposal in words, and Use this, Send and Make a new plan', () => {
  const s = model()!;
  assert.deepEqual(s.turns.map((t) => [t.name, t.icon, t.by]), [['You', 'account', 'jordan'], ['Planning agent', 'hubot', null], ['Claude Code', 'terminal', 'jordan']]);
  assert.deepEqual(s.turns[0]!.about, sampleTalk(NOW).turns[0]!.about);
  assert.deepEqual(s.turns[1]!.proposals.map((p) => [p.words, !!p.used, p.use]), [
    ['Choose Open deals only for Which converted leads get roles', false, { disabled: null }],
    ['Note on the plan: Step 3: add a test that a closed opportunity gets no role.', true, null],
  ]);
  assert.deepEqual(s.turns[2]!.recorded, ['Note on the plan: Run the backfill batch outside business hours.']);
  assert.deepEqual([s.look, s.note, s.send, s.running], [TALK_LOOK.said, TALK_NOTE, { disabled: null }, false]);
  assert.deepEqual(s.newPlan, { command: 'acc.task.analyze', label: 'Make a new plan', icon: 'refresh', ref: REF });
  assert.deepEqual(s.turns[1]!.proposals.map((p) => p.from), [null, null], 'made on the plan as it is now');
  assert.deepEqual(s.claude, { disabled: null });
  assert.equal(TALK_WHO.plan.name, 'The plan');
  // A Claude Code session still open says so.
  assert.equal(model({ open: ['cc-acme-21'] })!.turns[2]!.open, true);
});

test('edge cases: no plan past the build with nothing said is no conversation; nothing said has no Make a new plan; a reply on its way, a plan being made, a stale proposal, or past the build turn things off', () => {
  assert.equal(model({ analysis: null, task: { id: 'ACME-21', state: 'running' }, talk: { v: 1, task: 'ACME-21', turns: [] } }), null);
  assert.equal(model({ analysis: null })!.stage, 'opening', 'with no plan, the conversation before it (T-111)');
  const none = model({ talk: { v: 1, task: 'ACME-21', turns: [] } })!;
  assert.deepEqual([none.look, none.turns, none.newPlan], [TALK_LOOK.none, [], null]);
  const busy = model({ running: true })!;
  assert.deepEqual([busy.look, busy.send, busy.newPlan?.disabled], [TALK_LOOK.running, { disabled: 'Wait for the planning agent\'s reply.' }, 'Wait for the planning agent\'s reply.']);
  assert.equal(busy.turns[1]!.proposals[0]!.use?.disabled, 'Wait for the planning agent\'s reply.');
  assert.equal(model({ analyzing: true })!.claude?.disabled, 'Its plan is being made. Wait for it to finish.');
  // A newer version: a proposal made on v1 is off with why, and shows it's from v1; a used one isn't.
  const changed = samplePlan(NOW, 'changed');
  const old = model({ analysis: changed })!.turns[1]!.proposals;
  assert.deepEqual([old[0]!.use?.disabled, old[0]!.from, old[1]!.from], [proposalStale(1, 3), 1, null]);
  // On that version, an option it no longer has is off with why.
  assert.equal(model({ analysis: changed, talk: atVersion(3) })!.turns[1]!.proposals[0]!.use?.disabled, 'Open deals only isn\'t an option in the plan any more.');
  const built = model({ task: { id: 'ACME-21', state: 'running' } })!;
  assert.deepEqual([built.send, built.claude, built.newPlan, built.turns[1]!.proposals[0]!.use], [null, null, null, null]);
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
    `import { openInClaude } from ${JSON.stringify(pathToFileURL(join(core, 'plan-talk.ts')).href)};`,
    `import { parseConfig } from ${JSON.stringify(pathToFileURL(join(core, 'config.ts')).href)};`,
    `import { run } from ${JSON.stringify(pathToFileURL(join(core, 'exec.ts')).href)};`,
    `import { repoPaths } from ${JSON.stringify(pathToFileURL(join(core, 'paths.ts')).href)};`,
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
  talkArea.register!({
    vscode: code, hub: { project: (root: string) => (root === dir ? { root: dir, ledgerPath: paths.ledger } : undefined), loadTasks: async () => {} }, tickets,
    sidebar: { helpers: {} }, accScript: fakeAcc(), subscribe: () => {},
  } as never);
  await tickets.talk.act({ type: 'talk-claude', project: dir, task: 'ACME-21' }, (m: Record<string, unknown>) => said.push(m));
  assert.deepEqual(warned, []);
  assert.deepEqual(said as unknown[], [{ type: TALK_DONE, action: 'talk-claude', project: dir, task: 'ACME-21', ok: true }]);
  const t = terminals[0]!;
  assert.equal(t.opts.cwd, paths.root, 'the project\'s main checkout');
  assert.deepEqual(t.opts.env, { [TALK_SESSION_VAR]: 'ACME-21:cc-test' }, 'what it records lands on its turn');
  // The brief's path as this system spells it (C:\… on Windows), in sh's quotes: the terminal runs an sh there too (terminalShell).
  assert.match(t.sent[0]!, /^claude 'Read .+' --permission-mode plan --session-id cc-test --name '.+ · plan' --allowedTools Read Grep Glob$/);
  assert.doesNotMatch(t.sent[0]!, /Bash\(acc/, 'no command that records to the plan runs without asking the person');
  const brief = /Read ([^']+\.brief\.md) first/.exec(t.sent[0]!)![1]!;
  assert.ok(isAbsolute(brief), brief);
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
const { renderConversation, discussButton, earlierKey, openTalk, talkPending, sendKey, useKey, kindOf, area } = await import('../webview/talk.ts');
const { planDecisions } = await import('../webview/plan.ts');
const { state } = await import('../webview/state.ts');

// A button by its words, or by its name where it has only an icon, such as the message card's Send (T-160).
const buttons = (e: PageElement, label: string): PageElement[] => e.all().filter((x) => x.tagName === 'BUTTON' && (x.textContent || x.getAttribute('aria-label')) === label);
const drawn = () => new Promise<void>((r) => queueMicrotask(r));
const done = (msg: Record<string, unknown>) => (area.receive![TALK_DONE] as (m: unknown) => void)(msg);
const draw = (m: TicketModel) => renderConversation(m.project, m.talk!) as unknown as PageElement;

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
  // Later: a version made from the conversation says what changed, and a message waits for its reply.
  kept = { opened: [earlierKey(m.project, 'ACME-21')], drafts: {} };
  const later = draw(sampleTalkTicket(NOW, true));
  const made = later.all('who-plan')[0]!;
  assert.match(made.textContent, /Made v2 from this conversation\.What changed.*New question/);
  assert.match(later.all('talk-waiting')[0]!.textContent, /The planning agent is reading the code to reply/);
  assert.equal(buttons(later, 'Send')[0]!.disabled, true, 'nothing more goes while it replies');
});

test('Discuss on an option opens the conversation with it quoted and the cursor in the box; Send sends the words with what they\'re about, and a reply clears them', async () => {
  kept = { opened: [], drafts: {} };
  state.draw = () => {};
  const m = { ...sampleTalkTicket(NOW), talk: model({ talk: { v: 1, task: 'ACME-21', turns: [] } }) };
  assert.equal(draw(m).all('talk-turns').length, 0, 'nothing said yet');
  assert.deepEqual([draw(m).all('talk-box').length, draw(m).all('talk-about').length], [1, 0], 'its panel opens with the box, nothing quoted');
  // Talk it through, on the plan, asks for the panel, with nothing quoted (T-111).
  page.sent.length = 0;
  openTalk(m.project, 'ACME-21');
  assert.deepEqual(page.sent, [{ type: 'conversation-open', project: m.project, task: 'ACME-21' }]);
  const discuss = (planDecisions(m, 'ACME-21', m.analysis!.planState!) as unknown as PageElement).all('talk-discuss');
  const option = discuss.find((b) => b.getAttribute('aria-label') === 'Discuss Backfill too, for Which converted leads get roles')!;
  assert.ok(option, 'each option has Discuss, named for what it\'s about');
  page.sent.length = 0;
  option.click();
  const quote = { ref: 'd2.b', text: 'Which converted leads get roles: Backfill too' };
  assert.deepEqual(page.sent, [{ type: 'conversation-open', project: m.project, task: 'ACME-21', about: quote }], 'Discuss opens the panel with the option quoted');
  assert.equal(isFromWebview(page.sent[0]), true);
  // The panel is told the quote once it's ready.
  (area.receive!['conversation-quote'] as (m: unknown) => void)({ type: 'conversation-quote', project: m.project, task: 'ACME-21', ...quote });
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
  assert.equal(buttons(draw(m), 'Sending…').length, 1, 'Send says it is sending');
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
  const approved = { ...m, talk: model({ analysis: samplePlan(NOW, 'approved'), talk: atVersion(2) }) };
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

test('Make a new plan runs the plan again, and Open in Claude Code asks for it; neither shows past the build', () => {
  kept = { opened: [], drafts: {} };
  const m = sampleTalkTicket(NOW);
  page.sent.length = 0;
  buttons(draw(m), 'Make a new plan')[0]!.click();
  buttons(draw(m), 'Open in Claude Code')[0]!.click();
  assert.deepEqual(page.sent, [
    { type: 'run', command: 'acc.task.analyze', ref: { project: m.project, task: 'ACME-21' } },
    { type: 'talk-claude', project: m.project, task: 'ACME-21' },
  ]);
  assert.equal(buttons(draw(m), 'Opening…').length, 1);
  done({ action: 'talk-claude', project: m.project, task: 'ACME-21', ok: true });
  const built = { ...m, talk: { ...m.talk!, newPlan: null, claude: null, send: null } };
  assert.equal(buttons(draw(built), 'Make a new plan').length + buttons(draw(built), 'Open in Claude Code').length, 0);
  assert.ok(discussButton('/r', 'ACME-21', 'd1', 'x', 'the choice x'), 'Discuss is built on its own');
});

/** Presses a key on a drawn element, as the page's keydown listeners see it. */
function press(e: PageElement, key: string, mods: { ctrlKey?: boolean; metaKey?: boolean } = {}): void {
  for (const f of e.listeners.get('keydown') ?? []) f({ key, ...mods, preventDefault() {}, stopPropagation() {} });
}

test('keys: Escape in Use this\'s question keeps the approval, sends nothing and gives focus back to Use this; edge case: another key does nothing', async () => {
  kept = { opened: [], drafts: {} };
  const m = sampleTalkTicket(NOW);
  const approved = { ...m, talk: model({ analysis: samplePlan(NOW, 'approved'), talk: atVersion(2) }) };
  page.sent.length = 0;
  buttons(draw(approved), 'Use this')[0]!.click();
  press(draw(approved).all('plan-confirm')[0]!, 'a');
  assert.equal(draw(approved).all('plan-confirm').length, 1, 'still asking');
  const asked = draw(approved).all('plan-confirm')[0]!;
  await drawn();
  press(asked, 'Escape');
  const after = draw(approved);
  assert.equal(after.all('plan-confirm').length, 0, 'the question is gone');
  assert.deepEqual(page.sent, [], 'nothing was sent');
  await drawn();
  assert.equal(page.document.activeElement, buttons(after, 'Use this')[0], 'focus is back on Use this');
});

test('keys: Ctrl or Cmd with Enter sends the message; edge case: Enter alone, or an empty box, sends nothing', () => {
  kept = { opened: [], drafts: { [sendKey('/Users/me/code/acme-service', 'ACME-21')]: 'Why the handler?' } };
  const m = sampleTalkTicket(NOW);
  page.sent.length = 0;
  const box = draw(m).all('talk-box')[0]!;
  press(box, 'Enter');
  assert.deepEqual(page.sent, [], 'Enter alone starts a new line');
  press(box, 'Enter', { ctrlKey: true });
  assert.deepEqual(page.sent, [{ type: 'talk-send', project: m.project, task: 'ACME-21', text: 'Why the handler?' }]);
  done({ action: 'talk-send', project: m.project, task: 'ACME-21', ok: true });
  page.sent.length = 0;
  kept = { opened: [], drafts: { [sendKey(m.project, 'ACME-21')]: 'And the flow?' } };
  press(draw(m).all('talk-box')[0]!, 'Enter', { metaKey: true });
  assert.equal(page.sent.length, 1, 'Cmd too');
  done({ action: 'talk-send', project: m.project, task: 'ACME-21', ok: true });
  page.sent.length = 0;
  kept = { opened: [], drafts: {} };
  press(draw(m).all('talk-box')[0]!, 'Enter', { ctrlKey: true });
  assert.deepEqual(page.sent, [], 'an empty box sends nothing');
});

test('edge case: a proposal from an older version shows it, Use this is off with why, and Ask again puts it in the message box', async () => {
  kept = { opened: [earlierKey('/Users/me/code/acme-service', 'ACME-21')], drafts: {} };
  state.draw = () => {};
  const later = sampleTalkTicket(NOW, true);
  const m = { ...later, talk: model({ analysis: samplePlan(NOW, 'approved') }) };
  const s = draw(m);
  assert.match(draw(later).all('talk-proposal')[0]!.textContent, /proposed on v1/, 'why wins over waiting for a reply: it lasts');
  const stale = s.all('talk-proposal')[0]!;
  assert.match(stale.textContent, /from v1/);
  assert.match(stale.textContent, /proposed on v1, and the plan is now v2/);
  assert.equal(buttons(stale, 'Use this')[0]!.disabled, true);
  page.sent.length = 0;
  buttons(stale, 'Ask again')[0]!.click();
  assert.deepEqual(page.sent, [], 'it asks nothing yet: the person sends it');
  const box = draw(m).all('talk-box')[0]!;
  assert.equal((box as unknown as { value: string }).value, 'You proposed this on v1. Does it still hold for the plan now? Choose Open deals only for Which converted leads get roles');
  await drawn();
  assert.equal(page.document.activeElement, box, 'the cursor is in the box');
  assert.equal(buttons(draw(sampleTalkTicket(NOW)), 'Ask again').length, 0, 'none on the plan it was made on');
});

test('T-117: the stored talk keys are the same as before peekKey built them, for a lower-case ticket key too', () => {
  const p = '/Users/me/code/acme-service';
  assert.equal(sendKey(p, 'acme-21'), `talk:${p}#ACME-21:send`);
  assert.equal(useKey(p, 'acme-21', 't2', 'p1'), `talk:${p}#ACME-21:t2.p1`);
  assert.equal(earlierKey(p, 'acme-21'), `talk:${p}#ACME-21:earlier`);
});
