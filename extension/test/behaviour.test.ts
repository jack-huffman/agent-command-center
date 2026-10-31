import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { Script } from 'node:vm';
import type { HomeModel } from '../src/model/home.ts';
import type { TicketModel } from '../src/model/task-page.ts';
import { isFromWebview } from '../src/model/messages.ts';
import { CHANGE_APPROVED } from '../../packages/core/src/plan-choices.ts';
import { type BehaviourReport, behaviourData, behaviourPage, CASES, caseModel, caseFailed, dumpedBehaviour, HELPERS, judgeBehaviour, judgeMutants, MUTANTS, occurrences } from '../scripts/behaviour.ts';
import { FONTS, sampleModel } from '../scripts/screenshot.ts';
import { sampleTalkApproved, sampleTalkTicket } from '../scripts/fixtures/talk.ts';

const webview = join(import.meta.dirname, '..', 'webview');
const now = Date.UTC(2026, 9, 10, 12);
const models = () => ({ tasks: sampleModel('tasks', now, 'dark'), overview: sampleModel('overview-landing', now, 'dark'), since: sampleModel('overview-since', now, 'dark'), ticket: sampleModel('ticket-questions', now, 'dark'), review: sampleModel('ticket-review', now, 'dark'), settings: sampleModel('settings-agents', now, 'dark'), connect: sampleModel('connect-start', now, 'dark'), agent: sampleModel('agent', now, 'dark'), dock: sampleModel('output-changes', now, 'dark'), run: sampleModel('output-failed', now, 'dark'), pages: sampleModel('overview-pages', now, 'dark'), conversation: sampleModel('conversation-start', now, 'dark'), beforePlan: sampleModel('ticket-conversation', now, 'dark'), talked: sampleModel('ticket-talk', now, 'dark'), needsYou: sampleModel('ticket-plan-needs-you', now, 'dark'), report: sampleModel('report', now, 'dark'), deployed: sampleModel('ticket-deploy-deployed', now, 'dark'), busy: sampleModel('ticket-deploy-busy', now, 'dark'), checking: sampleModel('ticket-deploy-checking', now, 'dark'), pickOff: sampleModel('ticket-deploy-pick-off', now, 'dark'), off: sampleModel('ticket-deploy-off', now, 'dark'), work: sampleModel('ticket-deploy-work', now, 'dark'), agentFailed: sampleModel('ticket-agent-failed', now, 'dark'), wall: sampleModel('ticket-blocked-wall', now, 'dark'), banners: sampleModel('ticket-banners', now, 'dark'), setup: sampleModel('setup', now, 'dark') });
const ok = (n = 1): BehaviourReport => ({ checks: Array.from({ length: n }, (_, i) => ({ what: `check ${i}`, ok: true })), error: null, sent: [{ type: 'ready' }] });

test('a case passes on a report whose every check held, and its checks are counted', () => {
  const r = judgeBehaviour([{ name: 'a', report: ok(3) }, { name: 'b', report: ok(2) }]);
  assert.deepEqual(r, { failures: [], checks: 5 });
});

test('a run fails on no cases, a case that wrote no report, one that checked nothing, and one stopped on an element it couldn\'t find', () => {
  assert.deepEqual(judgeBehaviour([]).failures, ['No case was run.']);
  assert.deepEqual(judgeBehaviour([{ name: 'a', report: null }]).failures, ['a: the page wrote no report']);
  assert.deepEqual(judgeBehaviour([{ name: 'a', report: { ...ok(0) } }]).failures, ['a: checked nothing']);
  // Not found is a failure, never a skip: the checks before it held, and the case still fails.
  assert.deepEqual(judgeBehaviour([{ name: 'a', report: { ...ok(2), error: 'not found: .fold-toggle' } }]).failures, ['a: stopped: not found: .fold-toggle']);
});

test('a failed check fails its case, saying what it found; one that held says nothing', () => {
  const report: BehaviourReport = { checks: [{ what: 'Escape closes it', ok: false, detail: 'true' }, { what: 'it opens', ok: true }], error: null, sent: [] };
  assert.deepEqual(judgeBehaviour([{ name: 'esc', report }]).failures, ['esc: Escape closes it (found true)']);
  assert.equal(caseFailed(report), true);
  assert.equal(caseFailed(ok()), false);
  // A page that wrote nothing hasn't been seen to fail: it can't count as catching a mutant.
  assert.equal(caseFailed(null), false);
});

