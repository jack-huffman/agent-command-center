// acc gate: running, waiving and relaxing a task's checks, and setting a project's (checks.ts).
// acc runs from its source, in throwaway repos (support.ts).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { GENERIC_CONFIG, makeRepo, tempDir } from '../../core/test/support.ts';
import { cli, LIMITS_CONFIG, repoWithConfig } from './support.ts';

const acc = cli(fileURLToPath(new URL('../src/main.ts', import.meta.url)));

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
  // stray-files is built in and required (GH-103), and skips: the commit is main's own, so it adds nothing.
  assert.deepEqual(list.gates.map((g) => [g.name, g.required, g.heavy, g.receipt?.status]), [['stray-files', true, false, 'skip'], ['lint', true, false, 'pass'], ['test', true, true, 'pass']]);
  assert.equal(acc(dir, ['gate', 'run', 'nope']).code, 2, 'an unknown gate is a usage error');
  assert.equal(acc(dir, ['gate', 'run', 'lint', '--test', 'not a class']).code, 2);
  assert.match(acc(dir, ['drift', 'main']).err, /no orgs/);
});

test('gate run prints what each test check ran and how a hold is cleared; gate list shows the counts (GH-100)', () => {
  const heavy = { ACC_HEAVY_DIR: join(makeRepo(), 'slots') };
  const block = (pass: number, skipped: number) => `ℹ tests ${pass + skipped}\\nℹ pass ${pass}\\nℹ fail 0\\nℹ cancelled 0\\nℹ skipped ${skipped}\\nℹ todo 0\\n`;
  const cfg = { ...GENERIC_CONFIG, gates: { required: ['test', 'none', 'lint'], tests: ['none'], commands: { test: `printf '${block(312, 2)}'`, none: `printf '${block(0, 0)}'`, lint: 'true' } } };
  const dir = repoWithConfig(cfg);
  const r = acc(dir, ['gate', 'run'], undefined, heavy);
  assert.equal(r.code, 1, r.err);
  assert.match(r.out, /✓ pass\s+test\s+Passed\. · tests: 312 run, 2 skipped\n\s+Nothing earlier on main to compare its skipped tests with\./);
  assert.match(r.out, /\? needs a person\s*none\s+Ran no tests, so it can't vouch for the change\. · tests: 0 run, 0 skipped/);
  assert.match(r.out, /✓ pass\s+lint\s+Passed\.\n/);
  assert.match(r.out, /1 needs a person: none\. Add the tests, or un-skip them\. If the task asks for the skip, say so with acc block "<why>": only a person can waive it\./);
  assert.ok(!/to fix/.test(r.out), 'a hold isn\'t a failure to fix');
  const list = acc(dir, ['gate', 'list']);
  assert.match(list.out, /^Gate\s+Required\s+Heavy\s+This commit\s+Tests\s+Checks$/m);
  assert.match(list.out, /^test\s+yes\s+yes\s+✓ pass\s+312 run, 2 skipped\s+printf/m);
});

test('acc gate run on a branch that commits a log exits 1, naming the file and the fix (GH-103)', () => {
  const dir = repoWithConfig();
  spawnSync('git', ['checkout', '-q', '-b', 'task/T-1-thing'], { cwd: dir });
  writeFileSync(join(dir, 'debug.log'), 'scratch\n');
  spawnSync('git', ['add', '-A'], { cwd: dir });
  spawnSync('git', ['commit', '-qm', 'add a log'], { cwd: dir });
  const r = acc(dir, ['gate', 'run', '--env', 'main']);
  assert.equal(r.code, 1, r.err);
  assert.match(r.out, /✗ fail\s+stray-files\s+This change adds a file that shouldn't be committed: debug\.log \(a log, temp file or merge leftover\)\. Take each out of the commit with git rm --cached debug\.log and add it to \.gitignore, or, if it belongs in the repo, list it under "strayFiles\.allow" in \.acc\/config\.json\./);
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

test('acc gate run raises a ratchet\'s floor only in a task\'s own worktree; acc gate relax is a person\'s, with a reason, and gate list shows the floor (GH-99)', () => {
  // About a ratchet; stray-files has its own tests (GH-103).
  const cfg = { ...GENERIC_CONFIG, strayFiles: { required: false }, gates: { required: ['tests'], ratchets: { tests: { command: 'cat count.txt', limit: 'floor', label: 'tests' } } } };
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(cfg), '.acc/floors.json': '{\n  "tests": {\n    "floor": 669\n  }\n}\n', 'count.txt': '674\n' });
  const git = (cwd: string, ...a: string[]) => spawnSync('git', a, { cwd, encoding: 'utf8' }).stdout.trim();
  const heavy = { ACC_HEAVY_DIR: join(makeRepo(), 'slots') };
  const floors = (root: string) => JSON.parse(readFileSync(join(root, '.acc', 'floors.json'), 'utf8'));
  assert.equal(acc(dir, ['add', 'More tests']).code, 0);
  assert.equal(acc(dir, ['add', 'Elsewhere']).code, 0);
  const wt = join(tempDir('wt-'), 'T-1');
  git(dir, 'worktree', 'add', '-q', '-b', 'task/T-1', wt, 'main');
  const ledgerPath = join(dir, '.git', 'acc', 'ledger.json');
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  ledger.tasks[0].run = { branch: 'task/T-1', worktree: wt };
  ledger.tasks[1].run = { branch: 'task/T-2', worktree: dir };
  writeFileSync(ledgerPath, JSON.stringify(ledger));

  // On the environment's branch, and in the main checkout on a task's branch: it says so, and writes nothing.
  const onMain = acc(dir, ['gate', 'run'], undefined, heavy);
  assert.equal(onMain.code, 0, onMain.err);
  assert.match(onMain.out, /tests 674 beats the floor 669 by 5\./);
  git(dir, 'checkout', '-q', '-b', 'task/T-2');
  assert.match(acc(dir, ['gate', 'run'], undefined, heavy).out, /tests 674 beats the floor 669 by 5\./);
  assert.deepEqual([floors(dir), git(dir, 'status', '--porcelain')], [{ tests: { floor: 669 } }, '']);

  // In the task's own worktree: written there, and acc gate run asks for it to be committed.
  const raised = acc(wt, ['gate', 'run'], undefined, { ...heavy, ACC_ROLE: 'builder', ACC_TASK: 'T-1' });
  assert.equal(raised.code, 1, 'not done until the floor is committed');
  assert.match(raised.out, /tests 674 beats the floor 669: raised it in \.acc\/floors\.json/);
  assert.match(raised.out, /Raised in \.acc\/floors\.json: tests 669 → 674\. Commit that file, then run acc gate run again: acc done takes the commit that records it\./);
  assert.doesNotMatch(raised.out, /to fix/);
  assert.deepEqual([floors(wt), floors(dir)], [{ tests: { floor: 674 } }, { tests: { floor: 669 } }], 'in the worktree, and nowhere else');
  git(wt, 'commit', '-qam', 'T-1: raise the tests floor');
  const again = acc(wt, ['gate', 'run'], undefined, { ...heavy, ACC_ROLE: 'builder', ACC_TASK: 'T-1' });
  assert.equal(again.code, 0, again.out);
  assert.match(again.out, /tests 674, at its floor\.\nAll recorded\./);
  assert.match((acc(wt, ['gate', 'list', '--json']).json() as { gates: { name: string; about: string }[] }).gates.find((g) => g.name === 'tests')!.about, /cat count\.txt \(tests, which may only go up\); floor 674$/);

  // Relaxing: never a builder's, always with a reason and a number.
  const builder = acc(dir, ['gate', 'relax', 'tests', '--to', '640', '--reason', 'mine', '--task', 'T-1', '--as', 'human'], undefined, { ACC_ROLE: 'builder', ACC_TASK: 'T-1' });
  assert.deepEqual([builder.code, /A builder can't relax a floor/.test(builder.err)], [1, true]);
  assert.equal(acc(dir, ['gate', 'relax', 'tests', '--to', '640', '--task', 'T-1', '--as', 'reviewer']).code, 1, 'nor an agent');
  assert.match(acc(dir, ['gate', 'relax', 'tests', '--to', '640', '--task', 'T-1']).err, /Say why it's relaxed/);
  assert.equal(acc(dir, ['gate', 'relax', 'tests', '--reason', 'why', '--task', 'T-1']).code, 2, '--to is needed');
  assert.deepEqual([floors(wt), existsSync(join(dir, '.git', 'acc', 'relaxed.jsonl'))], [{ tests: { floor: 674 } }, false], 'nothing changed by a refusal');
  const r = acc(dir, ['gate', 'relax', 'tests', '--to', '640', '--reason', 'the slow suite moved to its own job', '--task', 'T-1', '--json']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(floors(wt).tests.floor, 640);
  assert.deepEqual([floors(wt).tests.relaxed.reason, floors(wt).tests.relaxed.was], ['the slow suite moved to its own job', 674]);
  const record = JSON.parse(readFileSync(join(dir, '.git', 'acc', 'relaxed.jsonl'), 'utf8').trim());
  assert.deepEqual([record.ratchet, record.to, record.was, record.task, realpathSync(record.root)], ['tests', 640, 674, 'T-1', realpathSync(wt)]);
  const event = readFileSync(join(dir, '.git', 'acc', 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).at(-1);
  assert.deepEqual([event.task, event.actor, event.data.relaxed.to], ['T-1', 'human', 640]);
  // It says what passes now, as DESIGN §9 does: for this task alone, the relaxed number or a better one, from the floor it relaxed.
  const said = acc(dir, ['gate', 'relax', 'tests', '--to', '630', '--reason', 'and the flaky one', '--task', 'T-1']);
  assert.equal(said.code, 0, said.err);
  assert.match(said.out, /^Relaxed tests's floor for T-1, from 640 to 630, in /);
  assert.match(said.out, /Commit that file with T-1's change\. The relax is for T-1 alone: where its branch began at floor 640, it passes with its floor at 630 or a better one, on that branch and in the merge queue's merge of it, until T-1 is done\. Another task's branch isn't backed by it, even one that began at the same floor\./);
  assert.match(acc(dir, ['gate', 'waive', 'tests', '--reason', 'flaky']).err, /tests is a ratchet: .*acc gate relax tests/);

  // A relax is for one task (GH-130): none from a checkout that isn't a task's, or for a task that's done.
  git(dir, 'checkout', '-q', 'main');
  const records = () => readFileSync(join(dir, '.git', 'acc', 'relaxed.jsonl'), 'utf8').split('\n').filter(Boolean).length;
  const none = acc(dir, ['gate', 'relax', 'tests', '--to', '620', '--reason', 'why']);
  assert.deepEqual([none.code, /A relax is for one task, and this checkout isn't a task's\. Name it: acc gate relax tests --to <n> --reason "<why>" --task <id>\./.test(none.err), records()], [2, true, 2]);
  const finished = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  finished.tasks[0].state = 'done';
  writeFileSync(ledgerPath, JSON.stringify(finished));
  const late = acc(dir, ['gate', 'relax', 'tests', '--to', '620', '--reason', 'why', '--task', 'T-1']);
  assert.deepEqual([late.code, late.err.trim()], [1, '✗ T-1 is done, and a relax counts only while its task is open.']);
  // acc gate run drops T-1's records now it's done; the Command Center never does (D-012).
  assert.equal(records(), 2);
  assert.equal(acc(dir, ['gate', 'run'], undefined, heavy).code, 0);
  assert.equal(records(), 0, 'pruned by acc\'s own command');
});

test('acc gate required and acc gate builder show and set a project\'s checks, one key each; a name it doesn\'t have is refused (GH-111)', () => {
  const dir = makeRepo({ '.acc/config.json': LIMITS_CONFIG });
  const file = join(dir, '.acc', 'config.json');
  assert.deepEqual(acc(dir, ['gate', 'required', '--json']).json(), { required: ['check', 'stray-files'], gates: ['check', 'typecheck', 'near-tests'], queue: ['main'] }, 'stray-files is required beside them, and never named (GH-103)');
  assert.equal(acc(dir, ['gate', 'required']).out, 'Required checks: check, stray-files. Where the merge queue runs (main), they run once in it, before each merge.\n');
  assert.equal(acc(dir, ['gate', 'builder']).out, 'Builders run the required checks (check, stray-files): no lighter ones are named.\n');

  const lighter = acc(dir, ['gate', 'builder', 'typecheck', 'near-tests']);
  assert.equal(lighter.code, 0, lighter.err);
  assert.equal(lighter.out, 'Builders now run typecheck, near-tests where the merge queue runs (main), and the required checks (check, stray-files) run once in it, before each merge. Set in .acc/config.json: commit it to share it.\n');
  const withBuilder = LIMITS_CONFIG.replace('"near-tests": "true"\n    }\n  }', '"near-tests": "true"\n    },\n    "builder": [\n      "typecheck",\n      "near-tests"\n    ]\n  }');
  assert.equal(readFileSync(file, 'utf8'), withBuilder);
  // acc gate list marks them, as it did when a person edited the file by hand (D-096).
  assert.match(acc(dir, ['gate', 'list']).out, /Builders run typecheck, near-tests, stray-files, and acc done takes them\./);

  assert.equal(acc(dir, ['gate', 'required', 'check', 'typecheck']).code, 0);
  assert.equal(readFileSync(file, 'utf8'), withBuilder.replace('"required": [\n      "check"\n    ]', '"required": [\n      "check",\n      "typecheck"\n    ]'));
  const unknown = acc(dir, ['gate', 'required', 'deploy']);
  assert.equal(unknown.code, 2);
  assert.match(unknown.err, /deploy isn't a check this project has\. Name the required checks from: check, typecheck, near-tests\./);
  assert.equal(acc(dir, ['gate', 'builder', 'typecheck', '--none']).code, 2, 'not both');

  assert.equal(acc(dir, ['gate', 'builder', '--none']).code, 0);
  assert.equal(readFileSync(file, 'utf8'), LIMITS_CONFIG.replace('"required": [\n      "check"\n    ]', '"required": [\n      "check",\n      "typecheck"\n    ]'), 'taken out, the rest as it was');
  // Named where no merge queue runs, they're named, and builders still run the required checks.
  const manual = makeRepo({ '.acc/config.json': LIMITS_CONFIG.replace('"autonomy": "review"', '"autonomy": "manual"') });
  assert.equal(acc(manual, ['gate', 'builder', 'typecheck']).code, 0);
  assert.match(acc(manual, ['gate', 'builder']).out, /^gates\.builder names typecheck, but no environment's pull requests go through the merge queue .*so builders run the required checks \(check, stray-files\)\./);
});
