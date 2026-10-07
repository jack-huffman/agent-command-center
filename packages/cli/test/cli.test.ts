import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DISPLAY, mutate, parseConfig, readLedger, repoPaths, run, transcriptDir, upsertTasks } from '../../core/src/index.ts';
import { GENERIC_CONFIG, gh41Lines, makeRepo, tempDir } from '../../core/test/support.ts';

const MAIN = fileURLToPath(new URL('../src/main.ts', import.meta.url));
// A builder's `acc gate run` runs these tests with its own ACC_TASK set, holding the machine's heavy-check slot.
const HEAVY_DIR = join(tempDir('acc-heavy-'), 'slots');

function acc(cwd: string, args: string[], input?: string, env: NodeJS.ProcessEnv = {}) {
  const r = spawnSync(process.execPath, ['--no-warnings', MAIN, ...args], {
    cwd, input, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', ACC_ROLE: '', ACC_TASK: '', ACC_HEAVY_DIR: HEAVY_DIR, ...env },
  });
  return { code: r.status ?? 1, out: r.stdout, err: r.stderr, json: () => JSON.parse(r.stdout) };
}

function repoWithConfig(config: unknown = GENERIC_CONFIG): string {
  return makeRepo({ '.acc/config.json': JSON.stringify(config) });
}

test('help, version and bad usage', () => {
  const dir = makeRepo();
  // The one version, the root package.json's (D-079).
  const { version } = JSON.parse(readFileSync(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8')) as { version: string };
  assert.equal(acc(dir, ['--version']).out, `${version}\n`);
  assert.match(acc(dir, ['help']).out, new RegExp(`^acc ${version.replaceAll('.', '\\.')}: Agent Command Center`));
  assert.match(acc(dir, ['help']).out, /acc doctor/);
  assert.equal(acc(dir, ['nope']).code, 2);
  assert.equal(acc(dir, ['--nope']).code, 2);
});

test('init --profile generic writes a config that doctor accepts', () => {
  const dir = makeRepo();
  const r = acc(dir, ['init', '--profile', 'generic', '--project', 'Tool', '--json']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json().config.environments[0].branch, 'main');
  const cfg = JSON.parse(readFileSync(join(dir, '.acc', 'config.json'), 'utf8'));
  assert.equal(cfg.project, 'Tool');
  assert.equal(acc(dir, ['init', '--profile', 'generic']).code, 1, 'refuses to overwrite without --force');
  const doctor = acc(dir, ['doctor', '--part', 'project', '--json']).json() as { id: string; status: string }[];
  assert.equal(doctor.find((d) => d.id === 'B0.config')!.status, 'pass');
});

test('add, list, ready, set and show: a task through its life', () => {
  const dir = repoWithConfig();
  assert.equal(acc(dir, ['add', 'First thing']).code, 0);
  assert.equal(acc(dir, ['add', 'Second thing', '--dep', 'T-1', '--brief', 'Needs the first']).code, 0);
  const ready = acc(dir, ['ready', '--json']).json() as { id: string }[];
  assert.deepEqual(ready.map((t) => t.id), ['T-1']);
  assert.match(acc(dir, ['list']).out, /T-2\s+○ To do\s+main\s+Second thing\s+T-1/);

  const refused = acc(dir, ['set', 'T-2', 'running']);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /waiting on T-1, which is todo/);

  assert.equal(acc(dir, ['set', 'T-1', 'running']).code, 0);
  assert.equal(acc(dir, ['set', 't-1', 'review', '--as', 'builder']).code, 0, 'ids are case-insensitive');
  assert.equal(acc(dir, ['set', 'T-1', 'done', '--as', 'builder']).code, 1, 'a builder cannot mark work done');
  assert.equal(acc(dir, ['set', 'T-1', 'done']).code, 0);
  assert.deepEqual((acc(dir, ['ready', '--json']).json() as { id: string }[]).map((t) => t.id), ['T-2']);

  const show = acc(dir, ['show', 'T-1']).out;
  assert.match(show, /todo → running {2}by human:/);
  assert.match(show, /review → done/);
});

test('status: one line of counts by display state, nothing in play, and every state in --json', () => {
  const dir = repoWithConfig();
  // A claude that leaves a mark, to prove status never starts one.
  const bin = join(dir, '.fakebin');
  mkdirSync(bin);
  const mark = join(dir, 'claude-ran');
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\ntouch "${mark}"\n`);
  chmodSync(join(bin, 'claude'), 0o755);
  const status = (...args: string[]) => acc(dir, ['status', ...args], undefined, { PATH: `${bin}:${process.env.PATH}` });

  assert.equal(status().out.trim(), 'Nothing in play.');
  const zero = Object.fromEntries(Object.keys(DISPLAY).map((s) => [s, 0]));
  assert.deepEqual(status('--json').json(), { counts: zero });

  const ledgerPath = join(dir, '.git', 'acc', 'ledger.json');
  const put = (tasks: { title: string; deps?: string[] }[], states: Record<string, Record<string, unknown>>) => {
    acc(dir, ['import'], JSON.stringify(tasks.map((t) => ({ source: { kind: 'manual' }, ...t }))));
    const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    for (const t of ledger.tasks) Object.assign(t, states[t.id]);
    writeFileSync(ledgerPath, JSON.stringify(ledger));
  };
  put([{ title: 'Merged' }], { 'T-1': { state: 'done' } });
  assert.equal(status().out.trim(), 'Nothing in play.', 'done is left out');

  put([{ title: 'Fails CI' }, { title: 'In review' }, { title: 'Building' }, { title: 'Next up' }, { title: 'Also next' }, { title: 'Stuck' }, { title: 'Later', deps: ['T-5'] }], {
    'T-2': { state: 'review', pr: { number: 2, url: 'https://github.com/o/r/pull/2', state: 'open', ci: 'failing' } },
    'T-3': { state: 'review' },
    'T-4': { state: 'running' },
    'T-7': { state: 'blocked', blocker: 'needs a sandbox' },
  });

  const line = status();
  assert.equal(line.code, 0, line.err);
  assert.equal(line.out, '1 running · 1 needs you · 1 in review · 1 blocked · 2 ready · 1 to do\n');
  assert.deepEqual(status('--json').json(), { counts: { ...zero, running: 1, 'needs-you': 1, review: 1, blocked: 1, ready: 2, todo: 1, done: 1 } });
  assert.ok(!existsSync(mark), 'status never starts claude');
  assert.match(acc(dir, ['help']).out, /Tasks\n(?:.+\n)*? {2}acc status /);
});

test('builders are identified from ACC_ROLE and ACC_TASK', () => {
  const dir = repoWithConfig();
  acc(dir, ['add', 'Work']);
  acc(dir, ['set', 'T-1', 'running']);
  const r = acc(dir, ['set', 'T-1', 'blocked', '--reason', 'org is down', '--json'], undefined, { ACC_ROLE: 'builder', ACC_TASK: 'T-1' });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json().entry.by, 'builder:T-1');
  assert.equal(r.json().task.blocker, 'org is down');
});

// ---------------------------------------------------------------- ticket updates (D-066)

/** A repo with GH-3 (a GitHub issue) and ACME-7 (a Jira ticket) running, and a gh that records what it posts. */
function ticketsRepo() {
  const dir = repoWithConfig({ ...GENERIC_CONFIG, github: { repo: 'o/r', account: 'me' } });
  const items = [
    { source: { kind: 'github', key: '#3', url: 'https://github.com/o/r/issues/3' }, title: 'Fix login' },
    { source: { kind: 'jira', key: 'ACME-7', url: 'https://acme.atlassian.net/browse/ACME-7' }, title: 'Escalate premium cases' },
  ];
  assert.equal(acc(dir, ['import'], JSON.stringify(items)).code, 0);
  for (const id of ['GH-3', 'ACME-7']) assert.equal(acc(dir, ['set', id, 'running']).code, 0);
  const bin = join(dir, '.fakebin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), `#!/bin/sh
case "$1 $2" in
  "auth token") [ "$4" = "me" ] && echo tok-me || exit 1 ;;
  "issue comment") [ "$GH_TOKEN" = "tok-me" ] || { echo "wrong account" >&2; exit 1; }; echo "$1 $2 $3 $4 $5 $6" > "${dir}/gh-args"; cat "$7" > "${dir}/gh-body"; echo https://github.com/o/r/issues/3#issuecomment-1 ;;
  *) exit 1 ;;
