import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { STEPS } from '../../packages/core/src/onboarding/steps.ts';
import {
  afterFullCheck, afterStepCheck, buildWalkthroughs, commandLink, COMMANDS, contextKey, EXTENSION_ID, followsPullRequests, hasPlaceholder, initCommand, isComplete,
  isWebviewMenuContext, machineCache, mediaPath, needsTerminal, productionOrgs, reusableMachine, setupOrgChoices, statusText, stepDescription, stepMedia, summarize, type DoctorItem,
} from '../src/logic.ts';
import { staleFiles } from '../scripts/generate.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const step = (id: string) => STEPS.find((s) => s.id === id)!;
const links = (md: string) => [...md.matchAll(/\[([^\]]+)\]\(command:([\w.]+)(?:\?([^)]+))?\)/g)].map((m) => ({ label: m[1], command: m[2], args: m[3] ? JSON.parse(decodeURIComponent(m[3])) : [] }));

test('the committed walkthrough matches the step list (run npm run build if this fails)', () => {
  assert.deepEqual(staleFiles(), []);
  assert.deepEqual(manifest.contributes.walkthroughs, buildWalkthroughs(STEPS));
});

test('the manifest identifies the extension the walkthrough commands open', () => {
  assert.equal(`${manifest.publisher}.${manifest.name}`, EXTENSION_ID);
  assert.equal(manifest.main, './dist/extension.js');
});

test('machine and project walkthroughs hold every step, in order', () => {
  const [machine, project] = buildWalkthroughs(STEPS);
  const ids = [...machine!.steps, ...project!.steps].map((s) => s.id);
  assert.deepEqual(ids, STEPS.map((s) => s.id));
  assert.ok(ids.includes('B11.drift') && ids.includes('B13.gate-tools'), 'M4\'s steps are in');
  assert.ok(machine!.steps.every((s) => s.id.startsWith('A')));
  assert.ok(project!.steps.every((s) => s.id.startsWith('B')));
  assert.equal(new Set(ids).size, ids.length);
});

test('every step ticks itself from its own context key, and Salesforce-only steps hide for generic projects', () => {
  for (const wt of buildWalkthroughs(STEPS)) {
    for (const s of wt.steps) {
      assert.deepEqual(s.completionEvents, [`onContext:${contextKey(s.id)}`]);
      const sfOnly = step(s.id).profiles?.includes('salesforce') && !step(s.id).profiles?.includes('generic');
      assert.equal(s.when, sfOnly ? 'acc.profile != generic' : undefined, s.id);
      assert.ok(existsSync(join(root, mediaPath(s.id))), `${s.id} media`);
    }
  }
});

test('every button calls a contributed command with its step id', () => {
  const contributed = new Set(manifest.contributes.commands.map((c: { command: string }) => c.command));
  for (const s of STEPS) {
    const ls = links(stepDescription(s));
    assert.ok(ls.length >= 1, `${s.id} has buttons`);
    for (const l of ls) {
      assert.ok(contributed.has(l.command), `${s.id}: ${l.command} isn't contributed`);
      assert.deepEqual(l.args, [s.id]);
    }
  }
});

test('buttons match what each step needs', () => {
  const labels = (id: string) => links(stepDescription(step(id))).map((l) => l.label);
  assert.deepEqual(labels('B0.config'), ['Check', 'Do it']);
  assert.deepEqual(labels('B2.identity'), ['Check', 'Do it'], 'the check supplies the exact command');
  assert.deepEqual(labels('B8.tracking'), ['Check', 'Open in Salesforce', 'Read the guide'], 'a click only a person can make');
  assert.deepEqual(labels('B14.tickets'), ['Check', 'Do it', 'I\'ve done this', 'Read the guide'], 'Do it runs Add a tracker; a repo with no tracker can be marked done');
  assert.deepEqual(labels('B0.repo'), ['Check', 'Do it', 'Read the guide'], 'opens the repo beside an old folder');
  assert.deepEqual(labels('A2.gh-login'), ['Check', 'Do it'], 'GitHub sign-in through VSCode, nothing to confirm by hand');
  assert.deepEqual(labels('B2.account'), ['Check', 'Do it']);
  assert.deepEqual(labels('B6.org-match'), ['Check', 'Do it'], 'pick an environment; the login opens in the browser');
  assert.deepEqual(labels('A4.plugin'), ['Check', 'Do it'], 'nothing to confirm by hand: the check reads Claude Code');
});

test('the README that ships in the extension names the walkthroughs by their titles, and asks for no Node of acc\'s own', () => {
  const readme = readFileSync(join(root, 'README.md'), 'utf8').replace(/\s+/g, ' ');
  for (const w of buildWalkthroughs(STEPS)) assert.ok(readme.includes(w.title), w.title);
  assert.ok(!/Node 20\+/.test(readme), 'acc runs on VSCode\'s runtime (D-077)');
});

test('the acc plugin is a machine step after the GitHub login, and installs in a terminal that can ask for git credentials', () => {
  const [machine] = buildWalkthroughs(STEPS);
  const ids = machine!.steps.map((s) => s.id);
  assert.equal(ids.indexOf('A4.plugin'), ids.indexOf('A2.gh-login') + 1);
  assert.equal(machine!.steps.find((s) => s.id === 'A4.plugin')!.when, undefined, 'every profile');
  const a4 = step('A4.plugin');
  assert.ok(needsTerminal(a4.fix!.command!));
  assert.ok(needsTerminal('claude plugin install acc@agent-command-center --scope user'));
  assert.ok(needsTerminal('claude plugin enable acc@agent-command-center --scope user'));
  const media = stepMedia(a4);
  assert.ok(media.includes(`\`\`\`bash\n${a4.fix!.command}\n\`\`\``), 'its page shows the command Do it runs');
  assert.match(media, /accept the invitation/);
  assert.match(media, /start a new one/);
});

test('internal step commands are hidden from the Command Palette', () => {
  const hidden = new Set(manifest.contributes.menus.commandPalette.filter((m: { when: string }) => m.when === 'false').map((m: { command: string }) => m.command));
  for (const c of [COMMANDS.check, COMMANDS.fix, COMMANDS.openSetup, COMMANDS.confirm]) assert.ok(hidden.has(c), c);
  for (const c of [COMMANDS.doctor, COMMANDS.machine, COMMANDS.project]) assert.ok(!hidden.has(c), c);
});

test('command links encode their arguments', () => {
  assert.equal(commandLink('Check', 'acc.step.check', ['B8.tracking']), '[Check](command:acc.step.check?%5B%22B8.tracking%22%5D)');
  assert.equal(commandLink('Open', 'acc.doctor'), '[Open](command:acc.doctor)');
});

