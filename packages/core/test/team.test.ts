import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { type Config, parseConfig } from '../src/config.ts';
import { run } from '../src/exec.ts';
import { postToolUseHook } from '../src/hooks.ts';
import { mutate, type Task } from '../src/ledger.ts';
import { builderSettings, renderPacket } from '../src/packet.ts';
import { repoPaths } from '../src/paths.ts';
import { reviewPrompt } from '../src/review.ts';
import {
  behindWords, envRef, codeList, FILES_SHOWN, landedCommits, landedFor, markTold, MATE_STATE, ownFiles, readSeen, seenPath, taskOfCommit, teamForRun, teamNotice, teamOf, teamSection, writeSeen,
} from '../src/team.ts';
import { GENERIC_CONFIG, gitIn, makeRepo, tempDir, writePlan } from './support.ts';

const MAIN = fileURLToPath(new URL('../../cli/src/main.ts', import.meta.url));
const now = () => new Date('2026-10-22T12:00:00Z');
const RAW = { ...GENERIC_CONFIG, autopilot: { appendOnly: ['docs/DECISIONS.md'] }, dispatch: { shared: ['docs/DESIGN.md'] } };

function task(id: string, state: Task['state'], extra: Partial<Task> = {}): Task {
  return { id, title: `Task ${id}`, brief: '', source: { kind: 'manual', key: id, url: null }, environment: 'main', deps: [], labels: [], state, blocker: null, run: null, pr: null, history: [], createdAt: '', updatedAt: '', ...extra };
}

const write = (root: string, files: Record<string, string>, message: string): string => {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  gitIn(root, 'add', '-A');
  gitIn(root, 'commit', '-q', '-m', message);
  return gitIn(root, 'rev-parse', 'HEAD');
};

/**
 * A project with five tasks in flight or not: T-1 running with a plan for src/a.ts and src/b.ts; T-2 running,
 * its branch changing src/a.ts and the shared design doc; T-3 in review, its plan naming src/b.ts; T-4 sent
 * back, changing src/c.ts; T-5 to do; T-6 done. After T-1's branch left main, T-6's merge changed src/a.ts on
 * main, then a commit by hand changed README.md.
 */
function setup() {
  const origin = tempDir('origin-');
  gitIn(origin, 'init', '-q', '--bare', '-b', 'main');
  const root = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify(RAW), '.gitignore': '.claude/\n', 'src/a.ts': 'a\n', 'src/b.ts': 'b\n', 'src/c.ts': 'c\n', 'docs/DESIGN.md': '# Design\n' }));
  gitIn(root, 'remote', 'add', 'origin', origin);
  gitIn(root, 'push', '-q', 'origin', 'main');
  const config = parseConfig(RAW).config as Config;
  const paths = repoPaths(root, run);
  const wt = (id: string, files?: Record<string, string>) => {
    const dir = join(root, '.claude', 'worktrees', id);
    gitIn(root, 'worktree', 'add', '-q', '-b', `task/${id}`, dir, 'main');
    if (files) write(dir, files, `${id}: work`);
    return dir;
  };
  const wt1 = wt('T-1');
  const wt2 = wt('T-2', { 'src/a.ts': 'a from T-2\n', 'docs/DESIGN.md': '# Design\n\nT-2\n' });
  const wt3 = wt('T-3');
  const wt4 = wt('T-4', { 'src/c.ts': 'c from T-4\n' });
  writePlan(paths.analyses, 'T-1', ['src/a.ts', 'src/b.ts']);
  writePlan(paths.analyses, 'T-3', ['src/b.ts']);
  // T-6's work, merged into main after T-1 left it, then a change by hand.
  gitIn(root, 'checkout', '-q', '-b', 'task/T-6');
  write(root, { 'src/a.ts': 'a from T-6\n' }, 'T-6: a');
  gitIn(root, 'checkout', '-q', 'main');
  gitIn(root, 'merge', '-q', '--no-ff', '-m', 'Merge T-6: Rename a', 'task/T-6');
  const merge6 = gitIn(root, 'rev-parse', 'HEAD');
  const tidy = write(root, { 'README.md': '# test\n\nTidied.\n' }, 'Tidy the README');
  gitIn(root, 'push', '-q', 'origin', 'main');
  const tasks = [
    task('T-1', 'running', { title: 'Add the team', run: { branch: 'task/T-1', worktree: wt1 } }),
    task('T-2', 'running', { title: 'Rewrite a', run: { branch: 'task/T-2', worktree: wt2 } }),
    task('T-3', 'review', { title: 'Tune b', run: { branch: 'task/T-3', worktree: wt3 } }),
    task('T-4', 'rework', { title: 'Fix c', run: { branch: 'task/T-4', worktree: wt4 } }),
    task('T-5', 'todo'),
    task('T-6', 'done', { title: 'Rename a', run: { branch: 'task/T-6' } }),
  ];
  mutate(paths, now, (l, emit) => {
    l.tasks.push(...tasks);
    for (const t of tasks) emit({ type: 'task.added', task: t.id, actor: 'human', by: 'human:test', data: {} });
  });
  return { root, origin, config, paths, wt1, wt2, wt4, merge6, tidy, ledger: { tasks } };
}