esac
`);
  chmodSync(join(bin, 'gh'), 0o755);
  return { dir, env: { PATH: `${bin}:${process.env.PATH}` }, updates: join(dir, '.git', 'acc', 'updates') };
}

test('acc block --client blocks and drafts an update with the question; a plain block stays internal', () => {
  const { dir, updates } = ticketsRepo();
  const builder = { ACC_ROLE: 'builder', ACC_TASK: 'GH-3' };
  const r = acc(dir, ['block', '--client', 'Should Gold customers count as Premium?', '--json'], undefined, builder);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual([r.json().task.state, r.json().task.blocker], ['blocked', 'Waiting on the client: Should Gold customers count as Premium?']);
  assert.deepEqual([r.json().update.id, r.json().update.event, r.json().update.by, r.json().update.text], ['GH-3.1', 'blocked', 'builder:GH-3', 'We need your input before we can go on:\nShould Gold customers count as Premium?']);
  assert.match(acc(dir, ['help']).out, /acc block \[<id>\] --client "<question>"/);

  const plain = acc(dir, ['block', 'ACME-7', 'the sandbox is down', '--json'], undefined, { ACC_ROLE: 'builder', ACC_TASK: 'ACME-7' });
  assert.equal(plain.code, 0, plain.err);
  assert.equal(plain.json().update, undefined);
  assert.deepEqual(readdirSync(updates), ['GH-3.1.json'], 'only the client\'s question is drafted');
  assert.equal(acc(dir, ['set', 'ACME-7', 'running', '--client', 'Why?']).code, 2, '--client goes only with blocking');
  assert.equal(acc(dir, ['set', 'ACME-7', 'blocked', '--client', 'Which queue?']).code, 1, 'a blocked task can\'t be blocked again');

  // A task's id with only --client after it is the task, not the reason.
  const named = ticketsRepo();
  const p = acc(named.dir, ['block', 'ACME-7', '--client', 'Which queue should Gold cases go to?', '--json']);
  assert.equal(p.code, 0, p.err);
  assert.deepEqual([p.json().task.id, p.json().task.blocker, p.json().update.key], ['ACME-7', 'Waiting on the client: Which queue should Gold cases go to?', 'ACME-7']);
});

test('acc updates lists the drafts; a person posts a GitHub one with their edits, as the repo\'s account, and discards another', () => {
  const { dir, env } = ticketsRepo();
  assert.equal(acc(dir, ['set', 'GH-3', 'blocked', '--client', 'Which browsers must it support?']).code, 0);
  assert.equal(acc(dir, ['set', 'ACME-7', 'blocked', '--client', 'Which queue should Gold cases go to?']).code, 0);
  const listed = acc(dir, ['updates', '--json']);
  assert.equal(listed.code, 0, listed.err);
  assert.deepEqual(listed.json().map((u: { id: string; state: string; key: string }) => [u.id, u.state, u.key]), [['GH-3.1', 'draft', '#3'], ['ACME-7.1', 'draft', 'ACME-7']]);
  assert.match(acc(dir, ['updates']).out, /GH-3\.1 +draft {2}GitHub #3: a question for the client[\s\S]*Which browsers must it support\?/);

  // Edited before it goes: the edited text is what's posted, through gh as the repo's account.
  const edited = join(dir, 'edited.md');
  writeFileSync(edited, 'Quick question before we go on: which browsers must the login page support?\n');
  const posted = acc(dir, ['update', 'post', 'GH-3.1', '--text-file', edited, '--json'], undefined, env);
  assert.equal(posted.code, 0, posted.err);
  assert.equal(readFileSync(join(dir, 'gh-args'), 'utf8').trim(), `issue comment 3 -R o/r --body-file`);
  assert.equal(readFileSync(join(dir, 'gh-body'), 'utf8'), 'Quick question before we go on: which browsers must the login page support?\n');
  const u = posted.json();
  assert.deepEqual([u.state, u.posted.text, u.posted.url, u.posted.by], ['posted', 'Quick question before we go on: which browsers must the login page support?', 'https://github.com/o/r/issues/3#issuecomment-1', `human:${process.env.USER ?? 'unknown'}`]);
  const again = acc(dir, ['update', 'post', 'GH-3.1'], undefined, env);
  assert.equal(again.code, 1);
  assert.match(again.err, /GH-3\.1 was posted by/);

  // Jira posts as you through the Command Center's sign-in, never from here.
  const jira = acc(dir, ['update', 'post', 'ACME-7.1'], undefined, env);
  assert.equal(jira.code, 1);
  assert.match(jira.err, /ACME-7\.1 is for Jira ticket ACME-7\. acc posts only on GitHub: post it from the Command Center/);
  const discarded = acc(dir, ['update', 'discard', 'acme-7.1', '--json']);
  assert.equal(discarded.code, 0, discarded.err);
  assert.equal(discarded.json().state, 'discarded');
  assert.deepEqual(acc(dir, ['updates', '--json']).json(), [], 'nothing waits');
  assert.deepEqual(acc(dir, ['updates', '--all', '--task', 'ACME-7', '--json']).json().map((x: { id: string; state: string }) => [x.id, x.state]), [['ACME-7.1', 'discarded']]);
  assert.match(acc(dir, ['updates']).out, /No drafts waiting/);
  assert.equal(acc(dir, ['update', 'post', 'GH-9.1']).code, 1);
  assert.equal(acc(dir, ['update', 'frob', 'GH-3.1']).code, 2);
});

test('a GitHub draft isn\'t posted on an issue now in another repo: it stays a draft, to discard (D-072)', () => {
  const { dir } = ticketsRepo();
  assert.equal(acc(dir, ['set', 'GH-3', 'blocked', '--client', 'Which browsers must it support?']).code, 0);
  const bin = join(dir, '.movedbin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), `#!/bin/sh
case "$1 $2" in
  "auth token") echo tok-me ;;
  "issue view") echo '{"url": "https://github.com/other/repo/issues/9"}' ;;
  "issue comment") touch "${dir}/commented" ;;
  *) exit 1 ;;
esac
`);
  chmodSync(join(bin, 'gh'), 0o755);
  const r = acc(dir, ['update', 'post', 'GH-3.1'], undefined, { PATH: `${bin}:${process.env.PATH}` });
  assert.equal(r.code, 1);
  assert.match(r.err, /#3 is in other\/repo now, not this repo's o\/r, so GH-3\.1 isn't posted\. Discard it if it no longer applies: acc update discard GH-3\.1/);
  assert.ok(!existsSync(join(dir, 'commented')), 'nothing was posted');
  assert.equal(acc(dir, ['updates', '--json']).json()[0].state, 'draft', 'it waits, unclaimed');
});

test('only a person reads, posts or discards a ticket\'s updates: never a builder, reviewer, analyst or autopilot', () => {
  const { dir, env } = ticketsRepo();
  assert.equal(acc(dir, ['set', 'GH-3', 'blocked', '--client', 'Which browsers?']).code, 0);
  for (const args of [['updates'], ['update', 'post', 'GH-3.1'], ['update', 'discard', 'GH-3.1'], ['update', 'ask', 'GH-3', 'q1'], ['update', 'posting', 'GH-3.1']]) {
    for (const role of ['builder', 'reviewer', 'analyst']) {
      const r = acc(dir, args, undefined, { ...env, ACC_ROLE: role, ACC_TASK: 'GH-3' });
      assert.equal(r.code, 1, `${role}: ${args.join(' ')}`);
      assert.match(r.err, new RegExp(`An? ${role} can't`), `${role}: ${args.join(' ')}`);
    }
    const autopilot = acc(dir, [...args, '--as', 'orchestrator', '--by', 'orchestrator:autopilot'], undefined, env);
    assert.equal(autopilot.code, 1, args.join(' '));
    assert.match(autopilot.err, /Only a person can/);
  }
  assert.equal(JSON.parse(readFileSync(join(dir, '.git', 'acc', 'updates', 'GH-3.1.json'), 'utf8')).state, 'draft', 'still a draft');
});