test('commands with <placeholders> are typed but not run', () => {
  assert.equal(hasPlaceholder('sf org login web --alias "<alias>" --instance-url <My Domain URL>'), true);
  assert.equal(hasPlaceholder('git config user.name "Jane" && git config user.email "j@x.com"'), false);
  assert.equal(hasPlaceholder("printf '/*.csv\\n' >> .gitignore"), false);
  assert.equal(hasPlaceholder('acc init --profile generic'), false);
});

test('status text counts what is left, and attention means something failed', () => {
  const items: DoctorItem[] = [
    { id: 'A1.git', part: 'machine', title: 'git', status: 'pass', detail: '' },
    { id: 'B14.tickets', part: 'project', title: 'Tickets', status: 'unknown', detail: '' },
    { id: 'B8.tracking', part: 'project', title: 'Tracking', status: 'fail', detail: '' },
    { id: 'B11.drift', part: 'project', title: 'Drift', status: 'skip', detail: '' },
  ];
  const s = statusText(summarize(items, new Set()));
  assert.equal(s.text, '$(checklist) Setup: 2 to do');
  assert.equal(s.attention, true);
  assert.match(s.tooltip, /2 of 4 setup steps done. Next: Tracking \(B8.tracking\)/);
  const confirmed = statusText(summarize(items.filter((i) => i.status !== 'fail'), new Set(['B14.tickets'])));
  assert.equal(confirmed.text, '$(check) Setup done');
  assert.equal(isComplete('skip'), true);
  assert.equal(isComplete('unknown', true), true);
  assert.equal(isComplete('fail'), false);
});

test('machine results are reused only while fresh, and only in a folder with the same profile', () => {
  const items: DoctorItem[] = [{ id: 'A1.node', part: 'machine', title: 'Node', status: 'fail', detail: 'node isn\'t installed.' }];
  const now = 1_000_000;
  const fresh = { at: now - 1000, profile: 'salesforce', items };
  assert.deepEqual(reusableMachine(fresh, 'salesforce', now, 5000), items);
  assert.equal(reusableMachine(fresh, 'generic', now, 5000), null, 'a generic folder never shows A1.node from a Salesforce folder\'s check');
  assert.equal(reusableMachine(fresh, 'none', now, 5000), null);
  assert.equal(reusableMachine({ ...fresh, at: now - 5000 }, 'salesforce', now, 5000), null, 'stale');
  assert.equal(reusableMachine({ at: now, items }, 'generic', now, 5000), null, 'saved before results knew their profile');
  assert.equal(reusableMachine(undefined, 'generic', now, 5000), null);
});

test('a machine check that came back empty is never saved for startup to reuse', () => {
  const items: DoctorItem[] = [{ id: 'A1.git', part: 'machine', title: 'git', status: 'pass', detail: 'git 2.54.0' }];
  assert.deepEqual(machineCache(items, 'generic', 42), { at: 42, profile: 'generic', items });
  assert.equal(machineCache([], 'generic', 42), null, 'acc failed: startup checks again instead of showing no machine rows for 12 hours');
});

test('a full check replaces each part\'s rows, so a step that no longer applies loses its row (GH-62)', () => {
  const row = (id: string, part: DoctorItem['part'], status: DoctorItem['status'] = 'pass'): DoctorItem => ({ id, part, title: id, status, detail: '' });
  const ids = (rows: DoctorItem[]) => rows.map((r) => r.id);
  // No project open, then `acc init --profile generic`: the machine check no longer lists A1.node.
  const before = [row('A1.git', 'machine'), row('A1.node', 'machine', 'fail')];
  const after = afterFullCheck(before, { machine: [row('A1.git', 'machine')], project: [row('B0.config', 'project')] });
  assert.deepEqual(ids(after), ['A1.git', 'B0.config']);
  assert.deepEqual(summarize(after, new Set()).failing, [], 'neither done nor to do');
  // acc failed for a part: its rows stay rather than Setup going blank.
  const salesforce = [row('A1.git', 'machine'), row('A1.sf', 'machine'), row('B1.orgs', 'project', 'fail'), row('B0.config', 'project')];
  assert.deepEqual(ids(afterFullCheck(salesforce, { machine: [], project: [row('B0.config', 'project')] })), ['A1.git', 'A1.sf', 'B0.config']);
  assert.deepEqual(ids(afterFullCheck(salesforce, { machine: [row('A1.git', 'machine')], project: [] })), ['A1.git', 'B1.orgs', 'B0.config']);
  // A folder that isn't a project drops the project rows and keeps the machine's.
  assert.deepEqual(ids(afterFullCheck(salesforce, { machine: [row('A1.git', 'machine')], project: null })), ['A1.git']);
  // Salesforce to generic: B1.orgs and A1.sf go.
  assert.deepEqual(ids(afterFullCheck(salesforce, { machine: [row('A1.git', 'machine')], project: [row('B0.config', 'project')] })), ['A1.git', 'B0.config']);
  // A Check of one step changes that row alone.
  const checked = afterStepCheck(after, [row('A1.git', 'machine', 'fail')]);
  assert.deepEqual(ids(checked), ['A1.git', 'B0.config']);
  assert.equal(checked[0]!.status, 'fail');
  assert.deepEqual(checked[1], after[1]);
  assert.deepEqual(ids(afterStepCheck(after, [row('B14.tickets', 'project')])), ['A1.git', 'B0.config', 'B14.tickets']);
});

test('Open in Salesforce offers Developer sandboxes for tracking, and the default org first otherwise', () => {
  const envs = [
    { name: 'Production', type: 'production', org: 'P', default: false },
    { name: 'Sandbox', type: 'partial', org: 'S', default: false },
    { name: 'Devbox', type: 'developer', org: 'A', default: true },
    { name: 'Train', type: 'developer', org: null, default: false },
  ];
  assert.deepEqual(setupOrgChoices('B8.tracking', envs).map((e) => e.name), ['Devbox']);
  assert.deepEqual(setupOrgChoices('B6.org-match', envs).map((e) => e.name)[0], 'Devbox');
});

