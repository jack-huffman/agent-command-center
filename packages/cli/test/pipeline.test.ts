// acc sync --close-done, acc autopilot, and what a task in review shows: the pipeline (pipeline.ts).
// acc runs from its source, in throwaway repos (support.ts).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { mutate, parseConfig, readLedger, repoPaths, run, upsertTasks } from '../../core/src/index.ts';
import { GENERIC_CONFIG } from '../../core/test/support.ts';
import { cli, repoWithConfig, UNCHECKED } from './support.ts';

const acc = cli(fileURLToPath(new URL('../src/main.ts', import.meta.url)));

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
  assert.deepEqual(again.json(), { checked: 0, changes: [], cloud: [], branches: [], closeDone: [] }, 'a second run does nothing');
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
  assert.match(acc(dir, ['autopilot']).out, /autonomy is "manual" in \.acc\/config\.json, so autopilot does nothing\. Set it to "review" for autopilot to act: it then reviews finished work, .*starts a task a person dispatched once the files it waits for are free\./);
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
  const dir = repoWithConfig(UNCHECKED);
  assert.equal(acc(dir, ['add', 'Add a sum function']).code, 0);
  assert.equal(acc(dir, ['set', 'T-1', 'running']).code, 0);
  assert.equal(acc(dir, ['set', 'T-1', 'review']).code, 0);
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
  const dir = repoWithConfig(UNCHECKED);
  assert.equal(acc(dir, ['add', 'Add a sum function']).code, 0);
  assert.equal(acc(dir, ['set', 'T-1', 'running']).code, 0);
  assert.equal(acc(dir, ['set', 'T-1', 'review']).code, 0);
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

test('acc autopilot --every stops by itself once the Command Center that started it has gone (D-064)', () => {
  const dir = repoWithConfig({ ...GENERIC_CONFIG, autonomy: 'review', github: { repo: 'acme/tool', account: 'jordan-kim' } });
  assert.equal(acc(dir, ['add', 'Ready to start']).code, 0);
  // A stand-in for the extension host: a process that lives for three seconds, so autopilot's first pass
  // finishes before it goes, even on a loaded machine. It's the shell's child, so
  // once it ends nothing here leaves it unreaped while this test waits.
  const host = spawnSync('sh', ['-c', 'sleep 3 >/dev/null 2>&1 & echo $!'], { encoding: 'utf8' });
  const pid = host.stdout.trim();
  assert.match(pid, /^\d+$/);
  const started = Date.now();
  const r = acc(dir, ['autopilot', '--every', '30'], undefined, { ACC_AUTOPILOT_PARENT: pid }, { timeout: 20_000 });
  const took = Date.now() - started;
  assert.equal(r.code, 0, r.err);
  assert.ok(took < 10_000, `stopped ${took} ms after it started, not at the end of its 30-second wait`);
  assert.match(r.out, /Nothing for autopilot to do\./, 'it did its pass first');
  assert.match(r.err, /The Command Center that started autopilot closed, so it stops\./);
  assert.ok(!existsSync(join(dir, '.git', 'acc', 'autopilot.lock')), 'and let go of its lock');
});