// ---------------------------------------------------------------- closing issues (D-082)

/** A repo whose GitHub tracker says "edits", with GH-3 and GH-4 done before acc closed issues, and a gh that records each close. */
function doneRepo() {
  const raw = { ...GENERIC_CONFIG, github: { repo: 'o/r', account: 'me' }, trackers: [{ kind: 'github', edits: true }] };
  const dir = repoWithConfig(raw);
  const config = parseConfig(raw).config!;
  const now = () => new Date('2026-10-06T12:00:00Z');
  mutate(repoPaths(dir, run), now, (l, emit) => {
    upsertTasks(l, config, [3, 4].map((n) => ({ source: { kind: 'github' as const, key: `#${n}`, url: `https://github.com/o/r/issues/${n}` }, title: `Issue ${n}` })), 'human', 'human:test', emit, now);
    for (const t of l.tasks) {
      const n = Number(t.id.slice(3)) + 2;
      t.state = 'done';
      t.pr = { number: n, url: `https://github.com/o/r/pull/${n}`, state: 'merged' };
    }
  });
  const bin = join(dir, '.fakebin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), `#!/bin/sh
case "$1 $2" in
  "auth token") [ "$4" = "me" ] && echo tok-me || exit 1 ;;
  "issue view") [ "$3" = 3 ] && echo '{"state": "OPEN", "stateReason": null, "url": "https://github.com/o/r/issues/3"}' || echo '{"state": "CLOSED", "stateReason": "COMPLETED", "url": "https://github.com/o/r/issues/4"}' ;;
  "issue close") [ "$GH_TOKEN" = "tok-me" ] || { echo "wrong account" >&2; exit 1; }; echo "$@" >> "${dir}/closed" ;;
  *) exit 1 ;;
esac
`);
  chmodSync(join(bin, 'gh'), 0o755);
  return { dir, env: { PATH: `${bin}:${process.env.PATH}` }, ledger: repoPaths(dir, run).ledger };
}

test('acc sync --close-done closes the issues of tasks already done, listing each; --plan only lists them, and a second run does nothing', () => {
  const { dir, env, ledger } = doneRepo();
  assert.equal(acc(dir, ['sync', '--plan'], undefined, env).code, 2, '--plan goes with --close-done');
  const seq = readLedger(ledger).seq;
  const plan = acc(dir, ['sync', '--close-done', '--plan'], undefined, env);
  assert.equal(plan.code, 0, plan.err);
  assert.equal(plan.out, [
    'The done tasks whose issues the tidy would close (nothing is changed). A sync may also close those of tasks merged since it last ran:',
    '  GH-3 (pull request #5): would close issue #3',
    '  GH-4 (pull request #6): would leave issue #4 as it is: it was already closed',
    'Close them with acc sync --close-done.',
    '',
  ].join('\n'));
  assert.ok(!existsSync(join(dir, 'closed')), '--plan closes nothing');
  assert.equal(readLedger(ledger).seq, seq, 'and writes nothing');

  const r = acc(dir, ['sync', '--close-done'], undefined, env);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, ['The issues of tasks already done:', '  GH-3 (pull request #5): closed issue #3', '  GH-4 (pull request #6): left issue #4 as it is: it was already closed', ''].join('\n'));
  assert.equal(readFileSync(join(dir, 'closed'), 'utf8'), 'issue close 3 -R o/r --reason completed --comment Done: pull request #5 merged into main.\n', 'as the repo\'s account');
  const tasks = readLedger(ledger).tasks;
  assert.deepEqual(tasks.map((t) => [t.id, t.pr?.issue?.state, t.pr?.issue?.reason]), [['GH-3', 'closed', undefined], ['GH-4', 'left', 'it was already closed']]);

  const again = acc(dir, ['sync', '--close-done', '--json'], undefined, env);
  assert.deepEqual(again.json(), { checked: 0, changes: [], closeDone: [] }, 'a second run does nothing');
  assert.match(acc(dir, ['sync', '--close-done'], undefined, env).out, /No done task's issue is waiting to close\./);
});

test('acc sync --close-done --json carries each outcome', () => {
  const { dir, env } = doneRepo();
  const r = acc(dir, ['sync', '--close-done', '--json'], undefined, env);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json().closeDone, [
    { task: 'GH-3', key: '#3', pr: 5, outcome: 'closed' },
    { task: 'GH-4', key: '#4', pr: 6, outcome: 'left', reason: 'it was already closed' },
  ]);
});

test('only a person runs acc sync --close-done: never a builder, reviewer, analyst or autopilot', () => {
  const { dir, env, ledger } = doneRepo();
  const seq = readLedger(ledger).seq;
  for (const args of [['sync', '--close-done'], ['sync', '--close-done', '--plan']]) {
    for (const role of ['builder', 'reviewer', 'analyst']) {
      const r = acc(dir, args, undefined, { ...env, ACC_ROLE: role, ACC_TASK: 'GH-3' });
      assert.equal(r.code, 1, `${role}: ${args.join(' ')}`);
      assert.match(r.err, new RegExp(`An? ${role} can't close the issues of tasks already done`), `${role}: ${args.join(' ')}`);
    }
    const autopilot = acc(dir, [...args, '--as', 'orchestrator', '--by', 'orchestrator:autopilot'], undefined, env);
    assert.equal(autopilot.code, 1, args.join(' '));
    assert.match(autopilot.err, /Only a person can/);
  }
  assert.ok(!existsSync(join(dir, 'closed')), 'nothing was closed');
  assert.equal(readLedger(ledger).seq, seq);
  const builderSync = acc(dir, ['sync'], undefined, { ...env, ACC_ROLE: 'builder', ACC_TASK: 'GH-3' });
  assert.equal(builderSync.code, 0, 'a plain sync is anyone\'s');
});

test('acc sync --close-done says so when no GitHub tracker lets acc change tickets', () => {
  const dir = repoWithConfig({ ...GENERIC_CONFIG, github: { repo: 'o/r', account: 'me' }, trackers: [{ kind: 'github' }] });
  const r = acc(dir, ['sync', '--close-done']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /No GitHub tracker here says "edits": true, so acc closes no issues\./);
});