test('acc init offers only logged-in Production orgs', () => {
  const list = { status: 0, result: {
    nonScratchOrgs: [
      { alias: 'Acme Production', instanceUrl: 'https://acme.my.salesforce.com', isSandbox: false },
      { alias: 'Acme Dev', instanceUrl: 'https://acme--dev.sandbox.my.salesforce.com', isSandbox: true },
    ],
    other: [{ alias: 'Acme Production', instanceUrl: 'https://acme.my.salesforce.com', isSandbox: false }],
    scratchOrgs: [{ alias: 'scratch', instanceUrl: 'https://x.my.salesforce.com', isSandbox: false, isScratch: true }],
  } };
  assert.deepEqual(productionOrgs(list), ['Acme Production']);
  assert.equal(initCommand('salesforce', 'Acme Production'), 'acc init --profile salesforce --production-org "Acme Production"');
  assert.equal(initCommand('generic'), 'acc init --profile generic');
});

test('a webview menu passes its row context, which is told apart from a sidebar node', () => {
  assert.ok(isWebviewMenuContext({ webviewSection: 'agent', accRef: { session: 's1' }, webview: 'acc.agents' }));
  assert.ok(!isWebviewMenuContext({ kind: 'agent', session: {} }));
  assert.ok(!isWebviewMenuContext(undefined));
  assert.ok(!isWebviewMenuContext('acc.agents'));
});

test('org logins go where an environment\'s name says, gh\'s active account is read, and aliases with spaces stay whole', async () => {
  const { activeGhAccount, expectedOrgUrl, shq } = await import('../src/logic.ts');
  assert.equal(expectedOrgUrl('acme', { type: 'production', branch: 'production' }), 'https://acme.my.salesforce.com');
  assert.equal(expectedOrgUrl('acme', { type: 'developer', branch: 'dev' }), 'https://acme--dev.sandbox.my.salesforce.com');
  const status = `github.com
  ✓ Logged in to github.com account work-acct (keyring)
  - Active account: true
  - Token scopes: 'gist', 'read:org', 'repo'

  ✓ Logged in to github.com account me (keyring)
  - Active account: false`;
  assert.equal(activeGhAccount(status), 'work-acct');
  assert.equal(activeGhAccount('You are not logged into any GitHub hosts.'), null);
  assert.equal(shq('Acme Dev SB'), "'Acme Dev SB'");
  assert.equal(shq("Pat's org"), "'Pat'\\''s org'");
  assert.equal(shq('acme-dev'), 'acme-dev');
});

test('task notices say what changed once, and nothing for a task seen for the first time (D-043)', async () => {
  const { noticeActions, statusSummary, taskNotices } = await import('../src/logic.ts');
  type Row = import('../src/logic.ts').TaskRow;
  const row = (id: string, state: string, more: Partial<Row> = {}): Row => ({ id, title: `Task ${id}`, state, display: state as Row['display'], environment: 'main', deps: [], source: { kind: 'github', url: null }, ...more });
  assert.deepEqual(taskNotices([], [row('T-1', 'review')]), [], 'first look: no news');
  const kinds = (b: Row[], a: Row[]) => taskNotices(b, a).map((n) => `${n.kind}:${n.task}:${n.urgent}`);
  assert.deepEqual(kinds([row('T-1', 'running')], [row('T-1', 'review')]), ['review:T-1:false'], 'a builder finished');
  assert.deepEqual(kinds([row('T-1', 'review')], [row('T-1', 'review')]), [], 'no change, no notice');
  assert.deepEqual(kinds([row('T-1', 'review')], [row('T-1', 'rework', { review: { verdict: 'changes', summary: 'Tests missing.', current: true } })]), ['rework:T-1:true']);
  assert.match(taskNotices([row('T-1', 'review')], [row('T-1', 'rework', { review: { verdict: 'changes', summary: 'Tests missing.', current: true } })])[0]!.text, /Tests missing\./);
  assert.deepEqual(kinds([row('T-1', 'running')], [row('T-1', 'blocked')]), ['blocked:T-1:true']);
  // Waiting on its own prompt says so; a question in the Command Center has its own notice.
  assert.deepEqual(kinds([row('T-1', 'running')], [row('T-1', 'running', { display: 'needs-you' })]), ['waiting:T-1:true']);
  assert.deepEqual(kinds([row('T-1', 'running')], [row('T-1', 'running', { display: 'needs-you', asking: true })]), []);
  const passed = { verdict: 'pass' as const, summary: 'Good.', current: true };
  assert.deepEqual(kinds([row('T-1', 'review', { review: { ...passed, current: false } })], [row('T-1', 'review', { review: passed })]), ['passed:T-1:false'], 'a pass on the latest commit');
  const pr = (more: Partial<NonNullable<Row['pr']>>) => ({ pr: { number: 7, url: 'u', state: 'open', ci: 'pending', changesRequested: false, ...more } });
  assert.deepEqual(kinds([row('T-1', 'review', pr({}))], [row('T-1', 'review', { ...pr({ ci: 'failing' }), display: 'needs-you' })]), ['ci-failed:T-1:true']);
  assert.deepEqual(kinds([row('T-1', 'review', pr({ ci: 'failing' }))], [row('T-1', 'review', pr({ ci: 'failing' }))]), [], 'said once');
  assert.deepEqual(kinds([row('T-1', 'review', pr({}))], [row('T-1', 'review', pr({ changesRequested: true }))]), ['changes:T-1:true']);
  assert.deepEqual(kinds([row('T-1', 'review', pr({}))], [row('T-1', 'done', pr({ state: 'merged' }))]), ['merged:T-1:false']);
  // A pull request that stops merging into its base names the files, once (D-049).
  const clash = pr({ conflicts: ['docs/DECISIONS.md', 'plugin/bin/acc'] });
  const conflicted = taskNotices([row('T-1', 'review', pr({ conflicts: [] }))], [row('T-1', 'review', { ...clash, display: 'needs-you' })]);
  assert.deepEqual(conflicted.map((n) => [n.kind, n.urgent, n.text]), [['conflicts', true, 'Pull request #7 (T-1) conflicts with main in docs/DECISIONS.md, plugin/bin/acc.']]);
  assert.deepEqual(noticeActions(conflicted[0]!), [['Open pull request', 'acc.task.openPr'], ['Show', 'acc.task.show']]);
  assert.deepEqual(kinds([row('T-1', 'review', clash)], [row('T-1', 'review', pr({ conflicts: ['docs/DECISIONS.md'] }))]), [], 'said once, not again as the files change');
  assert.deepEqual(kinds([row('T-1', 'review', pr({}))], [row('T-1', 'done', pr({ state: 'merged', conflicts: ['a'] }))]), ['merged:T-1:false'], 'only an open pull request conflicts');
  assert.match(taskNotices([row('T-1', 'review', pr({}))], [row('T-1', 'review', pr({ conflicts: ['a', 'b', 'c', 'd', 'e'] }))])[0]!.text, /in a, b, c and 2 more\.$/);
  assert.deepEqual(kinds([row('T-1', 'running'), row('T-2', 'review', pr({}))], [row('T-1', 'review'), row('T-2', 'review', pr({ ci: 'failing' }))]), ['review:T-1:false', 'ci-failed:T-2:true'], 'every task, in board order');

  assert.deepEqual(noticeActions({ kind: 'review', task: 'T-1', text: '', urgent: false }), [['Review', 'acc.task.review'], ['Show', 'acc.task.show']]);
  assert.deepEqual(noticeActions({ kind: 'blocked', task: 'T-1', text: '', urgent: true }), [['Show', 'acc.task.show']]);

  const s = statusSummary([row('T-1', 'running'), row('T-2', 'running'), row('T-3', 'review'), row('T-4', 'done')], 1);
  assert.equal(s.text, '$(bell) 1 needs you  $(sync) 2 running  $(eye) 1 in review', 'each count has its icon and its words');
  assert.ok(s.attention);
  assert.match(s.tooltip, /Running: T-1, T-2/);
  assert.equal(statusSummary([row('T-1', 'review')], 2).text, '$(bell) 2 need you  $(eye) 1 in review');
  assert.deepEqual(statusSummary([row('T-4', 'done')], 0), { text: '', tooltip: '', attention: false }, 'nothing in play: hidden');
});