test('a task\'s team: each other task in flight, sharing first, with what it plans and has changed, and what merged since', () => {
  const s = setup();
  const team = teamOf(s.paths, s.config, s.ledger, run, 'T-1');
  assert.equal(team.env, 'main');
  assert.deepEqual(team.own, ['src/a.ts', 'src/b.ts'], 'its plan, with nothing changed yet');
  assert.deepEqual(team.mates.map((m) => [m.id, m.state, m.shares]), [['T-2', 'running', ['src/a.ts']], ['T-3', 'review', ['src/b.ts']], ['T-4', 'rework', []]], 'sharing first; to do and done aren\'t in flight');
  const [t2, t3, t4] = team.mates;
  assert.deepEqual(t2!.changed, ['docs/DESIGN.md', 'src/a.ts'], 'its branch changed the design doc too, which every task edits and never counts as shared');
  assert.equal(t2!.planned, null, 'no plan');
  assert.deepEqual(t3!.planned, ['src/b.ts']);
  assert.deepEqual(t3!.changed, [], 'its branch has changed nothing yet');
  assert.deepEqual(t4!.changed, ['src/c.ts']);
  assert.deepEqual(team.landed.map((l) => [l.sha, l.task, l.shares]), [[s.merge6, 'T-6', ['src/a.ts']], [s.tidy, null, []]], 'oldest first: T-6\'s merge, then a change acc can\'t match to a task');
  assert.deepEqual(team.landed[0]!.files, ['src/a.ts']);
  assert.equal(team.landed[0]!.title, 'Rename a');
  assert.equal(team.landed[1]!.subject, 'Tidy the README');
  assert.equal(behindWords(team), '2 merges behind main');
});

