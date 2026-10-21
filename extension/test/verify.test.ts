// Verify the developer's work on a task's page (T-84): the section shows the pull request, each check, each
// criterion and the findings, or the pull requests to choose from; it's off, with why, for a task acc's own
// builder made, one with no tracker ticket, a project with no GitHub repo, and while one runs. Its buttons
// ask acc, in the output panel, and Open the QA comment goes to the comment's update draft on the page.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Task } from '../../packages/core/src/ledger.ts';
import { tempDir } from '../../packages/core/test/temp-root.ts';
import { OWN_WORK, type PrChoice, qaComment, type Verification, verificationPath, verificationsDir } from '../../packages/core/src/verify.ts';
import { Verifications, type VerifyHost } from '../src/logic/verify.ts';
import { PROCESSES } from '../src/logic/processes.ts';
import { stateOf } from '../src/logic/shared.ts';
import type { FromWebview } from '../src/model/messages.ts';
import { modalTakes } from '../src/model/task-modal.ts';
import { ticketModel } from '../src/model/task-page.ts';
import { area, commentRefusal, ticketVerify, VERIFY_ACTIONS, VERIFY_DONE, VERIFY_LOOK, type VerifyIn } from '../src/model/verify.ts';
import { accTimeoutMs } from '../src/run.ts';
import { pageDom, type PageElement } from './page-dom.ts';

const SHA = 'a'.repeat(40);
const pr = (n: number) => ({ number: n, url: `https://github.com/acme/service/pull/${n}`, title: `ACME-7 try ${n}`, head: `acme-7-try-${n}`, base: 'dev', sha: SHA });

function verification(more: Partial<Verification> = {}): Verification {
  const v = {
    pr: pr(7), sha: SHA, verdict: 'changes' as const, summary: 'A Gold case does not escalate.',
    checks: [{ gate: 'lint', status: 'pass' as const, summary: 'Passed.' }, { gate: 'validate', status: 'skip' as const, summary: 'It couldn\'t run here: dev has no org alias.' }, { gate: 'tests', status: 'fail' as const, summary: '2 failed.' }],
    criteria: [{ text: 'A premium case escalates.', met: true, evidence: 'escalate.js:1' }, { text: 'A Gold case escalates.', met: false, evidence: 'Nothing reads Gold.' }],
    findings: [{ message: 'Add Gold.', must: true, file: 'escalate.js', line: 3 }, { message: 'Name the constant.', must: false }],
  };
  return { v: 1, task: 'ACME-7', key: 'ACME-7', ...v, update: 'ACME-7.1', comment: qaComment(v), wording: [], sessionId: 's', name: 'n', at: '2026-10-21T12:00:00Z', durationMs: 1, costUsd: null, ...more };
}

const jiraTask = (more: Partial<Task> = {}) => ({ id: 'ACME-7', source: { kind: 'jira' as const, key: 'ACME-7', url: 'https://acme.example/browse/ACME-7' }, run: null, state: 'todo' as const, ...more }) as Task;
const input = (more: Partial<VerifyIn> = {}): VerifyIn => ({ task: jiraTask(), github: 'acme/service', verification: null, choice: null, verifying: false, updates: [], ...more });

// ---------------------------------------------------------------- the task page's section

test('before a verification the section offers Verify the developer\'s work, and says what it does', () => {
  const v = ticketVerify(input());
  assert.deepEqual([v.look, v.verify, v.comment, v.clear, v.pr, v.choice], [VERIFY_LOOK.none, { label: 'Verify the developer\'s work', disabled: null }, null, null, null, null]);
  assert.match(v.note!, /acc finds the pull request that names this ticket/);
});