test('an analysis that comes back says so once: ready, questions for you, or too big; an answer says nothing (D-052)', async () => {
  const { noticeActions, taskNotices } = await import('../src/logic.ts');
  type Row = import('../src/logic.ts').TaskRow;
  const row = (more: Partial<Row> = {}): Row => ({ id: 'T-1', title: 'Task T-1', state: 'todo', display: 'ready', environment: 'main', deps: [], source: { kind: 'github', url: null }, ...more });
  const ask = (id: string) => ({ id, question: `Question ${id}?`, why: 'It matters.', suggested: 'Yes.' });
  const analysis = (at: string, verdict: 'ready' | 'questions' | 'split', open = 0) => ({ analysis: { verdict, at, open: ['q1', 'q2', 'q3'].slice(0, open).map(ask), split: verdict === 'split' ? ['One', 'Two'] : [] } });
  const say = (b: Row, a: Row) => taskNotices([b], [a]).map((n) => [n.kind, n.urgent, n.text]);
  assert.deepEqual(say(row(), row(analysis('t1', 'ready'))), [['analysis-ready', false, 'T-1\'s analysis is ready.']]);
  assert.deepEqual(say(row(), row({ ...analysis('t1', 'questions', 2), display: 'needs-you' })), [['analysis-questions', true, 'T-1\'s analysis has 2 questions for you.']]);
  assert.deepEqual(say(row(), row({ ...analysis('t1', 'questions', 1), display: 'needs-you' })), [['analysis-questions', true, 'T-1\'s analysis has 1 question for you.']]);
  assert.deepEqual(say(row(), row({ ...analysis('t1', 'split'), display: 'needs-you' })), [['analysis-split', true, 'T-1\'s analysis says it\'s too big for one task.']]);
  assert.deepEqual(say(row(analysis('t1', 'questions', 2)), row(analysis('t1', 'questions', 1))), [], 'an answer keeps its time: no notice');
  assert.deepEqual(say(row(analysis('t1', 'questions', 1)), row(analysis('t1', 'ready'))), [], 'nor does the last answer');
  assert.deepEqual(say(row(analysis('t1', 'ready')), row(analysis('t2', 'questions', 1))), [['analysis-questions', true, 'T-1\'s analysis has 1 question for you.']], 'analyzed again: news');
  assert.deepEqual(taskNotices([], [row(analysis('t1', 'questions', 2))]), [], 'first look: no news');
  assert.deepEqual(noticeActions({ kind: 'analysis-questions', task: 'T-1', text: '', urgent: true }), [['Answer', 'acc.task.show']], 'Answer is the page: no second Show');
  assert.deepEqual(noticeActions({ kind: 'analysis-ready', task: 'T-1', text: '', urgent: false }), [['Dispatch', 'acc.task.dispatch'], ['Show', 'acc.task.show']]);
  assert.deepEqual(noticeActions({ kind: 'analysis-split', task: 'T-1', text: '', urgent: true }), [['Show', 'acc.task.show']]);
});

test('an analysis that comes back after the build is news: it asks for nothing the page can\'t take (D-059)', async () => {
  const { noticeActions, taskNotices } = await import('../src/logic.ts');
  type Row = import('../src/logic.ts').TaskRow;
  const row = (state: Row['state'], more: Partial<Row> = {}): Row => ({ id: 'T-1', title: 'Task T-1', state, display: state === 'rework' ? 'needs-you' : state, environment: 'main', deps: [], source: { kind: 'github', url: null }, ...more } as Row);
  const ask = (id: string) => ({ id, question: `Question ${id}?`, why: 'It matters.', suggested: 'Yes.' });
  const analysis = (at: string, verdict: 'ready' | 'questions' | 'split', open = 0) => ({ analysis: { verdict, at, open: ['q1', 'q2', 'q3'].slice(0, open).map(ask), split: verdict === 'split' ? ['One', 'Two'] : [] } });
  for (const state of ['review', 'rework', 'blocked'] as const) {
    const news = (a: Partial<Row>) => taskNotices([row(state, analysis('t1', 'ready'))], [row(state, a)]);
    assert.deepEqual(news(analysis('t2', 'questions', 2)).map((n) => [n.kind, n.urgent, n.text]), [['analysis-back', false, 'T-1\'s analysis is back. Its 2 questions can be answered with acc analysis answer.']], state);
    assert.deepEqual(news(analysis('t2', 'split')).map((n) => [n.kind, n.urgent, n.text]), [['analysis-back', false, 'T-1\'s analysis is back.']], `${state}: too big`);
    assert.deepEqual(news(analysis('t2', 'ready')).map((n) => [n.kind, n.urgent]), [['analysis-back', false]], `${state}: ready`);
    for (const n of news(analysis('t2', 'questions', 1))) assert.deepEqual(noticeActions(n), [['Show', 'acc.task.show']], `${state}: no Answer, no Dispatch`);
  }
});