test('a message the page sent that the extension wouldn\'t take fails the case, by the extension\'s own check', () => {
  const report = { ...ok(), sent: [{ type: 'ready' }, { type: 'rule-accept', project: '/r', id: 'not an id' }] };
  const r = judgeBehaviour([{ name: 'a', report }]);
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0]!, /^a: the page sent a message the extension wouldn't take: \{"type":"rule-accept"/);
});

test('the report is read from the page Chrome dumped, and a page that never wrote one gives none', () => {
  const report = ok(2);
  assert.deepEqual(dumpedBehaviour(`<body><main></main><script type="application/json" id="acc-behaviour">${JSON.stringify(report)}</script></body>`), report);
  assert.equal(dumpedBehaviour('<body><main></main></body>'), null);
});

test('a mutant is caught only when every case it names ran and failed; one that no longer fits its source, or names nothing, fails the run', () => {
  const m = MUTANTS[0]!;
  const failed: BehaviourReport = { ...ok(), checks: [{ what: 'Escape closes it', ok: false }] };
  const runs = (report: BehaviourReport | null) => m.kills.map((name) => ({ name, report }));
  assert.deepEqual(judgeMutants([{ mutant: m, applied: 1, runs: runs(failed) }]), []);
  assert.match(judgeMutants([{ mutant: m, applied: 1, runs: runs(ok()) }])[0]!, /passed with the behaviour broken/);
  assert.match(judgeMutants([{ mutant: m, applied: 1, runs: runs(null) }])[0]!, /wrote no report/);
  assert.match(judgeMutants([{ mutant: m, applied: 0, runs: [] }])[0]!, /0 times, not once/);
  assert.match(judgeMutants([{ mutant: m, applied: 2, runs: [] }])[0]!, /2 times, not once/);
  assert.deepEqual(judgeMutants([{ mutant: { ...m, kills: [] }, applied: 1, runs: [] }]), [`Mutant "${m.name}" names no case.`]);
  assert.deepEqual(judgeMutants([]), ['No mutant was run.']);
});

test('each mutant\'s change is in its webview source exactly once, changes it, and names cases that exist', () => {
  assert.ok(MUTANTS.length >= CASES.length, 'a mutant for each case at least');
  const names = new Set(CASES.map((c) => c.name));
  for (const m of MUTANTS) {
    const src = readFileSync(join(webview, m.file), 'utf8');
    assert.equal(occurrences(src, m.find), 1, `${m.name}: its change should be in ${m.file} once`);
    assert.notEqual(m.find, m.replace, `${m.name} changes nothing`);
    assert.ok(m.kills.length > 0, `${m.name} names no case`);
    for (const k of m.kills) assert.ok(names.has(k), `${m.name} names ${k}, which isn't a case`);
  }
  assert.equal(occurrences('abc', ''), 0, 'an empty change is in no source');
});

test('every case is named by a mutant that breaks what it checks, so none passes on a stub', () => {
  const killed = new Set(MUTANTS.flatMap((m) => m.kills));
  assert.deepEqual(CASES.filter((c) => !killed.has(c.name)).map((c) => c.name), []);
  assert.equal(new Set(CASES.map((c) => c.name)).size, CASES.length, 'two cases share a name');
});

test('the cases cover what the ticket lists: Escape, the backdrop, focus back, a redraw under it, a fold, Show all, Previous and Next, and Accept', () => {
  const said = CASES.map((c) => c.name).join('\n');
  for (const [modal, what] of [['task', /Escape/], ['task', /backdrop/], ['task', /focus back to its card, found again after the board redrew/], ['task', /new board model under it leaves it open, scrolled and typed in/], ['task', /fold/],
    ['detail', /Escape/], ['detail', /backdrop/], ['detail', /new model under it leaves it open/], ['detail', /Show all opens the whole list/], ['detail', /Previous and Next/], ['detail', /Accept/]] as const) {
    assert.ok(CASES.some((c) => c.name.startsWith(`${modal} modal`) && what.test(c.name)), `no ${modal} modal case for ${what}\n${said}`);
  }
});