test('edge: the section is off, with why, for a task acc\'s own builder made, one with no tracker ticket, and a project with no GitHub repo', () => {
  const own = ticketVerify(input({ task: jiraTask({ run: { branch: 'task/ACME-7-x', worktree: '/w' } as never }) }));
  assert.deepEqual([own.look, own.verify.disabled], [VERIFY_LOOK.off, `${OWN_WORK}: this task's review is in its Agent panel.`]);
  assert.equal(OWN_WORK, 'acc reviews its own builders\' work');
  const manual = ticketVerify(input({ task: jiraTask({ source: { kind: 'manual', key: null, url: null } }) }));
  assert.match(manual.verify.disabled!, /has no tracker ticket, so there is no developer's pull request to find/);
  const noGithub = ticketVerify(input({ github: null }));
  assert.match(noGithub.verify.disabled!, /no GitHub repo/);
  for (const v of [own, manual, noGithub]) assert.deepEqual([v.note, v.comment, v.clear, v.checks], [v.verify.disabled, null, null, []]);
});

test('edge: while a verification runs every button is off with why, and the section says nothing is posted or pushed', () => {
  const v = ticketVerify(input({ verification: verification(), verifying: true, updates: [{ id: 'ACME-7.1', state: 'draft' }] }));
  assert.deepEqual(v.look, VERIFY_LOOK.running);
  assert.match(v.note!, /Nothing is posted or pushed/);
  for (const b of [v.verify, v.comment!, v.clear!]) assert.equal(b.disabled, 'It\'s verifying now');
});

test('a verification shows its pull request, each check with its icon and label, each criterion met or not, and the findings', () => {
  const v = ticketVerify(input({ verification: verification(), updates: [{ id: 'ACME-7.1', state: 'draft' }] }));
  assert.deepEqual([v.look.label, v.summary, v.at], ['Changes asked', 'A Gold case does not escalate.', '2026-10-21T12:00:00Z']);
  assert.deepEqual(v.pr, { number: 7, url: 'https://github.com/acme/service/pull/7', words: '#7 ACME-7 try 7 (acme-7-try-7 into dev)', sha: 'aaaaaaa' });
  assert.deepEqual(v.checks.map((c) => [c.gate, c.look.label, c.look.icon]), [['lint', 'pass', 'pass'], ['validate', 'skip', 'circle-slash'], ['tests', 'fail', 'error']]);
  assert.match(v.checks[1]!.summary, /couldn't run here/);
  assert.deepEqual(v.criteria.map((c) => c.look.label), ['Met', 'Not met']);
  assert.deepEqual(v.findings.map((f) => [f.look.label, f.place]), [['Must fix', 'escalate.js:3'], ['Worth a look', null]]);
  assert.deepEqual(v.comment, { label: 'Open the QA comment', update: 'ACME-7.1', disabled: null });
  assert.deepEqual([v.verify.label, v.clear], ['Verify again', { label: 'Clear', disabled: null }]);
  assert.equal(ticketVerify(input({ verification: verification({ verdict: 'pass' }) })).look, VERIFY_LOOK.pass);
  const worded = ticketVerify(input({ verification: verification({ wording: [{ file: '<stdin>', line: 1, col: 1, rule: 'semicolon', level: 'hard', match: ';', message: 'm' }] }) }));
  assert.deepEqual(worded.wording, { label: 'Wording: 1 finding', icon: 'whole-word', tone: 'orange' });
});

test('edge: Open the QA comment is off, with why, once its draft is posted, discarded or gone, or when the ticket took none', () => {
  const v = verification();
  assert.equal(commentRefusal(v, [{ id: 'ACME-7.1', state: 'draft' }]), null);
  assert.equal(commentRefusal(v, [{ id: 'ACME-7.1', state: 'posting' }]), null);
  assert.equal(commentRefusal(v, [{ id: 'ACME-7.1', state: 'posted' }]), 'You posted it.');
  assert.match(commentRefusal(v, [{ id: 'ACME-7.1', state: 'discarded' }])!, /You discarded it/);
  assert.match(commentRefusal(v, [])!, /Its draft is gone/);
  assert.match(commentRefusal({ ...v, update: null }, [])!, /can't take an update/);
});

test('two pull requests found are a choice, each with Verify this one; none found says so; a choice older than the verification is spent', () => {
  const choice: PrChoice = { v: 1, task: 'ACME-7', at: '2026-10-21T13:00:00Z', found: [pr(7), pr(8)] };
  const v = ticketVerify(input({ choice }));
  assert.deepEqual([v.look, v.choice?.map((c) => c.number), v.verify.label], [VERIFY_LOOK.choose, [7, 8], 'Look again']);
  assert.match(v.note!, /2 open pull requests name ACME-7\. Choose the one to verify\./);
  const none = ticketVerify(input({ choice: { ...choice, found: [] } }));
  assert.deepEqual(none.choice, []);
  assert.match(none.note!, /No open pull request on acme\/service names ACME-7/);
  assert.equal(ticketVerify(input({ choice, verifying: true })).choice, null, 'edge: while one runs, no choice');
});

test('the task page\'s model holds the section for a task, and none for a ticket acc keeps no task for', () => {
  const base = { project: '/r', tracker: 0, trackerTitle: 'Jira', trackerKind: 'jira' as const, key: 'ACME-7', ticket: null, loading: false, error: null, connect: null, row: null, checks: [] };
  const section = ticketVerify(input());
  assert.deepEqual(ticketModel({ ...base, task: jiraTask(), verify: section }).verify, section);
  assert.equal(ticketModel({ ...base, task: null, verify: section }).verify, null);
});

// ---------------------------------------------------------------- asking acc

function host(o: { code?: number; stdout?: string; task?: Task; github?: string | null; onAcc?: () => void } = {}) {
  const root = tempDir('acc-verify-');
  const state = join(root, '.git', 'acc');
  mkdirSync(state, { recursive: true });
  const calls: { args: string[]; label?: string }[] = [];
  const h: VerifyHost = {
    project: (r) => (r === root ? { root, ledgerPath: join(state, 'ledger.json'), github: o.github === undefined ? 'acme/service' : o.github } : undefined),
    task: () => o.task ?? jiraTask(),
    acc: async (args, _cwd, label) => {
      calls.push({ args, ...(label ? { label } : {}) });
      o.onAcc?.();
      return { code: o.code ?? 0, stdout: o.stdout ?? '{}', stderr: '' };
    },
  };
  return { root, state, calls, h };
}

test('Verify asks acc in the output panel, with the pull request a person chose, and reads back what acc kept', async () => {
  const { root, state, calls, h } = host();
  const changed: string[] = [];
  const v = new Verifications(h, (_r, id) => changed.push(id));
  let during = false;
  const busy = new Verifications({ ...h, acc: async (...a) => { during = busy.running(root, 'acme-7'); return h.acc(...a); } });
  assert.deepEqual(await busy.verify(root, 'acme-7'), { ok: true });
  assert.equal(during, true, 'it shows as running while acc runs');
  assert.deepEqual(await v.verify(root, 'ACME-7', 8), { ok: true });
  assert.deepEqual(calls, [{ args: ['verify', 'ACME-7', '--json'], label: 'Verify ACME-7\'s pull request' }, { args: ['verify', 'ACME-7', '--pr', '8', '--json'], label: 'Verify ACME-7\'s pull request' }]);
  assert.deepEqual(changed, ['ACME-7', 'ACME-7']);
  // What acc kept: the latest verification.
  mkdirSync(verificationsDir({ stateDir: state }), { recursive: true });
  writeFileSync(verificationPath({ stateDir: state }, 'ACME-7', SHA), JSON.stringify(verification()));
  assert.equal(v.state(root, 'acme-7').verification?.sha, SHA);
  assert.deepEqual([v.state(root, 'ACME-7').choice, v.state(root, 'ACME-7').verifying], [null, false]);
  assert.deepEqual(v.state('/elsewhere', 'ACME-7'), { verification: null, choice: null, verifying: false }, 'edge: a project that closed');
});

test('edge: none or several found isn\'t a failure here, as the page shows the choice; another refusal comes back in process words', async () => {
  const refused = JSON.stringify({ error: 'several-prs', message: '2 open pull requests name ACME-7. Name one: acc verify ACME-7 --pr <number>.' });
  const chose = host({ code: 1, stdout: refused, onAcc: () => {
    mkdirSync(verificationsDir({ stateDir: chose.state }), { recursive: true });
    writeFileSync(join(verificationsDir({ stateDir: chose.state }), 'ACME-7.found.json'), JSON.stringify({ v: 1, task: 'ACME-7', at: new Date(Date.now() + 1000).toISOString(), found: [pr(7), pr(8)] }));
  } });
  const v = new Verifications(chose.h);
  assert.deepEqual(await v.verify(chose.root, 'ACME-7'), { ok: true });
  assert.deepEqual(v.state(chose.root, 'ACME-7').choice?.found.map((p) => p.number), [7, 8]);
  const other = host({ code: 1, stdout: JSON.stringify({ error: 'verify', message: 'git couldn\'t fetch #7 from origin: denied' }) });
  assert.deepEqual(await new Verifications(other.h).verify(other.root, 'ACME-7'), { ok: false, error: 'git couldn\'t fetch #7 from origin: denied' });
  const words = host({ code: 1, stdout: refused });
  const r = await new Verifications(words.h).verify(words.root, 'ACME-7');
  assert.equal(r.ok, false);
  assert.doesNotMatch((r as { error: string }).error, /acc verify/, 'process words, not commands');
});

test('edge: a task with no ticket, one acc built, a closed project and one already running are refused before acc runs', async () => {
  const manual = host({ task: jiraTask({ source: { kind: 'manual', key: null, url: null } }) });
  assert.match((await new Verifications(manual.h).verify(manual.root, 'ACME-7') as { error: string }).error, /has no tracker ticket/);
  const own = host({ task: jiraTask({ run: { branch: 'b' } as never }) });
  assert.match((await new Verifications(own.h).verify(own.root, 'ACME-7') as { error: string }).error, /reviews its own builders' work/);
  assert.deepEqual(await new Verifications(manual.h).verify('/gone', 'ACME-7'), { ok: false, error: 'That project isn\'t open any more.' });
  const running = host();
  mkdirSync(verificationsDir({ stateDir: running.state }), { recursive: true });
  writeFileSync(join(verificationsDir({ stateDir: running.state }), 'ACME-7.running.json'), JSON.stringify({ sessionId: 's', name: 'n', startedAt: 'x', pid: process.pid }));
  const v = new Verifications(running.h);
  assert.deepEqual(await v.verify(running.root, 'ACME-7'), { ok: false, error: 'ACME-7\'s pull request is being verified now.' });
  assert.match((await v.clear(running.root, 'ACME-7') as { error: string }).error, /Clear it once that finishes/);
  for (const h of [manual, own, running]) assert.deepEqual(h.calls, []);
});

test('Clear asks acc to clear, and nothing more', async () => {
  const { root, calls, h } = host();
  assert.deepEqual(await new Verifications(h).clear(root, 'acme-7'), { ok: true });
  assert.deepEqual(calls, [{ args: ['verify', 'clear', 'ACME-7', '--json'] }]);
  assert.deepEqual(await new Verifications(h).clear('/gone', 'ACME-7'), { ok: false, error: 'That project isn\'t open any more.' });
});

// ---------------------------------------------------------------- the page

test('the page\'s messages are checked before the extension acts, and the modal takes only its own task\'s', () => {
  for (const type of VERIFY_ACTIONS) {
    const check = area.messages![type]!;
    assert.equal(check({ project: '/r', task: 'ACME-7' }), true, type);
    assert.equal(check({ project: '/r', task: '../x' }), false, `${type}: edge: not a task id`);
    assert.equal(check({ project: '', task: 'ACME-7' }), false, `${type}: edge: no project`);
  }
  assert.equal(area.messages!['verify-run']!({ project: '/r', task: 'ACME-7', pr: 8 }), true);
  for (const bad of [0, -1, 1.5, '8']) assert.equal(area.messages!['verify-run']!({ project: '/r', task: 'ACME-7', pr: bad }), false, `edge: pr ${bad}`);
  const o = { project: '/r', key: 'ACME-7' } as never;
  for (const type of VERIFY_ACTIONS) {
    assert.equal(modalTakes(o, { type, project: '/r', task: 'acme-7' } as FromWebview, new Set()), true, type);
    assert.equal(modalTakes(o, { type, project: '/r', task: 'ACME-8' } as FromWebview, new Set()), false, `${type}: another task's`);
  }
});

const all = (e: PageElement): PageElement[] => [e, ...e.children.flatMap((c) => (typeof c === 'string' ? [] : all(c)))];
const buttons = (e: PageElement): PageElement[] => all(e).filter((x) => x.tagName === 'BUTTON');

test('the section draws its rows and buttons; Verify this one sends the number, and Open the QA comment goes to its update draft', async () => {
  const page = pageDom();
  const { renderVerify, openComment } = await import('../webview/verify.ts');
  const m = { project: '/r', key: 'ACME-7' } as never;
  const sec = renderVerify(m, ticketVerify(input({ verification: verification(), updates: [{ id: 'ACME-7.1', state: 'draft' }] }))) as unknown as PageElement;
  assert.match(sec.textContent, /Verify the developer's work.*Changes asked/);
  assert.match(sec.textContent, /Checks.*lint.*validate.*Acceptance criteria.*Met.*Not met.*Findings.*Must fix/);
  assert.deepEqual(buttons(sec).map((b) => b.textContent), ['Open the QA comment', 'Verify again', 'Clear']);
  // Open the QA comment: its draft's card on the page, scrolled to, its text focused.
  const focused: string[] = [];
  const card = (id: string) => ({ dataset: { update: id }, scrollIntoView: () => focused.push(`scroll ${id}`), querySelector: () => ({ focus: () => focused.push(`focus ${id}`) }) });
  const root = { querySelectorAll: () => [card('ACME-7.0'), card('ACME-7.1')] } as never;
  assert.equal(openComment('ACME-7.1', root), true);
  assert.deepEqual(focused, ['scroll ACME-7.1', 'focus ACME-7.1']);
  assert.equal(openComment('ACME-7.9', root), false, 'edge: its card isn\'t on the page');
  // A choice: Verify this one sends its number.
  const choose = renderVerify(m, ticketVerify(input({ choice: { v: 1, task: 'ACME-7', at: 'x', found: [pr(7), pr(8)] } }))) as unknown as PageElement;
  const pick = buttons(choose).filter((b) => b.textContent === 'Verify this one');
  assert.equal(pick.length, 2);
  pick[1]!.click();
  assert.deepEqual(page.sent.at(-1), { type: 'verify-run', project: '/r', task: 'ACME-7', pr: 8 });
});

test('the page takes the replies by the name the extension sends, draws the section over the Activity, and each update card names its draft', () => {
  const source = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.equal(VERIFY_DONE, 'verify-done');
  assert.match(source('../webview/verify.ts'), new RegExp(`'${VERIFY_DONE}': done`));
  const page = source('../webview/task-page.ts');
  const at = page.indexOf('if (m.verify) main.append(renderVerify(m, m.verify));');
  assert.ok(at > page.indexOf('renderCriteria(m, m.criteria)') && at < page.indexOf('renderActivity(m)'), 'under the criteria, over the Activity');
  assert.match(source('../webview/updates.ts'), /d\.dataset\.update = c\.id;/);
});

test('the process words name each verify command, and the extension waits for the checks and the verifier', () => {
  const names = (acc: string) => PROCESSES.find((p) => p.acc.includes(acc))?.name;
  assert.deepEqual([names('verify'), names('verify show'), names('verify clear')], ['Verify the developer\'s pull request', 'See the verification', 'Clear the verification']);
  assert.ok(accTimeoutMs(['verify', 'ACME-7']) > 2 * 60 * 60_000);
  assert.equal(accTimeoutMs(['verify', 'clear', 'ACME-7']), accTimeoutMs(['set', 'ACME-7', 'todo']));
  assert.equal(accTimeoutMs(['verify', 'show', 'ACME-7']), accTimeoutMs(['set', 'ACME-7', 'todo']));
});

test('stateOf: the state directory is the one beside the ledger, for any project path', () => {
  assert.deepEqual(stateOf({ ledgerPath: '/work/acme/.acc/ledger.json' }), { stateDir: '/work/acme/.acc' });
});