test('a row reads its analysis and the one under way from beside the ledger; a dead analyst is no longer analyzing (D-052)', async () => {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { analyzing, readAnalysis } = await import('../../packages/core/src/analyze.ts');
  const { tempDir } = await import('../../packages/core/test/support.ts');
  const { analysisReady, analysisWait, rowAnalysis } = await import('../src/logic.ts');
  const paths = { analyses: join(tempDir(), 'acc', 'analyses') } as import('../../packages/core/src/paths.ts').RepoPaths;
  mkdirSync(paths.analyses, { recursive: true });
  const a = {
    v: 1, task: 'T-1', env: 'main', base: 'abc', verdict: 'questions', summary: 'Do it.', requirements: { goal: '', criteria: [], assumptions: [], outOfScope: [] },
    questions: [{ id: 'q1', question: 'Which?', why: 'Because.', suggested: 'This one.' }, { id: 'q2', question: 'When?', why: '', suggested: 'Now.', answer: { text: 'Later', by: 'me', at: 't' } }],
    findings: [], approach: { plan: [], files: [], refactors: [], risks: [], tests: [], size: 'S' }, split: [], orgs: [], sessionId: 's', at: '2026-10-05T10:00:00.000Z', durationMs: 1, costUsd: null,
  };
  writeFileSync(join(paths.analyses, 'T-1.json'), JSON.stringify(a));
  const row = rowAnalysis(readAnalysis(paths, 'T-1')!);
  assert.deepEqual(row, { verdict: 'questions', at: '2026-10-05T10:00:00.000Z', open: [{ id: 'q1', question: 'Which?', why: 'Because.', suggested: 'This one.' }], split: [] }, 'only the questions nobody answered');
  assert.equal(analysisWait({ state: 'todo', analysis: row }), 'questions');
  assert.equal(analysisWait({ state: 'running', analysis: row }), null, 'only a task to do waits on its analysis');
  assert.equal(analysisWait({ state: 'todo', analysis: row, analyzing: { sessionId: 's2' } }), null, 'nor while it\'s analyzed again');
  assert.equal(analysisReady({ analysis: { ...row, open: [] } }), true);
  assert.equal(analysisReady({ analysis: { ...row, open: [], verdict: 'split' } }), false);
  writeFileSync(join(paths.analyses, 'T-1.running.json'), JSON.stringify({ sessionId: 'live', startedAt: 't', pid: process.pid }));
  assert.equal(analyzing(paths, 'T-1')?.sessionId, 'live');
  writeFileSync(join(paths.analyses, 'T-1.running.json'), JSON.stringify({ sessionId: 'gone', startedAt: 't', pid: 999_999_999 }));
  assert.equal(analyzing(paths, 'T-1'), null, 'its process has gone');
});

test('an answer goes through acc, after --, so words that start with - stay words (D-012, D-052)', async () => {
  const { spawnSync } = await import('node:child_process');
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { GENERIC_CONFIG, makeRepo } = await import('../../packages/core/test/support.ts');
  const { analysisAnswerArgs } = await import('../src/logic.ts');
  const args = analysisAnswerArgs('T-1', 'q1', '-5 days, not --json');
  assert.deepEqual(args, ['analysis', 'answer', 'T-1', 'q1', '--json', '--', '-5 days, not --json']);
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG) });
  const main = join(root, '..', 'packages', 'cli', 'src', 'main.ts');
  const acc = (a: string[]) => spawnSync(process.execPath, ['--no-warnings', main, ...a], { cwd: dir, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', ACC_ROLE: '', ACC_TASK: '' } });
  assert.equal(acc(['add', 'Work']).status, 0);
  const common = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: dir, encoding: 'utf8' }).stdout.trim();
  const analyses = join(common, 'acc', 'analyses');
  mkdirSync(analyses, { recursive: true });
  writeFileSync(join(analyses, 'T-1.json'), JSON.stringify({
    v: 1, task: 'T-1', env: 'main', base: 'abc', verdict: 'questions', summary: 'Do it.', requirements: { goal: '', criteria: [], assumptions: [], outOfScope: [] },
    questions: [{ id: 'q1', question: 'How long?', why: '', suggested: '3 days' }], findings: [], approach: { plan: [], files: [], refactors: [], risks: [], tests: [], size: 'S' },
    split: [], orgs: [], sessionId: 's', at: '2026-10-05T10:00:00.000Z', durationMs: 1, costUsd: null,
  }));
  const r = acc(args);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const out = JSON.parse(r.stdout);
  assert.deepEqual([out.verdict, out.questions[0].answer.text], ['ready', '-5 days, not --json'], 'the words as given, and the last answer makes it ready');
});