test('the team section: sharing first and marked, the rest, what merged since, and how to work with them', () => {
  const s = setup();
  const team = teamOf(s.paths, s.config, s.ledger, run, 'T-1');
  const text = teamSection(team, 'builder').join('\n');
  assert.match(text, /^## Your team right now\n/);
  assert.match(text, /Run `acc team` for how it is now, and run it before you change a file the team shares/);
  const at = (s2: string) => text.indexOf(s2);
  assert.ok(at('### Sharing files with you') > 0 && at('### Sharing files with you') < at('### The rest of the team'), 'the tasks sharing files come first');
  assert.ok(at('**T-2**') < at('**T-3**') && at('**T-3**') < at('**T-4**'));
  assert.match(text, /- \*\*T-2\*\* \(being built, into `main`\): Rewrite a\n {2}- \*\*Shares with you:\*\* `src\/a\.ts`/);
  assert.match(text, /\*\*T-3\*\* \(in review, into `main`\): Tune b[\s\S]*Its plan changes: `src\/b\.ts`[\s\S]*Its branch has changed: nothing yet/);
  assert.match(text, /\*\*T-4\*\* \(sent back, into `main`\): Fix c\n {2}- Its plan changes: its plan names no files/, 'a task sharing nothing isn\'t marked');
  assert.ok(at('### Merged into `main` since your branch left it') > at('**T-4**'), 'what merged since comes after the team');
  assert.match(text, new RegExp(`- \\*\\*T-6\\*\\*: Rename a \\(${s.merge6.slice(0, 7)}\\): changed \`src/a\\.ts\`\\. \\*\\*Shares with you:\\*\\* \`src/a\\.ts\``));
  assert.match(text, /- "Tidy the README" \([0-9a-f]{7}\): changed `README\.md`\n/);
  assert.match(text, /Keep to your own module where you can\.\n- Where you must change a module the team shares, keep the change small, and say so in your note\./);
  assert.match(text, /`acc refresh` to take it in early/);
});

test('the reviewer\'s team section judges a change against the others\' areas, with no instructions for a builder', () => {
  const s = setup();
  const text = teamSection(teamOf(s.paths, s.config, s.ledger, run, 'T-1'), 'reviewer').join('\n');
  assert.match(text, /^## The team right now\n/);
  assert.match(text, /Judge whether this change steps on another task's area/);
  assert.match(text, /### Sharing files with T-1/);
  assert.match(text, /\*\*Shares with T-1:\*\* `src\/a\.ts`/);
  assert.match(text, /since its branch left it/);
  assert.doesNotMatch(text, /you|acc team|acc refresh/, 'nothing addressed to the builder');
});

test('an empty team, and a task with no branch yet: no one in flight, and nothing merged since', () => {
  const s = setup();
  const alone = { tasks: [task('T-9', 'running', { run: { branch: 'task/T-1', worktree: s.wt1 } })] };
  const team = teamOf(s.paths, s.config, alone, run, 'T-9');
  assert.deepEqual(team.mates, []);
  const text = teamSection({ ...team, landed: [] }, 'builder').join('\n');
  assert.match(text, /No other task is in flight now\./);
  assert.match(text, /### Merged into `main` since your branch left it\n\nNothing yet\./);
  assert.doesNotMatch(text, /### Sharing files/);
  assert.equal(behindWords({ env: 'main', landed: [] }), 'Up to date with main');
  assert.equal(behindWords({ env: 'dev', landed: team.landed.slice(0, 1) }), '1 merge behind dev');
  const unbuilt = teamOf(s.paths, s.config, s.ledger, run, 'T-5');
  assert.deepEqual(unbuilt.landed, [], 'a task with no branch has nothing behind it');
  assert.deepEqual(teamOf(s.paths, s.config, s.ledger, run, 'T-99'), { task: 'T-99', env: '', own: [], mates: [], landed: [] }, 'a task the ledger doesn\'t hold has no team');
});

test('a commit on the environment\'s branch is matched to its task by its merge, its pull request, or its subject', () => {
  const tasks = [{ id: 'T-6', pr: null }, { id: 'T-60', pr: { number: 42, url: 'u', state: 'merged' as const, mergeSha: 'abc' } }];
  assert.equal(taskOfCommit(tasks, 'abc', 'anything'), 'T-60', 'the merge acc sync kept');
  assert.equal(taskOfCommit(tasks, 'x', 'Rename a (#42)'), 'T-60', 'GitHub\'s squash subject');
  assert.equal(taskOfCommit(tasks, 'x', 'Merge pull request #42 from acme/task/T-60-x'), 'T-60', 'GitHub\'s merge subject');
  assert.equal(taskOfCommit(tasks, 'x', 'Merge T-6: Rename a'), 'T-6', 'acc\'s merge');
  assert.equal(taskOfCommit(tasks, 'x', 'T-6: a builder\'s commit'), 'T-6');
  assert.equal(taskOfCommit([{ id: 'T-6', pr: null }], 'x', 'T-60: another task'), null, 'T-60 isn\'t T-6');
  assert.equal(taskOfCommit(tasks, 'x', 'Tidy the README (#4)'), null, 'a pull request acc doesn\'t know');
});

test('the branch the team is measured against: origin\'s copy first, then the local one, and none at all', () => {
  const s = setup();
  assert.equal(envRef(run, s.root, 'main'), 'refs/remotes/origin/main');
  assert.equal(envRef(run, s.root, 'nowhere'), null);
  assert.deepEqual(landedCommits(run, s.root, 'nowhere', 'task/T-1'), [], 'an environment this clone lacks has nothing landed');
  gitIn(s.root, 'branch', 'dev', 'main');
  assert.equal(envRef(run, s.root, 'dev'), 'refs/heads/dev', 'a branch origin doesn\'t have');
  assert.deepEqual(landedCommits(run, s.root, 'main', 'task/T-1').map((c) => c.subject), ['Merge T-6: Rename a', 'Tidy the README'], 'first parents only: T-6\'s own commit is part of its merge');
  assert.deepEqual(ownFiles(s.paths, run, s.ledger.tasks[3]!), ['src/c.ts'], 'no plan: what its branch changed');
  assert.deepEqual(landedFor(s.paths, run, s.ledger, [{ sha: '0'.repeat(40), subject: 'gone' }], ['src/a.ts'], []), [{ sha: '0'.repeat(40), subject: 'gone', task: null, title: null, files: null, shares: [] }], 'a commit git can\'t read shares nothing');
});

test('a file list names twelve files, then says how many more', () => {
  const files = Array.from({ length: FILES_SHOWN + 3 }, (_, i) => `f${i}.ts`);
  assert.equal(codeList(files.slice(0, 2)), '`f0.ts`, `f1.ts`');
  assert.match(codeList(files), /`f11\.ts` and 3 more$/);
  assert.equal(codeList([]), '');
  assert.equal(MATE_STATE.review, 'in review');
});

test('a builder is told once a merge, only of merges that share its files, and later of one its growing work comes to share', () => {
  const s = setup();
  const said = teamNotice(s.paths, s.config, s.ledger, run, 'T-1')!;
  assert.match(said, /A teammate's work merged into main, and it shares files with yours \(T-1\):/);
  assert.match(said, new RegExp(`- T-6 \\(Rename a\\) merged as ${s.merge6.slice(0, 7)}\\. It changed what you share: \`src/a\\.ts\`\\.`));
  assert.doesNotMatch(said, /Tidy the README/, 'a merge that shares nothing isn\'t told');
  assert.match(said, /Run `acc refresh` to take it in now/);
  assert.equal(teamNotice(s.paths, s.config, s.ledger, run, 'T-1'), null, 'once a merge');
  assert.deepEqual(readSeen(s.paths, 'T-1').told, [s.merge6]);
  assert.deepEqual(readSeen(s.paths, 'T-1').files[s.tidy], ['README.md'], 'what a merge changed is read from git once');
  // T-4's work shares nothing with either merge: nothing to tell, until it changes the README too.
  assert.equal(teamNotice(s.paths, s.config, s.ledger, run, 'T-4'), null, 'only builders that share files are told');
  writeFileSync(join(s.wt4, 'README.md'), '# mine\n');
  assert.match(teamNotice(s.paths, s.config, s.ledger, run, 'T-4') ?? '', /- "Tidy the README" merged as [0-9a-f]{7}\. It changed what you share: `README\.md`\./, 'a change acc can\'t match to a task is named by its subject');
  assert.equal(teamNotice(s.paths, s.config, s.ledger, run, 'T-5'), null, 'a task with no branch is never told');
  assert.equal(teamNotice(s.paths, s.config, s.ledger, run, 'T-99'), null);
});

test('what the notices keep: a missing or broken file is nothing told yet, and a dispatch marks the packet\'s merges told', () => {
  const s = setup();
  assert.deepEqual(readSeen(s.paths, 'T-1'), { told: [], files: {} }, 'before the first notice');
  mkdirSync(dirname(seenPath(s.paths, 'T-1')), { recursive: true });
  writeFileSync(seenPath(s.paths, 'T-1'), '{ broken');
  assert.deepEqual(readSeen(s.paths, 'T-1'), { told: [], files: {} });
  writeSeen(s.paths, 'T-1', { told: ['x'], files: { x: null } });
  markTold(s.paths, 'T-1', ['x', 'y']);
  markTold(s.paths, 'T-1', []);
  assert.deepEqual(readSeen(s.paths, 'T-1'), { told: ['x', 'y'], files: { x: null } });
  // T-2 re-dispatched: its packet lists both merges, so neither is told again.
  const team = teamForRun(s.paths, s.config, s.ledger, run, 'T-2', 'task/T-2', s.wt2)!;
  assert.equal(team.landed.length, 2);
  assert.deepEqual(readSeen(s.paths, 'T-2').told, [s.merge6, s.tidy]);
  assert.equal(teamNotice(s.paths, s.config, s.ledger, run, 'T-2'), null);
  assert.equal(teamForRun({ ...s.paths, stateDir: '/dev/null/none' }, s.config, s.ledger, run, 'T-2', 'task/T-2', s.wt2), null, 'a team acc can\'t keep leaves the packet without one');
});

test('acc hook post-tool-use tells a running builder of a shared merge once, and says nothing to anyone else', () => {
  const s = setup();
  const hook = (env: Record<string, string>, cwd: string) => {
    const r = spawnSync(process.execPath, ['--no-warnings', MAIN, 'hook', 'post-tool-use'], { cwd, input: JSON.stringify({ hook_event_name: 'PostToolUse', cwd, tool_name: 'Bash', tool_input: { command: 'ls' } }), encoding: 'utf8', env: { ...process.env, ACC_ROLE: '', ACC_TASK: '', ...env } });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim() ? JSON.parse(r.stdout) : null;
  };
  const out = hook({ ACC_ROLE: 'builder', ACC_TASK: 'T-1' }, s.wt1);
  assert.equal(out?.hookSpecificOutput?.hookEventName, 'PostToolUse');
  assert.match(out.hookSpecificOutput.additionalContext, /T-6 \(Rename a\) merged/);
  assert.equal(hook({ ACC_ROLE: 'builder', ACC_TASK: 'T-1' }, s.wt1), null, 'once a merge');
  assert.equal(hook({}, s.root), null, 'a session that isn\'t a builder');
  const ctx = { cwd: s.wt4, env: { ACC_ROLE: 'builder', ACC_TASK: 'T-4' }, run, now };
  assert.equal(postToolUseHook({}, ctx), null, 'a builder sent back isn\'t running');
  assert.equal(postToolUseHook({}, { ...ctx, cwd: tempDir() }), null, 'outside a repo that has opted in');
});

test('the packet carries the team before where the builder is, and a builder may run acc team and acc refresh', () => {
  const s = setup();
  const team = teamOf(s.paths, s.config, s.ledger, run, 'T-1');
  const env = s.config.environments[0]!;
  const packet = renderPacket({ task: s.ledger.tasks[0]!, config: s.config, env, worktree: s.wt1, branch: 'task/T-1', rules: null, environmentSpecific: [], team });
  assert.ok(packet.indexOf('## Your team right now') > 0 && packet.indexOf('## Your team right now') < packet.indexOf('## Where you are'));
  assert.doesNotMatch(renderPacket({ task: s.ledger.tasks[0]!, config: s.config, env, worktree: s.wt1, branch: 'task/T-1', rules: null, environmentSpecific: [] }), /Your team/, 'a team that couldn\'t be read leaves it out');
  const allow = (builderSettings(s.ledger.tasks[0]!, s.config, '/bin', '') as { permissions: { allow: string[] } }).permissions.allow;
  assert.ok(allow.includes('Bash(acc team*)') && allow.includes('Bash(acc refresh)'));
  const { prompt } = reviewPrompt({ task: s.ledger.tasks[0]!, config: s.config, envName: 'main', envBranch: 'main', sha: 'a'.repeat(40), packet: '# T-1', diff: '', stat: '', checks: [], rules: null, team });
  assert.ok(prompt.indexOf('## The team right now') > 0 && prompt.indexOf('## The team right now') < prompt.indexOf('## The checks on this commit'), 'the reviewer sees the team');
  assert.doesNotMatch(reviewPrompt({ task: s.ledger.tasks[0]!, config: s.config, envName: 'main', envBranch: 'main', sha: 'a'.repeat(40), packet: '# T-1', diff: '', stat: '', checks: [], rules: null }).prompt, /The team right now/);
});