test('what the cases expect comes from the same fixtures the pages draw: ten rules, each Accept a message the extension takes, a list longer than its page shows', () => {
  const d = behaviourData(models(), now);
  assert.equal(d.rules.length, 10);
  assert.ok(d.rules.every((r) => isFromWebview(r.accept)), 'every Accept the cases expect is one the extension takes');
  assert.deepEqual(Object.keys(d.rules[1]!.accept), ['type', 'project', 'id', 'line', 'title', 'check']);
  assert.ok((d.rules[1]?.sources ?? 0) > 4, 'the second rule has more reviews than its fold shows');
  assert.deepEqual(d.list, { key: 'needs-you', title: 'Needs you', shown: 3, total: 22 });
  // The cards the Overview case opens (T-36): every list but Needs you, each with every line, History in full.
  assert.deepEqual(d.cards.map((c) => [c.key, c.lines, c.history]), [['progress', 9, false], ['ready', 6, false], ['moment', 5, false], ['history', 13, true]]);
  assert.ok(d.cards.every((c) => /^.+, \d+: .+$/.test(c.name)), 'each card\'s name holds its count');
  assert.ok(d.machine >= 2, `${d.machine} facts on the machine line`);
  assert.equal(d.rulesOpens, '{"kind":"rules"}');
  assert.deepEqual([d.task.key, (d.task.message.model as { kind: string }).kind, d.task.peek], ['ACME-12', 'ticket', '/Users/me/code/acme-service#ACME-12']);
  // The Tasks board the cases open holds the card they click.
  assert.ok(JSON.stringify(models().tasks).includes('"ACME-12"'));
});

test('the task page case opens ACME-21\'s page, whose analysis has wording findings, and expects each one: the edge case of a list the page could drop', () => {
  const d = behaviourData(models(), now);
  assert.deepEqual(d.wording.map((f) => f.place), ['Criterion 2', 'Assumption 1'], 'two findings, from the sample analysis');
  assert.ok(d.wording.every((f) => f.message && f.text), 'each has its fix and its line');
  const c = CASES.find((x) => x.page === 'ticket-questions' && x.name.startsWith('task page:'));
  assert.ok(c, 'a case opens the task page');
  const m = caseModel(c, models()) as { kind: string; key: string };
  assert.deepEqual([m.kind, m.key], ['ticket', 'ACME-21']);
  assert.match(behaviourPage(c, m as never, d, FONTS), /<body class="vscode-light" data-view="ticket"/, 'the page takes the ticket model it is sent');
  assert.match(behaviourPage(CASES[0]!, models().tasks, d, FONTS), /data-view="home"/);
  assert.equal(MUTANTS.filter((x) => x.kills.includes(c.name)).length, 3, 'a mutant hides the findings, one draws each under every line of its part, one keeps its section closed (T-151)');
});

test('the plan case opens ACME-21\'s approved plan and expects acc\'s words and a Change it the extension takes (T-97); edge case: the two options it clicks are neither the one chosen', () => {
  const d = behaviourData(models(), now);
  assert.equal(d.plan.ask, CHANGE_APPROVED);
  assert.deepEqual([d.plan.keep, d.plan.change], ['Choose this: Backfill too, for Which converted leads get roles', 'Choose this: Open deals only, for Which converted leads get roles']);
  assert.deepEqual(d.plan.sent, { type: 'plan-choose', project: '/Users/me/code/acme-service', task: 'ACME-21', decision: 'd2', option: 'c', yes: true });
  assert.ok(isFromWebview(d.plan.sent), 'a message the extension takes');
  const c = CASES.find((x) => x.name.startsWith('plan: on an approved plan'));
  assert.ok(c, 'a case drives the dialog');
  assert.equal(MUTANTS.filter((x) => x.kills.includes(c.name)).length, 6, 'a mutant for each of its clicks and keys');
});