test('each step autopilot takes is one notice: what it did, and what it couldn\'t, as a warning (D-064)', async () => {
  const { autopilotNotices, noticeActions } = await import('../src/logic.ts');
  type Rec = import('../../packages/core/src/autopilot.ts').AutopilotRecord;
  const at = '2026-10-05T12:00:00.000Z';
  const rec = (task: string, more: Partial<Rec>): Rec => ({ seq: 1, at, task, step: 'land', outcome: 'done', ...more });
  type Task = import('../src/logic.ts').AutopilotTask;
  const gh: Task = { id: 'GH-31', source: { kind: 'github', key: '31' }, history: [] };
  const say = (r: Rec, tasks: Task[] = [gh]) => autopilotNotices([r], tasks).map((n) => [n.text, n.urgent, noticeActions(n)]);
  const show = ['Show', 'acc.task.show'];
  const pr = ['Open pull request', 'acc.task.openPr'];

  const review = ['Review the update', 'acc.task.show'];
  assert.deepEqual(say(rec('GH-31', { pr: { number: 40, url: 'u', opened: true } })), [['Autopilot landed GH-31: pull request #40. Its update for the ticket is ready for you to review and post.', false, [review, pr]]]);
  assert.deepEqual(say(rec('GH-31', { pr: { number: 40, url: 'u', opened: false } })), [['Autopilot updated pull request #40 (GH-31). Its update for the ticket is ready for you to review and post.', false, [review, pr]]]);
  // A ticket's update is a person's to post: autopilot drafts it, and the notice opens the task to review it (D-066).
  const jira = { id: 'ACME-7', source: { kind: 'jira', key: 'ACME-7' }, history: [] };
  assert.deepEqual(say(rec('ACME-7', { pr: { number: 41, url: 'u', opened: true } }), [jira]),
    [['Autopilot landed ACME-7: pull request #41. Its update for the ticket is ready for you to review and post.', false, [['Review the update', 'acc.task.show'], pr]]]);
  assert.deepEqual(say(rec('T-4', { pr: { number: 43, url: 'u', opened: true } }), [{ id: 'T-4', source: { kind: 'manual', key: null }, history: [] }]),
    [['Autopilot landed T-4: pull request #43', false, [pr, show]]], 'a task acc alone keeps has no ticket to tell');
  assert.deepEqual(say(rec('GH-31', { step: 'review', verdict: 'pass' })), [['Autopilot reviewed GH-31: it passed. Autopilot lands it next.', false, [show]]]);
  assert.deepEqual(say(rec('GH-31', { step: 'review', verdict: 'changes', reason: 'sum has no test' })), [['Autopilot\'s review asked for changes on GH-31: sum has no test. Autopilot re-dispatches it next.', false, [show]]]);
  // Once re-dispatched by autopilot, a second rework is a person's.
  const again = { ...gh, history: [{ at: '2026-10-05T11:00:00.000Z', from: 'rework', to: 'running', actor: 'orchestrator', by: 'orchestrator:autopilot' }] };
  assert.deepEqual(say(rec('GH-31', { step: 'review', verdict: 'changes', reason: 'Still no test.' }), [again]),
    [['Autopilot\'s review asked for changes on GH-31 again: Still no test. A second rework waits for you.', true, [['Re-dispatch', 'acc.task.dispatch'], show]]]);
  assert.deepEqual(say(rec('GH-31', { step: 'dispatch' })), [['Autopilot re-dispatched GH-31 with its review\'s changes.', false, [['Watch', 'acc.task.watch'], show]]]);
  assert.deepEqual(say(rec('GH-31', { step: 'refresh', base: 'main' }))[0]![0], 'Autopilot merged main into GH-31, and its checks passed. It\'s reviewed next, then landed.');
  assert.deepEqual(say(rec('GH-31', { step: 'refresh', base: null, pr: { number: 40, url: 'u', opened: false } }))[0]![0], 'Pull request #40 (GH-31) no longer conflicts with its base: autopilot found nothing to merge.');

  // What it couldn't do needs a person: a warning, with the step to take by hand.
  assert.deepEqual(say(rec('GH-31', { outcome: 'failed', reason: 'the push was refused: rejected' })), [['Autopilot couldn\'t land GH-31: the push was refused: rejected.', true, [['Land', 'acc.task.land'], show]]]);
  assert.deepEqual(say(rec('GH-31', { step: 'review', outcome: 'failed', reason: 'The review didn\'t finish within 45 minutes, so acc stopped it.' }))[0]!.slice(0, 2), ['Autopilot couldn\'t review GH-31: The review didn\'t finish within 45 minutes, so acc stopped it.', true]);
  assert.match(say(rec('GH-31', { step: 'refresh', outcome: 'failed', reason: 'Conflicts with main' }))[0]![0] as string, /^Autopilot couldn't update GH-31 from its base: Conflicts with main\.$/);
  assert.deepEqual(autopilotNotices([rec('GH-31', { step: 'review', verdict: 'pass' }), rec('GH-31', { seq: 2, pr: { number: 40, url: 'u', opened: true } })], [gh]).length, 2, 'one each');
});

test('a builder that stopped is told once, with what it last said, and Resume; not as an agent waiting in its own prompt (D-067)', async () => {
  const { autopilotNotices, noticeActions, sessionFor, taskNotices } = await import('../src/logic.ts');
  const { autopilotStepLook } = await import('../src/model.ts');
  type Row = import('../src/logic.ts').TaskRow;
  const said = 'API Error: Your computer went to sleep mid-response. The response above may be incomplete.';
  const row = (more: Partial<Row> = {}): Row => ({ id: 'GH-41', title: 'Task GH-41', state: 'running', display: 'running', environment: 'main', deps: [], source: { kind: 'github', url: null }, ...more });
  const stopped = row({ display: 'needs-you', stopped: { said } });
  const news = taskNotices([row()], [stopped]);
  assert.deepEqual(news.map((n) => [n.kind, n.urgent, n.text]), [['stopped', true, `GH-41's agent stopped: ${said}`]]);
  assert.deepEqual(noticeActions(news[0]!), [['Resume', 'acc.task.resume'], ['Show', 'acc.task.show']], 'Resume, not Open in Claude Code');
  assert.deepEqual(taskNotices([stopped], [stopped]), [], 'said once');
  assert.equal(taskNotices([row()], [row({ display: 'needs-you', stopped: { said: null } })])[0]!.text, 'GH-41\'s agent stopped before acc done or acc block.');
  assert.match(taskNotices([row()], [row({ display: 'needs-you', stopped: { said: 'x'.repeat(500) } })])[0]!.text, /^GH-41's agent stopped: x{150,}…$/, 'a long quote is clipped');

  // A resumed conversation is listed beside its old background session: the one with a process is the agent.
  const old = { cwd: '/r', kind: 'background', startedAt: 1, id: 'bg41', sessionId: 'sess-41', name: 'GH-41', state: 'blocked' };
  const live = { cwd: '/w41', kind: 'interactive', startedAt: 2, sessionId: 'sess-41', name: 'gh-41-73', pid: 94651, status: 'busy' };
  assert.equal(sessionFor({ id: 'GH-41', run: { bgId: 'bg41', sessionId: 'sess-41' } }, [old, live]), live);
  assert.equal(sessionFor({ id: 'GH-41', run: { bgId: 'bg41', sessionId: 'sess-41' } }, [old]), old);

  // Autopilot's resume, as a notice and in History.
  const at = '2026-10-05T22:20:00.000Z';
  const gh = { id: 'GH-41', source: { kind: 'github', key: '41' }, history: [] };
  const done = autopilotNotices([{ seq: 1, at, task: 'GH-41', step: 'resume', outcome: 'done', reason: said }], [gh]);
  assert.deepEqual(done.map((n) => [n.text, n.urgent, noticeActions(n)]), [[`Autopilot resumed GH-41: ${said}`, false, [['Watch', 'acc.task.watch'], ['Show', 'acc.task.show']]]]);
  const failed = autopilotNotices([{ seq: 2, at, task: 'GH-41', step: 'resume', outcome: 'failed', reason: 'Claude Code didn\'t start.' }], [gh]);
  assert.deepEqual(failed.map((n) => [n.text, n.urgent, noticeActions(n)[0]]), [['Autopilot couldn\'t resume GH-41: Claude Code didn\'t start.', true, ['Resume', 'acc.task.resume']]]);
  assert.deepEqual(autopilotStepLook({ seq: 1, at, task: 'GH-41', step: 'resume', outcome: 'done', reason: said }), { look: { label: 'Autopilot resumed it', icon: 'debug-continue', tone: 'blue' }, detail: said, url: null });
});

test('D-044\'s review notices stay quiet for a review autopilot ran, and still speak for a person\'s (D-064)', async () => {
  const { taskNotices, withoutAutopilotEcho } = await import('../src/logic.ts');
  type Row = import('../src/logic.ts').TaskRow;
  type Rec = import('../../packages/core/src/autopilot.ts').AutopilotRecord;
  const row = (id: string, state: string, more: Partial<Row> = {}): Row => ({ id, title: `Task ${id}`, state, display: state as Row['display'], environment: 'main', deps: [], source: { kind: 'github', url: null }, ...more });
  const passed = { verdict: 'pass' as const, summary: 'Good.', current: true };
  const changes = { verdict: 'changes' as const, summary: 'No test.', current: true };
  const news = taskNotices(
    [row('T-1', 'review', { review: { ...passed, current: false } }), row('T-2', 'review'), row('T-3', 'review', { review: { ...passed, current: false } })],
    [row('T-1', 'review', { review: passed }), row('T-2', 'rework', { review: changes }), row('T-3', 'review', { review: passed })],
  );
  assert.deepEqual(news.map((n) => `${n.kind}:${n.task}`), ['passed:T-1', 'rework:T-2', 'passed:T-3']);
  const log: Rec[] = [
    { seq: 1, at: 'a', task: 'T-1', step: 'review', outcome: 'done', verdict: 'pass' },
    { seq: 2, at: 'a', task: 'T-2', step: 'review', outcome: 'done', verdict: 'changes' },
    // T-3: autopilot landed it before, and a person reviewed its new commit by hand.
    { seq: 3, at: 'a', task: 'T-3', step: 'review', outcome: 'done', verdict: 'pass' },
    { seq: 4, at: 'a', task: 'T-3', step: 'land', outcome: 'done', pr: { number: 9, url: 'u', opened: true } },
  ];
  assert.deepEqual(withoutAutopilotEcho(news, log).map((n) => `${n.kind}:${n.task}`), ['passed:T-3'], 'autopilot\'s own notice said it, and it lands or re-dispatches it next');
  assert.equal(withoutAutopilotEcho(news, []).length, 3, 'with no autopilot, every one');
});

test('autopilot\'s send-back for failing checks is its own notice and History item, and its re-dispatch says what for (D-076)', async () => {
  const { autopilotNotices, noticeActions, taskNotices, withoutAutopilotEcho } = await import('../src/logic.ts');
  const { autopilotStepLook } = await import('../src/model.ts');
  type Rec = import('../../packages/core/src/autopilot.ts').AutopilotRecord;
  type Task = import('../src/logic.ts').AutopilotTask;
  type Row = import('../src/logic.ts').TaskRow;
  const at = '2026-10-06T12:00:00.000Z';
  const gh: Task = { id: 'GH-57', source: { kind: 'github', key: '57' }, history: [] };
  const say = (r: Rec, tasks: Task[] = [gh]) => autopilotNotices([r], tasks).map((n) => [n.text, n.urgent, noticeActions(n)]);
  const show = ['Show', 'acc.task.show'];
  const pr = ['Open pull request', 'acc.task.openPr'];
  const sent: Rec = { seq: 1, at, task: 'GH-57', step: 'checks', outcome: 'done', checks: ['build', 'test'], reason: 'Checks failed on GitHub on abc1234: build, test.' };
  assert.deepEqual(say(sent), [['Autopilot sent GH-57 back to its builder: checks failed on GitHub: build, test.', false, [pr, show]]]);
  assert.deepEqual(say({ seq: 2, at, task: 'GH-57', step: 'dispatch', outcome: 'done', cause: 'checks' }), [['Autopilot re-dispatched GH-57 for its failing checks.', false, [['Watch', 'acc.task.watch'], show]]]);
  assert.deepEqual(say({ seq: 2, at, task: 'GH-57', step: 'dispatch', outcome: 'done', cause: 'review' })[0]![0], 'Autopilot re-dispatched GH-57 with its review\'s changes.');
  const again = 'Checks failed on GitHub again: build. Autopilot already sent abc1234 back once: a person decides.';
  assert.deepEqual(say({ seq: 3, at, task: 'GH-57', step: 'checks', outcome: 'failed', reason: again }), [[`Autopilot couldn't send GH-57 back for its failing checks: ${again}`, true, [pr, show]]]);

  // History says the same, with the checks' names.
  assert.deepEqual(autopilotStepLook(sent), { look: { label: 'Autopilot sent it back: checks failed on GitHub', icon: 'github-action', tone: 'neutral' }, detail: 'build, test', url: null });
  assert.equal(autopilotStepLook({ seq: 2, at, task: 'GH-57', step: 'dispatch', outcome: 'done', cause: 'checks' }).look.label, 'Autopilot re-dispatched it for its failing checks');
  assert.equal(autopilotStepLook({ seq: 2, at, task: 'GH-57', step: 'dispatch', outcome: 'done' }).look.label, 'Autopilot re-dispatched it for the review\'s changes');
  assert.deepEqual(autopilotStepLook({ seq: 3, at, task: 'GH-57', step: 'checks', outcome: 'failed', reason: again }).look, { label: 'Autopilot couldn\'t send it back for its failing checks', icon: 'warning', tone: 'orange' });

  // A re-dispatch for failing checks isn't a review's one: the review's changes after it aren't a second rework.
  const checksFirst: Task = { ...gh, history: [
    { at: '2026-10-06T10:00:00.000Z', from: 'review', to: 'rework', actor: 'orchestrator', by: 'orchestrator:autopilot' },
    { at: '2026-10-06T10:01:00.000Z', from: 'rework', to: 'running', actor: 'orchestrator', by: 'orchestrator:autopilot' },
  ] };
  const changes: Rec = { seq: 4, at, task: 'GH-57', step: 'review', outcome: 'done', verdict: 'changes', reason: 'No test.' };
  assert.equal(autopilotNotices([changes], [checksFirst])[0]!.text, 'Autopilot\'s review asked for changes on GH-57: No test. Autopilot re-dispatches it next.');

  // D-044's notice of its move to rework names the checks, and keeps quiet when autopilot's own said it.
  const row = (state: string, more: Partial<Row> = {}): Row => ({ id: 'GH-57', title: 'Task GH-57', state, display: state as Row['display'], environment: 'main', deps: [], source: { kind: 'github', url: null }, ...more });
  const news = taskNotices([row('review')], [row('rework', { checks: ['build'], review: { verdict: 'pass', summary: 'Good.', current: true } })]);
  assert.deepEqual(news.map((n) => [n.kind, n.text, n.urgent]), [['rework', 'Checks failed on GitHub for GH-57: build. It went back to its builder.', true]]);
  assert.deepEqual(withoutAutopilotEcho(news, [sent]), [], 'autopilot\'s notice told it');
  assert.equal(withoutAutopilotEcho(news, [{ seq: 1, at, task: 'GH-57', step: 'land', outcome: 'done', pr: { number: 9, url: 'u', opened: true } }]).length, 1);
});

test('the autopilot switch says on or off with an icon and the words, and its tooltip says what it does (D-064)', async () => {
  const { autopilotStatus } = await import('../src/logic.ts');
  const on = autopilotStatus({ project: 'Tool', many: false, state: 'on', last: '✓ GH-31  Opened pull request #40.' });
  assert.equal(on.text, '$(rocket) Autopilot: on');
  assert.match(on.tooltip, /^Autopilot is on for Tool: it reviews finished work, lands work whose review passed, re-dispatches a rework once, sends a pull request whose GitHub checks fail back to its builder once a commit, resumes a stopped builder once a run, and merges the base into a pull request that conflicts with it\. It never merges a pull request\./);
  assert.match(on.tooltip, /Last: ✓ GH-31 {2}Opened pull request #40\./);
  assert.match(on.tooltip, /Click to turn it off until VSCode closes\.$/);
  assert.doesNotMatch(autopilotStatus({ project: 'Tool', many: false, state: 'on' }).tooltip, /Last:/, 'nothing printed yet');

  const off = autopilotStatus({ project: 'Tool', many: false, state: 'off' });
  assert.equal(off.text, '$(debug-pause) Autopilot: off');
  assert.match(off.tooltip, /^Autopilot is off for Tool\. When it's on, it reviews[^]*merges the base into a pull request that conflicts with it\. It never merges a pull request\.\n\nClick to turn it on until VSCode closes\.$/);

  const elsewhere = autopilotStatus({ project: 'Tool', many: false, state: 'elsewhere', pid: 4242 });
  assert.equal(elsewhere.text, '$(rocket) Autopilot: on elsewhere');
  assert.match(elsewhere.tooltip, /in another window or a terminal \(pid 4242\)/);
  assert.match(elsewhere.tooltip, /Stop it there to run it in this window\.$/);

  // It can't run: acc's own words say why.
  const { autopilotMode } = await import('../../packages/core/src/autopilot.ts');
  const refusal = autopilotMode({ autonomy: 'dispatch' }).refusal!;
  assert.match(refusal, /^autonomy "dispatch" \(autopilot also starting Ready tasks\) is not built yet\. Set "autonomy" to "review" in \.acc\/config\.json: autopilot then reviews finished work, [^]*, and merges the base into a pull request that conflicts with it\.$/);
  const refused = autopilotStatus({ project: 'Tool', many: false, state: 'refused', refusal });
  assert.equal(refused.text, '$(circle-slash) Autopilot: off');
  assert.equal(refused.tooltip, `Autopilot can't run for Tool: ${refusal}`);
  const noGithub = autopilotStatus({ project: 'Tool', many: false, state: 'refused', refusal: 'Autopilot lands reviewed work as pull requests on GitHub, and this project has no "github" section in .acc/config.json.' });
  assert.match(noGithub.tooltip, /no "github" section/);

  // Several repos: each switch names its project.
  assert.equal(autopilotStatus({ project: 'Tool', many: true, state: 'on' }).text, '$(rocket) Autopilot: on · Tool');
  assert.equal(autopilotStatus({ project: 'Site', many: true, state: 'off' }).text, '$(debug-pause) Autopilot: off · Site');
  for (const state of ['on', 'off', 'elsewhere', 'refused'] as const) {
    const t = autopilotStatus({ project: 'Tool', many: false, state, pid: 1, refusal: 'x' }).text;
    assert.match(t, /^\$\([a-z-]+\) Autopilot: (on|off)/, `${state}: an icon and the words`);
  }
});

test('all of acc is one status bar item: what needs you first, a spinner while busy, the rest in its tooltip (D-065)', async () => {
  const { combinedStatus } = await import('../src/logic.ts');
  const base = { rows: [], needsYou: 0, asking: null, running: [], checking: false, setup: { done: 31, total: 32, todo: 0 }, autopilot: [], account: { name: 'jhuffman-aleysian', ok: true } };
  assert.equal(combinedStatus(base).text, '', 'nothing to say: it hides');
  assert.match(combinedStatus(base).tooltip.join('\n'), /GitHub: jhuffman-aleysian/);
  assert.equal(combinedStatus({ ...base, needsYou: 3 }).text, '$(bell) 3 need you');
  assert.equal(combinedStatus({ ...base, needsYou: 3 }).attention, true);
  assert.equal(combinedStatus({ ...base, needsYou: 3, checking: true }).text, '$(bell) 3 need you $(sync~spin)', 'busy: a spinner, not another item');
  assert.equal(combinedStatus({ ...base, checking: true }).text, '$(sync~spin) Checking setup');
  assert.equal(combinedStatus({ ...base, setup: { done: 31, total: 32, todo: 1 } }).text, '$(checklist) Setup: 1 to do');
  assert.equal(combinedStatus({ ...base, asking: 'Log in to Acme Dev' }).text, '$(bell) Log in to Acme Dev: waiting for you');
  const on = combinedStatus({ ...base, needsYou: 1, autopilot: [{ project: 'Acme', state: 'on' }] });
  assert.equal(on.text, '$(hubot) $(bell) 1 needs you', 'a robot while autopilot is on here');
  assert.match(on.tooltip.join('\n'), /Autopilot on here/);
  assert.equal(combinedStatus({ ...base, autopilot: [{ project: 'Acme', state: 'on' }] }).text, '$(hubot) Autopilot on');
  assert.equal(combinedStatus({ ...base, account: { name: 'someone-else', ok: false } }).attention, true, 'the wrong account says so');
});

test('acc sync runs for a project while a task\'s pull request or a promotion taking it on is open, and not otherwise (D-075)', () => {
  const pr = (state: string) => ({ number: 3, url: 'https://github.com/o/r/pull/3', state });
  assert.equal(followsPullRequests({ pr: pr('open') }), true);
  assert.equal(followsPullRequests({ pr: pr('merged'), promoting: true }), true, 'its promotion\'s merge tells the ticket it\'s in the next environment');
  assert.equal(followsPullRequests({ pr: pr('merged'), promoting: false }), false);
  assert.equal(followsPullRequests({ pr: pr('closed') }), false);
  assert.equal(followsPullRequests({ pr: null }), false);
});