test('acc update ask drafts one of the analysis\'s questions for the client, and the Command Center\'s steps claim, record and release a post', () => {
  const { dir } = ticketsRepo();
  mkdirSync(join(dir, '.git', 'acc', 'analyses'), { recursive: true });
  writeFileSync(join(dir, '.git', 'acc', 'analyses', 'ACME-7.json'), JSON.stringify({ v: 1, task: 'ACME-7', questions: [{ id: 'q1', question: 'Should Gold customers count as Premium?', why: 'Changes the rule', suggested: 'No' }] }));
  const asked = acc(dir, ['update', 'ask', 'ACME-7', '1', '--json']);
  assert.equal(asked.code, 0, asked.err);
  assert.deepEqual([asked.json().id, asked.json().event, asked.json().question, asked.json().text], ['ACME-7.1', 'question', 'q1', 'Before we start, a question for you:\nShould Gold customers count as Premium?']);
  assert.equal(acc(dir, ['update', 'ask', 'ACME-7', 'q9']).code, 2);
  assert.match(acc(dir, ['update', 'ask', 'GH-3', 'q1']).err, /hasn't been analyzed/);

  // Jira: the Command Center claims it, posts as you, then records what went out, or puts it back.
  assert.equal(acc(dir, ['update', 'posting', 'ACME-7.1', '--json']).json().state, 'posting');
  assert.match(acc(dir, ['update', 'posting', 'ACME-7.1']).err, /is being posted/);
  const released = acc(dir, ['update', 'release', 'ACME-7.1', '--reason', 'Jira said 401', '--json']).json();
  assert.deepEqual([released.state, released.failed.reason], ['draft', 'Jira said 401']);
  acc(dir, ['update', 'posting', 'ACME-7.1']);
  const text = join(dir, 'text.md');
  writeFileSync(text, 'Is Gold the same as Premium for this?');
  const posted = acc(dir, ['update', 'posted', 'ACME-7.1', '--text-file', text, '--url', 'https://acme.atlassian.net/browse/ACME-7?focusedCommentId=1', '--json']).json();
  assert.deepEqual([posted.state, posted.posted.text, posted.posted.url], ['posted', 'Is Gold the same as Premium for this?', 'https://acme.atlassian.net/browse/ACME-7?focusedCommentId=1']);
});

test('forced moves need a person and a reason, and are marked as overrides', () => {
  const dir = repoWithConfig();
  acc(dir, ['add', 'Work']);
  assert.match(acc(dir, ['set', 'T-1', 'done']).err, /A human can't move a task from todo to done/);
  assert.match(acc(dir, ['set', 'T-1', 'done', '--force']).err, /needs --reason/);
  const r = acc(dir, ['set', 'T-1', 'done', '--force', '--reason', 'finished by hand', '--json']);
  assert.equal(r.code, 0);
  assert.equal(r.json().entry.override, true);
});

test('import adds and refreshes tasks from tracker JSON', () => {
  const dir = repoWithConfig();
  const items = [
    { source: { kind: 'github', key: '#3', url: 'https://github.com/o/r/issues/3' }, title: 'Login page', deps: ['#2'] },
    { source: { kind: 'github', key: '#2' }, title: 'Auth service' },
  ];
  const first = acc(dir, ['import', '--json'], JSON.stringify(items)).json();
  assert.deepEqual(first.added, ['GH-3', 'GH-2']);
  items[0]!.title = 'Login page v2';
  const file = join(dir, 'tasks.json');
  writeFileSync(file, JSON.stringify(items));
  const again = acc(dir, ['import', '--file', file, '--json']).json();
  assert.deepEqual(again.updated, ['GH-3']);
  assert.deepEqual(again.unchanged, ['GH-2']);
  assert.equal(acc(dir, ['import'], '{"not":"a list"}').code, 2);
});

test('commands that need a config say how to get one', () => {
  const r = acc(makeRepo(), ['list']);
  assert.equal(r.code, 1);
  assert.match(r.err, /Run "acc init" first/);
  assert.match(acc(makeRepo(), ['list', '--json']).out, /"error":\s*"no-config"/);
});

test('doctor --step runs only the named checks, and rejects unknown ids', () => {
  const dir = repoWithConfig();
  const r = acc(dir, ['doctor', '--step', 'B0.config', '--step', 'B0.repo', '--json']).json() as { id: string }[];
  assert.deepEqual(r.map((x) => x.id).sort(), ['B0.config', 'B0.repo']);
  assert.equal(acc(dir, ['doctor', '--step', 'Z9.nope']).code, 2);
});

test('intake github reads open issues as the repo\'s account and upserts them', () => {
  const dir = repoWithConfig({ ...GENERIC_CONFIG, github: { repo: 'o/r', account: 'me' } });
  const bin = join(dir, '.fakebin');
  mkdirSync(bin);
  const issues = JSON.stringify([{ number: 4, title: 'Fix login', body: 'Depends on #3', url: 'https://github.com/o/r/issues/4', labels: [] }]);
  writeFileSync(join(bin, 'gh'), `#!/bin/sh
case "$1 $2" in
  "auth token") [ "$4" = "me" ] && echo tok-me || exit 1 ;;
  "issue list") [ "$GH_TOKEN" = "tok-me" ] || { echo "wrong account" >&2; exit 1; }; echo '${issues}' ;;
  *) exit 1 ;;
esac
`);
  chmodSync(join(bin, 'gh'), 0o755);
  const r = acc(dir, ['intake', 'github', '--json'], undefined, { PATH: `${bin}:${process.env.PATH}` });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json().added, ['GH-4']);
  assert.equal(acc(dir, ['intake', 'jira']).code, 2, 'Jira intake needs the Command Center\'s report');
});

test('acc intake jira --file follows tickets that left the place: removes a task never started, names one that did, in the same shape as github (D-072)', () => {
  const dir = repoWithConfig({ ...GENERIC_CONFIG, trackers: [{ kind: 'jira', site: 'acme.atlassian.net', project: 'ACME', epic: 'ACME-3' }] });
  const items = ['ACME-7', 'ACME-8', 'ACME-9'].map((key) => ({ source: { kind: 'jira', key }, title: key }));
  assert.equal(acc(dir, ['import'], JSON.stringify(items)).code, 0);
  assert.equal(acc(dir, ['set', 'ACME-8', 'running']).code, 0);
  const file = join(dir, 'outside.json');
  writeFileSync(file, JSON.stringify({ outside: [{ key: 'ACME-7', why: 'it isn\'t in epic ACME-3' }, { key: 'ACME-8', why: 'it\'s in project OPS' }] }));
  const text = acc(dir, ['intake', 'jira', '--file', file]);
  assert.equal(text.code, 0, text.err);
  assert.deepEqual(text.out.trim().split('\n'), [
    'Removed ACME-7: their tickets left this repo\'s place before work started',
    '! ACME-8 left this repo\'s place: it\'s in project OPS; ACME-8 is still running',
  ]);
  const json = acc(dir, ['intake', 'jira', '--file', file, '--json']).json();
  assert.deepEqual(Object.keys(json).sort(), ['added', 'closed', 'errors', 'left', 'leftAlone', 'removed', 'unchanged', 'updated'], 'the shape acc intake github gives');
  assert.deepEqual([json.removed, json.leftAlone.map((l: { task: string }) => l.task)], [[], ['ACME-8']], 'removed once; the started one is named again');
  assert.deepEqual((acc(dir, ['list', '--json']).json() as { id: string }[]).map((t) => t.id), ['ACME-8', 'ACME-9']);

  writeFileSync(file, '{"outside": [{"key": 7}]}');
  assert.equal(acc(dir, ['intake', 'azure', '--file', file]).code, 2, 'a report in the wrong shape');
  assert.match(acc(dir, ['help']).out, /acc intake jira\|azure\|monday --file <report\.json>/);
});

test('acc intake monday --file follows items that left the board or its group: removes a task never started, names one that did (D-072)', () => {
  const dir = repoWithConfig({ ...GENERIC_CONFIG, trackers: [{ kind: 'monday', account: 'acme', board: 1234567890, group: 'topics' }] });
  const items = ['MON-101', 'MON-102', 'MON-1234567890123'].map((key) => ({ source: { kind: 'monday', key, url: `https://acme.monday.com/boards/1234567890/pulses/${key.slice(4)}` }, title: key }));
  const added = acc(dir, ['import', '--json'], JSON.stringify(items));
  assert.equal(added.code, 0, added.err);
  assert.deepEqual(added.json().added, ['MON-101', 'MON-102', 'MON-1234567890123'], 'an item id too big for 32 bits is a task id like any other');
  assert.equal(acc(dir, ['set', 'MON-102', 'running']).code, 0);
  const file = join(dir, 'outside.json');
  writeFileSync(file, JSON.stringify({ outside: [{ key: 'MON-101', why: 'it\'s in group Backlog' }, { key: 'MON-102', why: 'it\'s on board Other client' }] }));
  const text = acc(dir, ['intake', 'monday', '--file', file]);
  assert.equal(text.code, 0, text.err);
  assert.deepEqual(text.out.trim().split('\n'), [
    'Removed MON-101: their tickets left this repo\'s place before work started',
    '! MON-102 left this repo\'s place: it\'s on board Other client; MON-102 is still running',
  ]);
  assert.deepEqual((acc(dir, ['list', '--json']).json() as { id: string }[]).map((t) => t.id), ['MON-102', 'MON-1234567890123']);
  const events = readFileSync(join(dir, '.git', 'acc', 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { type: string; task?: string; id?: string });
  assert.deepEqual(events.filter((e) => e.type === 'task.removed').map((e) => e.task ?? e.id), ['MON-101'], 'the events log says it left');
});

test('acc import refuses a Jira or Azure DevOps ticket no tracker owns, so another project\'s never becomes a task here (D-072)', () => {
  const dir = repoWithConfig({ ...GENERIC_CONFIG, trackers: [{ kind: 'jira', site: 'acme.atlassian.net', project: 'ACME' }, { kind: 'azure', organization: 'acme', project: 'CRM', prefix: 'AV' }] });
  const items = [
    { source: { kind: 'jira', key: 'ACME-12' }, title: 'Ours' }, { source: { kind: 'jira', key: 'OPS-1' }, title: 'Another client\'s' },
    { source: { kind: 'azure', key: 'AV-3' }, title: 'Ours too' }, { source: { kind: 'jira', key: 'AV-4' }, title: 'An Azure key sent as Jira' },
    { source: { kind: 'github', key: '#5' }, title: 'A GitHub issue' }, { source: { kind: 'manual' }, title: 'Kept by acc' },
  ];
  const r = acc(dir, ['import', '--json'], JSON.stringify(items));
  assert.equal(r.code, 1);
  assert.deepEqual(r.json().added, ['ACME-12', 'AV-3', 'GH-5', 'T-1']);
  assert.deepEqual(r.json().errors, [
    'OPS-1: no Jira tracker in .acc/config.json owns it, so it isn\'t one of this repo\'s tickets.',
    'AV-4: no Jira tracker in .acc/config.json owns it, so it isn\'t one of this repo\'s tickets.',
  ]);
  // A repo that names no trackers has no place to hold to.
  assert.equal(acc(repoWithConfig(), ['import'], JSON.stringify([{ source: { kind: 'jira', key: 'OPS-1' }, title: 'x' }])).code, 0);
});

test('acc import refuses a monday.com item no monday.com tracker owns (D-072)', () => {
  const dir = repoWithConfig({ ...GENERIC_CONFIG, trackers: [{ kind: 'jira', site: 'acme.atlassian.net', project: 'ACME' }, { kind: 'monday', account: 'acme', board: 111, prefix: 'CW' }] });
  const items = [
    { source: { kind: 'monday', key: 'CW-101' }, title: 'Ours' }, { source: { kind: 'monday', key: 'MON-5' }, title: 'Another board\'s, keyed MON' },
    { source: { kind: 'monday', key: 'ACME-3' }, title: 'A Jira key sent as monday.com' }, { source: { kind: 'jira', key: 'CW-7' }, title: 'A monday.com key sent as Jira' },
  ];
  const r = acc(dir, ['import', '--json'], JSON.stringify(items));
  assert.equal(r.code, 1);
  assert.deepEqual(r.json().added, ['CW-101']);
  assert.deepEqual(r.json().errors, [
    'MON-5: no monday.com tracker in .acc/config.json owns it, so it isn\'t one of this repo\'s tickets.',
    'ACME-3: no monday.com tracker in .acc/config.json owns it, so it isn\'t one of this repo\'s tickets.',
    'CW-7: no Jira tracker in .acc/config.json owns it, so it isn\'t one of this repo\'s tickets.',
  ]);
  const jiraOnly = repoWithConfig({ ...GENERIC_CONFIG, trackers: [{ kind: 'jira', site: 'acme.atlassian.net', project: 'ACME' }] });
  assert.match(acc(jiraOnly, ['import', '--json'], JSON.stringify([{ source: { kind: 'monday', key: 'MON-1' }, title: 'x' }])).json().errors[0], /^MON-1: no monday\.com tracker/);
});

test('intake github moves closed issues\' tasks to done, removes skipped ones, and names those that started', () => {
  const dir = repoWithConfig({ ...GENERIC_CONFIG, github: { repo: 'o/r', account: 'me' }, trackers: [{ kind: 'github', skipLabels: ['milestone'] }] });
  const items = [3, 5, 6].map((n) => ({ source: { kind: 'github', key: `#${n}` }, title: `Issue ${n}` }));
  assert.equal(acc(dir, ['import'], JSON.stringify(items)).code, 0);
  assert.equal(acc(dir, ['set', 'GH-6', 'running']).code, 0);
  const bin = join(dir, '.fakebin');
  mkdirSync(bin);
  const issues = JSON.stringify([{ number: 3, title: 'M3', body: '', url: 'u3', labels: [{ name: 'milestone' }] }, { number: 4, title: 'Issue 4', body: '', url: 'u4', labels: [] }]);
  writeFileSync(join(bin, 'gh'), `#!/bin/sh
case "$1 $2" in
  "auth token") echo tok ;;
  "issue list") echo '${issues}' ;;
  "issue view") echo "{\\"number\\": $3, \\"state\\": \\"CLOSED\\", \\"labels\\": []}" ;;
  *) exit 1 ;;
esac
`);
  chmodSync(join(bin, 'gh'), 0o755);
  const env = { PATH: `${bin}:${process.env.PATH}` };
  const text = acc(dir, ['intake', 'github'], undefined, env);
  assert.equal(text.code, 0, text.err);
  assert.deepEqual(text.out.trim().split('\n'), [
    'Added GH-4',
    'Done GH-5: closed on GitHub before work started',
    'Removed GH-3: their issues have a label in skipLabels',
    '! #6 was closed on GitHub; GH-6 is still running',
  ]);
  const json = acc(dir, ['intake', 'github', '--json'], undefined, env).json();
  assert.deepEqual([json.closed, json.removed, json.unchanged], [[], [], ['GH-4']]);
  assert.deepEqual(json.leftAlone, [{ task: 'GH-6', issue: '#6', state: 'running', note: '#6 was closed on GitHub; GH-6 is still running' }]);
  assert.deepEqual((acc(dir, ['list', '--json']).json() as { id: string; state: string }[]).map((t) => `${t.id} ${t.state}`), ['GH-5 done', 'GH-6 running', 'GH-4 todo']);
});

test('gate run records receipts on the commit, exits 1 while a required check fails, and gate list shows them', () => {
  const heavy = { ACC_HEAVY_DIR: join(makeRepo(), 'slots') };
  const cfg = { ...GENERIC_CONFIG, gates: { required: ['lint', 'test'], commands: { lint: 'true', test: 'echo "1 failing"; exit 3' } } };
  const dir = repoWithConfig(cfg);
  const failing = acc(dir, ['gate', 'run'], undefined, heavy);
  assert.equal(failing.code, 1, failing.err);
  assert.match(failing.out, /✓ pass\s+lint/);
  assert.match(failing.out, /✗ fail\s+test\s+1 failing/);
  assert.match(failing.out, /1 to fix: test\./);
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout.trim();
  assert.equal(JSON.parse(readFileSync(join(dir, '.git', 'acc', 'receipts', sha, 'test.json'), 'utf8')).status, 'fail');

  writeFileSync(join(dir, '.acc', 'config.json'), JSON.stringify({ ...cfg, gates: { ...cfg.gates, commands: { lint: 'true', test: 'true' } } }));
  assert.match(acc(dir, ['gate', 'run'], undefined, heavy).out, /Not recorded: there are uncommitted changes/);
  spawnSync('git', ['commit', '-qam', 'fix the test'], { cwd: dir });
  const passing = acc(dir, ['gate', 'run'], undefined, heavy);
  assert.equal(passing.code, 0, passing.err);
  assert.match(passing.out, /All recorded\. acc done will accept this commit\./);
  const list = acc(dir, ['gate', 'list', '--json']).json() as { gates: { name: string; required: boolean; heavy: boolean; receipt: { status: string } | null }[] };
  assert.deepEqual(list.gates.map((g) => [g.name, g.required, g.heavy, g.receipt?.status]), [['lint', true, false, 'pass'], ['test', true, true, 'pass']]);
  assert.equal(acc(dir, ['gate', 'run', 'nope']).code, 2, 'an unknown gate is a usage error');
  assert.equal(acc(dir, ['gate', 'run', 'lint', '--test', 'not a class']).code, 2);
  assert.match(acc(dir, ['drift', 'main']).err, /no orgs/);
});

test('acc gate waive: a person waives a task\'s failing check with a reason; a builder never can (D-031)', () => {
  const dir = repoWithConfig({ ...GENERIC_CONFIG, gates: { required: ['test'], commands: { test: 'exit 3' } } });
  assert.equal(acc(dir, ['add', 'Try the process', '--json']).code, 0);
  const branch = spawnSync('git', ['branch', '--show-current'], { cwd: dir, encoding: 'utf8' }).stdout.trim();
  const ledgerPath = join(dir, '.git', 'acc', 'ledger.json');
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  ledger.tasks[0].run = { branch };
  writeFileSync(ledgerPath, JSON.stringify(ledger));
  const id = ledger.tasks[0].id as string;
  // Its own slots, so it never waits on a real check, such as the one running these tests.
  const heavy = { ACC_HEAVY_DIR: join(makeRepo(), 'slots') };
  assert.equal(acc(dir, ['gate', 'run'], undefined, heavy).code, 1);
  const builder = acc(dir, ['gate', 'waive', 'test', '--task', id, '--reason', 'mine', '--as', 'human'], undefined, { ACC_ROLE: 'builder', ACC_TASK: id });
  assert.equal(builder.code, 1);
  assert.match(builder.err, /A builder can't waive its own checks/);
  assert.match(acc(dir, ['gate', 'waive', 'test', '--task', id]).err, /Say why/);
  const r = acc(dir, ['gate', 'waive', 'test', '--task', id, '--reason', 'a test task, never promoted', '--json']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json().waived[0].waived.was, 'fail');
  const list = acc(dir, ['gate', 'list', '--json']).json();
  assert.equal(list.gates[0].receipt.status, 'skip');
});

test('acc autopilot: manual does nothing; dispatch isn\'t built yet, and full is read as it; usage, roles and the lock (D-055)', () => {
  const GH = { ...GENERIC_CONFIG, github: { repo: 'acme/tool', account: 'jordan-kim' } };
  const dir = repoWithConfig(GH);
  const setAutonomy = (autonomy: string, config: object = GH) => writeFileSync(join(dir, '.acc', 'config.json'), JSON.stringify({ ...config, autonomy }));
  assert.equal(acc(dir, ['add', 'Ready to start']).code, 0);
  const ledgerFile = join(dir, '.git', 'acc', 'ledger.json');
  const ledger = readFileSync(ledgerFile, 'utf8');

  const manual = acc(dir, ['autopilot', '--json']);
  assert.equal(manual.code, 0, manual.err);
  assert.deepEqual(manual.json(), { autonomy: 'manual', warnings: [], steps: [], updates: [] });
  assert.match(acc(dir, ['autopilot']).out, /autonomy is "manual" in \.acc\/config\.json, so autopilot does nothing\. Set it to "review" for autopilot to act: it then reviews finished work, .*merges the base into a pull request that conflicts with it\./);
  assert.equal(readFileSync(ledgerFile, 'utf8'), ledger, 'the ledger is untouched');
  assert.ok(!existsSync(join(dir, '.git', 'acc', 'autopilot.lock')));

  setAutonomy('dispatch');
  const dispatch = acc(dir, ['autopilot']);
  assert.equal(dispatch.code, 1);
  assert.match(dispatch.err, /not built yet/);
  setAutonomy('full');
  const full = acc(dir, ['autopilot']);
  assert.equal(full.code, 1);
  assert.match(full.err, /warning: autonomy "full" is read as "dispatch"\.[\s\S]*not built yet/);
  assert.equal(readFileSync(ledgerFile, 'utf8'), ledger, 'refused before doing anything');

  setAutonomy('review');
  assert.equal(acc(dir, ['autopilot', '--once', '--every', '60']).code, 2, 'one pass, or repeated: not both');
  assert.equal(acc(dir, ['autopilot', '--every', '5']).code, 2, 'at least 30 seconds between passes');
  for (const role of ['builder', 'reviewer', 'analyst']) {
    const r = acc(dir, ['autopilot'], undefined, { ACC_ROLE: role, ACC_TASK: 'T-1' });
    assert.equal(r.code, 1, role);
    assert.match(r.err, new RegExp(`A ${role} can't run autopilot`));
  }
  const once = acc(dir, ['autopilot', '--once', '--json']);
  assert.equal(once.code, 0, once.err);
  assert.deepEqual(once.json().steps.map((s: { task: string; step: string | null; outcome: string }) => [s.task, s.step, s.outcome]), [['T-1', null, 'skipped']], 'a task to do is never started');
  assert.equal(acc(dir, ['autopilot']).out.trim(), 'Nothing for autopilot to do.');

  // Another autopilot holds the lock: this test's own process stands in for it.
  const lock = join(dir, '.git', 'acc', 'autopilot.lock');
  mkdirSync(lock);
  writeFileSync(join(lock, 'owner'), JSON.stringify({ pid: process.pid, at: Date.now() }));
  const second = acc(dir, ['autopilot']);
  assert.equal(second.code, 1);
  assert.match(second.err, new RegExp(`Autopilot is already running here \\(pid ${process.pid}\\)`));

  setAutonomy('review', GENERIC_CONFIG);
  assert.match(acc(dir, ['autopilot']).err, /no "github" section/, 'it couldn\'t land anything');
});

test('acc autopilot runs on a repo where no task was ever added, which has no state folder yet', () => {
  const dir = repoWithConfig({ ...GENERIC_CONFIG, github: { repo: 'acme/tool', account: 'jordan-kim' }, autonomy: 'review' });
  assert.ok(!existsSync(join(dir, '.git', 'acc')));
  const once = acc(dir, ['autopilot', '--once', '--json']);
  assert.equal(once.code, 0, once.err);
  assert.deepEqual(once.json().steps, []);
  assert.equal(acc(dir, ['autopilot']).out.trim(), 'Nothing for autopilot to do.');
  assert.ok(!existsSync(join(dir, '.git', 'acc', 'autopilot.lock')), 'let go when it ends');
});

test('a task in review whose pull request was closed shows as needs you, and acc show names the pull request (D-063)', () => {
  const dir = repoWithConfig();
  assert.equal(acc(dir, ['add', 'Add a sum function']).code, 0);
  assert.equal(acc(dir, ['set', 'T-1', 'running']).code, 0);
  assert.equal(acc(dir, ['set', 'T-1', 'review', '--as', 'builder']).code, 0);
  const file = join(dir, '.git', 'acc', 'ledger.json');
  const l = JSON.parse(readFileSync(file, 'utf8'));
  l.tasks[0].pr = { number: 41, url: 'https://github.com/acme/tool/pull/41', state: 'closed' };
  writeFileSync(file, JSON.stringify(l));
  assert.match(acc(dir, ['show', 'T-1']).out, /T-1 {2}! Needs you {2}Add a sum function\n[\s\S]*! Pull request #41 was closed without merging\. Reopen it on GitHub and land to update it, or land to open a new one\./);
  assert.equal(acc(dir, ['list', '--json']).json()[0].display, 'needs-you');
  assert.match(acc(dir, ['status']).out, /1 needs you/);

  // Blocked, as acc sync leaves it, it's blocked with its reason, and acc show doesn't say it again.
  l.tasks[0].state = 'blocked';
  l.tasks[0].blocker = 'Pull request #41 was closed without merging. Reopen it, or decide what happens.';
  writeFileSync(file, JSON.stringify(l));
  const blocked = acc(dir, ['show', 'T-1']).out;
  assert.match(blocked, /T-1 {2}⊘ Blocked/);
  assert.equal(blocked.match(/#41/g)?.length, 1);
});

test('a task autopilot couldn\'t move on shows as needs you, and acc show says why (D-055)', () => {
  const dir = repoWithConfig();
  assert.equal(acc(dir, ['add', 'Add a sum function']).code, 0);
  assert.equal(acc(dir, ['set', 'T-1', 'running']).code, 0);
  assert.equal(acc(dir, ['set', 'T-1', 'review', '--as', 'builder']).code, 0);
  const file = join(dir, '.git', 'acc', 'ledger.json');
  const l = JSON.parse(readFileSync(file, 'utf8'));
  l.tasks[0].autopilot = { failed: { step: 'land', sha: 'abcdef0123456789abcdef0123456789abcdef01', state: 'review', reason: 'git push refused task/T-1-add-a-sum-function: rejected', at: '2026-10-05T12:00:00.000Z' } };
  writeFileSync(file, JSON.stringify(l));
  assert.match(acc(dir, ['show', 'T-1']).out, /T-1 {2}! Needs you {2}Add a sum function\n[\s\S]*! Autopilot couldn't land abcdef0: git push refused task\/T-1-add-a-sum-function: rejected/);
  assert.equal(acc(dir, ['list', '--json']).json()[0].display, 'needs-you');
  assert.match(acc(dir, ['status']).out, /1 needs you/);

  // A pull request it couldn't update from its base (D-058), in words.
  l.tasks[0].autopilot.failed = { ...l.tasks[0].autopilot.failed, step: 'refresh', reason: 'Conflicts with main that autopilot can\'t resolve: sum.js. The branch is as it was, at abcdef0, and nothing was pushed.' };
  writeFileSync(file, JSON.stringify(l));
  assert.match(acc(dir, ['show', 'T-1']).out, /! Autopilot couldn't update abcdef0 from its base: Conflicts with main that autopilot can't resolve: sum\.js\./);
});

test('acc show says a running task\'s builder stopped, with what it last said, and acc resume carries it on (D-067)', () => {
  const dir = realpathSync(repoWithConfig());
  assert.equal(acc(dir, ['add', 'Ticket updates are drafts']).code, 0);
  // T-1 as GH-41 was after the Mac slept: running for long enough, its session gone, its transcript ending in the API error.
  const file = join(dir, '.git', 'acc', 'ledger.json');
  const l = JSON.parse(readFileSync(file, 'utf8'));
  l.tasks[0].state = 'running';
  l.tasks[0].run = { bgId: 'bg9', sessionId: 'sess-9', worktree: dir, branch: 'main', startedAt: '2026-10-05T21:52:13.000Z' };
  writeFileSync(file, JSON.stringify(l));
  const config = tempDir('claude-config-');
  mkdirSync(transcriptDir(join(config, 'projects'), dir), { recursive: true });
  writeFileSync(join(transcriptDir(join(config, 'projects'), dir), 'sess-9.jsonl'), gh41Lines('sess-9', dir).join('\n') + '\n');
  // Stand-ins for claude (no sessions listed; a resume writes down how it was run) and caffeinate.
  const bin = tempDir('bin-');
  const record = join(bin, 'records.jsonl');
  writeFileSync(join(bin, 'claude'), `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
if (args[0] === 'agents') console.log('[]');
else fs.appendFileSync(${JSON.stringify(record)}, JSON.stringify({ cmd: 'claude', args, cwd: process.cwd(), role: process.env.ACC_ROLE, task: process.env.ACC_TASK }) + '\\n');
`);
  writeFileSync(join(bin, 'caffeinate'), `#!/bin/sh\nprintf '{"cmd":"caffeinate","args":["%s","%s","%s"]}\\n' "$1" "$2" "$3" >> ${JSON.stringify(record)}\n`);
  chmodSync(join(bin, 'claude'), 0o755);
  chmodSync(join(bin, 'caffeinate'), 0o755);
  const env = { PATH: `${bin}:${process.env.PATH}`, CLAUDE_CONFIG_DIR: config };

  const show = acc(dir, ['show', 'T-1'], undefined, env).out;
  assert.match(show, /^T-1 {2}! Needs you {2}Ticket updates are drafts\n/);
  assert.match(show, /! Its agent stopped: API Error: Your computer went to sleep mid-response\. The response above may be incomplete\. Resume it with acc resume T-1\./);
  assert.deepEqual(acc(dir, ['show', 'T-1', '--json'], undefined, env).json().stopped, { said: 'API Error: Your computer went to sleep mid-response. The response above may be incomplete.' });

  for (const role of ['builder', 'reviewer', 'analyst']) {
    const refused = acc(dir, ['resume', 'T-1'], undefined, { ...env, ACC_ROLE: role, ACC_TASK: 'T-1' });
    assert.equal(refused.code, 1, role);
    assert.match(refused.err, /can't resume a builder\. A person does that, or autopilot\./);
  }

  const r = acc(dir, ['resume', 'T-1', '--json'], undefined, env);
  assert.equal(r.code, 0, r.err);
  const out = r.json();
  assert.deepEqual([out.folder, out.sessionId, out.said], [dir, 'sess-9', 'API Error: Your computer went to sleep mid-response. The response above may be incomplete.']);
  // The resumed claude runs detached: wait for it to write down how it was run.
  const until = Date.now() + 10_000;
  const records = () => (existsSync(record) ? readFileSync(record, 'utf8').trim().split('\n').map((x) => JSON.parse(x)) : []);
  while (!records().some((x) => x.cmd === 'claude') && Date.now() < until) spawnSync('sleep', ['0.1']);
  const claude = records().find((x) => x.cmd === 'claude')!;
  assert.deepEqual(claude.args.slice(2, 6), ['--resume', 'sess-9', '--permission-mode', 'acceptEdits']);
  assert.match(claude.args[1], /^You are the builder for T-1: Ticket updates are drafts\./);
  assert.deepEqual([claude.cwd, claude.role, claude.task], [dir, 'builder', 'T-1']);
  if (process.platform === 'darwin') {
    while (!records().some((x) => x.cmd === 'caffeinate') && Date.now() < until) spawnSync('sleep', ['0.1']);
    assert.deepEqual(records().find((x) => x.cmd === 'caffeinate')!.args, ['-i', '-w', String(out.pid)]);
  }
  const t = JSON.parse(readFileSync(file, 'utf8')).tasks[0];
  assert.equal(t.run.resumes.length, 1);
  assert.equal(t.run.resumes[0].actor, 'human');

  // Only a running task's builder is resumed.
  assert.equal(acc(dir, ['block', 'T-1', 'needs a date']).code, 0);
  const blocked = acc(dir, ['resume', 'T-1'], undefined, env);
  assert.equal(blocked.code, 1);
  assert.match(blocked.err, /T-1 is blocked\. Only a running task's builder is resumed\./);
});

test('acc agents autonomy: shows it, and a person sets manual or review in .acc/config.json, changing nothing else (D-064)', () => {
  // Spaced and ordered as a person might keep it: the edit moves nothing else.
  const text = '{\n    "schema": 1,\n    "autonomy":   "manual",\n    "project": "Tool",\n    "profile": "generic",\n    "environments": [ { "name": "main", "default": true } ],\n    "agents": { "max": 2 }\n}\n';
  const dir = makeRepo({ '.acc/config.json': text });
  const file = join(dir, '.acc', 'config.json');
  assert.deepEqual(acc(dir, ['agents', 'autonomy', '--json']).json(), { autonomy: 'manual' });
  assert.match(acc(dir, ['agents', 'autonomy']).out, /^autonomy manual \(project\): nothing happens on its own\./);

  const set = acc(dir, ['agents', 'autonomy', 'review', '--json']);
  assert.equal(set.code, 0, set.err);
  assert.deepEqual(set.json(), { autonomy: 'review' });
  assert.equal(readFileSync(file, 'utf8'), text.replace('"manual"', '"review"'), 'only the value changed');
  assert.match(acc(dir, ['agents', 'autonomy']).out, /^autonomy review \(project\): autopilot reviews finished work, .*, and merges the base into a pull request that conflicts with it\. It never merges a pull request\./);
  assert.match(acc(dir, ['agents', 'autonomy', 'manual']).out, /autonomy manual: nothing happens on its own\. Set in \.acc\/config\.json: commit it to share it\./);
  assert.equal(readFileSync(file, 'utf8'), text);

  for (const level of ['dispatch', 'full']) {
    const r = acc(dir, ['agents', 'autonomy', level]);
    assert.equal(r.code, 1, level);
    assert.match(r.err, new RegExp(`autonomy "${level}" isn't built yet[^]*Choose manual or review`));
  }
  assert.equal(acc(dir, ['agents', 'autonomy', 'bogus']).code, 2);
  for (const role of ['builder', 'reviewer', 'analyst']) {
    const r = acc(dir, ['agents', 'autonomy', 'review'], undefined, { ACC_ROLE: role, ACC_TASK: 'T-1' });
    assert.equal(r.code, 1, role);
    assert.match(r.err, new RegExp(`${role} can't change what autopilot may do`));
  }
  assert.equal(readFileSync(file, 'utf8'), text, 'nothing refused touched the file');

  // A config without the key gets it, and keeps the rest.
  const bare = repoWithConfig();
  assert.equal(acc(bare, ['agents', 'autonomy', 'review']).code, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(bare, '.acc', 'config.json'), 'utf8')), { ...GENERIC_CONFIG, autonomy: 'review' });
});

test('acc agents auto-merge: shows it, and a person turns it on or off in .acc/config.json, changing nothing else (GH-67)', () => {
  // Spaced and ordered as a person might keep it: the edit moves nothing else.
  const text = '{\n    "schema": 1,\n    "project": "Tool",\n    "profile": "generic",\n    "autonomy": "review",\n    "environments": [ { "name": "main", "default": true }, { "name": "release", "protected": true } ],\n    "autopilot": {\n        "appendOnly": [ "docs/DECISIONS.md" ]\n    }\n}\n';
  const dir = makeRepo({ '.acc/config.json': text });
  const file = join(dir, '.acc', 'config.json');
  assert.deepEqual(acc(dir, ['agents', 'auto-merge', '--json']).json(), { autoMerge: false, environments: [], autonomy: 'review' });
  assert.match(acc(dir, ['agents', 'auto-merge']).out, /^auto-merge off \(project\): autopilot never merges a pull request\. A person merges each one\./);
  assert.match(acc(dir, ['agents', 'autonomy']).out, /It never merges a pull request\.$/m);

  const on = acc(dir, ['agents', 'auto-merge', 'on', '--json']);
  assert.equal(on.code, 0, on.err);
  assert.deepEqual(on.json(), { autoMerge: true, environments: ['main'], autonomy: 'review' }, 'release is protected');
  assert.equal(readFileSync(file, 'utf8'), text.replace('"autopilot": {\n        "appendOnly"', '"autopilot": {\n        "autoMerge": true,\n        "appendOnly"'), 'only the key was added');
  const said = acc(dir, ['agents', 'auto-merge']).out;
  assert.match(said, /^auto-merge on \(project\): autopilot merges a pull request into main once its review and checks passed, .*nothing waits on a person, and it changes nothing under \.acc\/\. One a pass\. Never into release: protected, so a person merges\. It merges while autopilot is on\./);
  // Every word on what autopilot does says it merges now.
  assert.match(acc(dir, ['agents', 'autonomy']).out, /Auto-merge is on: it also merges a pull request whose review and checks passed, .*It never merges into a protected environment\.$/m);
  assert.doesNotMatch(acc(dir, ['agents', 'autonomy']).out, /It never merges a pull request/);

  assert.match(acc(dir, ['agents', 'auto-merge', 'off']).out, /^auto-merge off \(project\): .* Set in \.acc\/config\.json: commit it to share it\./);
  assert.equal(readFileSync(file, 'utf8'), text.replace('"autopilot": {\n        "appendOnly"', '"autopilot": {\n        "autoMerge": false,\n        "appendOnly"'), 'the value changed in place');
  assert.equal(acc(dir, ['agents', 'auto-merge', 'on']).code, 0);
  assert.equal(acc(dir, ['agents', 'auto-merge', 'maybe']).code, 2);
  const before = readFileSync(file, 'utf8');
  for (const role of ['builder', 'reviewer', 'analyst']) {
    const r = acc(dir, ['agents', 'auto-merge', 'off'], undefined, { ACC_ROLE: role, ACC_TASK: 'T-1' });
    assert.equal(r.code, 1, role);
    assert.match(r.err, new RegExp(`${role} can't change whether autopilot merges`));
  }
  assert.equal(readFileSync(file, 'utf8'), before, 'nothing refused touched the file');

  // A config with no autopilot block gets one at its end, and keeps the rest.
  const bare = repoWithConfig();
  assert.equal(acc(bare, ['agents', 'auto-merge', 'off']).code, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(bare, '.acc', 'config.json'), 'utf8')), GENERIC_CONFIG, 'off with nothing written: nothing to change');
  assert.equal(acc(bare, ['agents', 'auto-merge', 'on']).code, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(bare, '.acc', 'config.json'), 'utf8')), { ...GENERIC_CONFIG, autopilot: { autoMerge: true } });
  assert.match(acc(bare, ['agents', 'auto-merge']).out, /autonomy is "manual", so autopilot doesn't run and nothing merges on its own\./);

  // A Salesforce project never auto-merges.
  const sf = makeRepo({ '.acc/config.json': JSON.stringify({ ...GENERIC_CONFIG, profile: 'salesforce', environments: [{ name: 'Dev', type: 'developer', org: 'Acme Dev', default: true }] }) });
  const refused = acc(sf, ['agents', 'auto-merge', 'on']);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /A Salesforce project never auto-merges: a person merges every pull request there\./);
  assert.match(acc(sf, ['agents', 'auto-merge']).out, /^auto-merge off \(project\): a Salesforce project never auto-merges\./);
});

test('acc autopilot --every stops by itself once the Command Center that started it has gone (D-064)', () => {
  const dir = repoWithConfig({ ...GENERIC_CONFIG, autonomy: 'review', github: { repo: 'acme/tool', account: 'jordan-kim' } });
  assert.equal(acc(dir, ['add', 'Ready to start']).code, 0);
  // A stand-in for the extension host: a process that lives for a second. It's the shell's child, so
  // once it ends nothing here leaves it unreaped while this test waits.
  const host = spawnSync('sh', ['-c', 'sleep 1 >/dev/null 2>&1 & echo $!'], { encoding: 'utf8' });
  const pid = host.stdout.trim();
  assert.match(pid, /^\d+$/);
  const started = Date.now();
  const r = spawnSync(process.execPath, ['--no-warnings', MAIN, 'autopilot', '--every', '30'], {
    cwd: dir, encoding: 'utf8', timeout: 20_000,
    env: { ...process.env, NO_COLOR: '1', ACC_ROLE: '', ACC_TASK: '', ACC_HEAVY_DIR: HEAVY_DIR, ACC_AUTOPILOT_PARENT: pid },
  });
  const took = Date.now() - started;
  assert.equal(r.status, 0, r.stderr);
  assert.ok(took < 6_000, `stopped ${took} ms after it started, not at the end of its 30-second wait`);
  assert.match(r.stdout, /Nothing for autopilot to do\./, 'it did its pass first');
  assert.match(r.stderr, /The Command Center that started autopilot closed, so it stops\./);
  assert.ok(!existsSync(join(dir, '.git', 'acc', 'autopilot.lock')), 'and let go of its lock');
});

test('acc machine heavy-slots shows and sets how many heavy checks this machine runs; a builder can\'t change it (D-080)', () => {
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG) });
  const file = join(tempDir('acc-machine-'), 'machine.json');
  const env = { ACC_MACHINE_FILE: file, ACC_HEAVY_SLOTS: '' };
  assert.match(acc(dir, ['machine', 'heavy-slots'], undefined, env).out, /^1 heavy check at once on this machine\./);
  const set = acc(dir, ['machine', 'heavy-slots', '2', '--json'], undefined, env);
  assert.equal(set.code, 0, set.err);
  assert.deepEqual(set.json(), { heavySlots: 2 });
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { heavySlots: 2 });
  assert.match(acc(dir, ['machine', 'heavy-slots'], undefined, env).out, /^2 heavy checks at once/);
  assert.equal(acc(dir, ['machine', 'heavy-slots', '12'], undefined, env).code, 2, 'out of range');
  assert.notEqual(acc(dir, ['machine', 'heavy-slots', '4'], undefined, { ...env, ACC_ROLE: 'builder', ACC_TASK: 'T-1' }).code, 0, 'a builder can\'t');
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { heavySlots: 2 }, 'unchanged');
});

test('acc agents set --project is a switch, as the Command Center sends it last, and writes .acc/config.json (D-036)', () => {
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG) });
  const r = acc(dir, ['agents', 'set', 'builder', '--model', 'claude-opus-5-5', '--project']);
  assert.equal(r.code, 0, r.err);
  assert.equal(JSON.parse(readFileSync(join(dir, '.acc', 'config.json'), 'utf8')).agents.builder.model, 'claude-opus-5-5');
  assert.match(r.out, /Set in \.acc\/config\.json/);
});