test('the talk case opens ACME-21\'s approved v2 and expects acc\'s words, a Use this and a message the extension takes (T-98); edge case: on v1 its proposal would be off, so the conversation is had on v2', () => {
  const d = behaviourData(models(), now);
  assert.equal(d.talk.ask, CHANGE_APPROVED);
  assert.equal(d.talk.use, 'Use this: Choose Open deals only for Which converted leads get roles');
  assert.deepEqual(d.talk.sent, { type: 'talk-use', project: '/Users/me/code/acme-service', task: 'ACME-21', turn: 't2', proposal: 'p1', yes: true });
  assert.ok(isFromWebview(d.talk.sent) && isFromWebview(d.talk.send), 'messages the extension takes');
  assert.equal(sampleTalkApproved(now).talk?.turns[0]?.version, 2, 'had on the version that is approved');
  assert.equal(sampleTalkTicket(now, true).talk?.turns[1]?.proposals[0]?.from, 1, 'the same proposal on v1 is from an older version');
  const c = CASES.find((x) => x.name.startsWith('talk: on an approved plan'));
  assert.ok(c, 'a case drives Use this\'s question and the message box');
  assert.equal(MUTANTS.filter((x) => x.kills.includes(c.name)).length, 6, 'a mutant for each of its clicks and keys');
});

test('the review case opens ACME-19\'s page and expects its findings, must-fix first, and the click\'s message (T-53); edge case: a review with no file to open fails the oracle', () => {
  const d = behaviourData(models(), now);
  assert.deepEqual(d.review.findings.map((f) => f.label), ['Must fix', 'Worth a look', 'Worth a look']);
  assert.deepEqual(d.review.click, { type: 'review-file', project: '/Users/me/code/acme-service', task: 'ACME-19', file: 'force-app/main/default/classes/WelcomeEmailService.cls', line: 31 });
  const c = CASES.find((x) => x.page === 'ticket-review' && !x.name.includes('(T-142)'));
  assert.ok(c, 'a case opens the review');
  assert.equal((caseModel(c, models()) as { key: string }).key, 'ACME-19');
  assert.deepEqual(MUTANTS.filter((x) => x.kills.includes(c.name)).map((x) => x.name), ['a review that needs you doesn\'t say so on its tab', 'the review lists its findings in the reviewer\'s order', 'a finding\'s file and line sends nothing']);
  const m = models();
  const review = m.review as TicketModel;
  const closed = { ...review, review: { ...review.review!, findings: review.review!.findings.map((f) => ({ ...f, opens: null })) } };
  assert.throws(() => behaviourData({ ...m, review: closed }, now), /a file and line that opens/);
});

test('an Overview with no list longer than its page fails the oracle, not the cases', () => {
  const m = models();
  const home = m.overview as HomeModel;
  const overview: HomeModel = { ...home, overview: { ...home.overview, landing: [] } };
  assert.throws(() => behaviourData({ ...m, overview }, now), /no list with more than its page shows/);
});

test('each case\'s page is script the browser can parse: its helpers and case, with no string from the model able to close it', () => {
  const d = behaviourData(models(), now);
  for (const c of CASES) {
    const html = behaviourPage(c, caseModel(c, models()), d, FONTS);
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]!);
    assert.equal(inline.length, 1, `${c.name}: one inline script`);
    assert.doesNotThrow(() => new Script(inline[0]!), `${c.name}: its script parses`);
    for (const h of HELPERS) assert.ok(inline[0]!.includes(`const ${h.name} = `), `${c.name}: has ${h.name}`);
    assert.ok(inline[0]!.includes('const RUN = async function'), `${c.name}: has its case`);
    // No type annotation survives into the page: Node stripped them.
    assert.doesNotMatch(inline[0]!, /: Probe\b|<HTMLDialogElement>/);
  }
  assert.match(behaviourPage(CASES[0]!, { kind: 'home', title: '</script><b>' } as never, d, FONTS), /\\u003c\/script>\\u003cb>/);
});

test('a full run checks the modals\' behaviour too, a run of one theme or width doesn\'t, and --behaviour runs it alone', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'scripts', 'screenshot.ts'), 'utf8');
  assert.match(src, /const full = views\.length === PAGES\.length && themes\.length === PALETTE_THEMES\.length && values\.width === WIDTHS\.join\(','\);/);
  assert.match(src, /const behaviour = full \? await behaviourRun\(chrome, jobs\) : 0;/);
  assert.match(src, /if \(values\.behaviour\) \{[\s\S]*?return behaviourRun\(chrome, jobs\);/);
  assert.match(src, /return behaviour;\n\}/);
});
