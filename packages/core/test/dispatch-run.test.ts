// A dispatch run end to end: the worktree, the background session, the builder's note, cleanup and the Mac
// kept awake. These were dispatch.test.ts's; they're their own file so npm test runs them beside it (T-57).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { parseConfig } from '../src/config.ts';
import { awakePath } from '../src/awake.ts';
import { builderSettings } from '../src/packet.ts';
import { dispatch, findSession } from '../src/dispatch.ts';
import { run } from '../src/exec.ts';
import { DONE_COMMAND, mutate, type RunNote, upsertTasks } from '../src/ledger.ts';
import { repoPaths } from '../src/paths.ts';
import { reviewPath } from '../src/review.ts';
import { acc, fakeClaude, IGNORE, NOTE, QUIET, tasksOf, trustingHome } from './dispatch-support.ts';
import { fakeAwake, fakeRunner, GENERIC_CONFIG, gitIn, makeRepo, ok, SF_CONFIG, tempDir } from './support.ts';

test('dispatch end to end: worktree from the environment branch, packet, background session, ledger', () => {
  const repo = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG), ...IGNORE }));
  const claude = fakeClaude();
  const env = { PATH: `${claude.bin}${delimiter}${process.env.PATH}`, HOME: trustingHome(repo) };
  assert.equal(acc(repo, ['add', 'Write the changelog', '--brief', 'Add CHANGELOG.md with one entry.']).code, 0);
  const r = acc(repo, ['dispatch', 'T-1', '--json'], env);
  assert.equal(r.code, 0, r.err);
  const out = r.json();
  assert.equal(out.worktree, join(repo, '.claude', 'worktrees', 'T-1'));
  assert.equal(out.branch, 'task/T-1-write-the-changelog');
  assert.equal(out.bgId, 'bg1');
  assert.equal(out.sessionId, 'sess-1');
  assert.equal(gitIn(out.worktree, 'rev-parse', '--abbrev-ref', 'HEAD'), 'task/T-1-write-the-changelog');
  assert.equal(gitIn(out.worktree, 'rev-parse', 'HEAD'), gitIn(repo, 'rev-parse', 'main'), 'starts from the environment branch');
  assert.match(readFileSync(out.packetPath, 'utf8'), /Add CHANGELOG.md with one entry./);

  const launch = claude.calls().find((c) => c.args[0] === '--bg')!;
  assert.equal(realpathSync(launch.cwd), repo, 'the session starts in the trusted main checkout');
  assert.ok(launch.args.at(-1)!.includes(`Call the **EnterWorktree** tool with the path \`${out.worktree}\``), 'the agent enters its worktree first');
  assert.equal(spawnSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).stdout, '', 'the main checkout stays clean');
  assert.equal(spawnSync('git', ['status', '--porcelain'], { cwd: out.worktree, encoding: 'utf8' }).stdout, '', 'the worktree starts clean, linked node_modules or not');
  // Named for its project, task and role (D-087), as Claude Code's session list shows it.
  assert.deepEqual(launch.args.slice(0, 5), ['--bg', '--name', 'Tool · T-1 Write the changelog · builder', '--permission-mode', 'acceptEdits']);
  assert.equal(out.name, 'Tool · T-1 Write the changelog · builder');
  const settings = JSON.parse(launch.args[launch.args.indexOf('--settings') + 1]!);
  assert.equal(settings.env.ACC_TASK, 'T-1');
  assert.equal(settings.env.ACC_ROLE, 'builder');
  assert.ok(settings.permissions.deny.includes('Bash(git push*)'));
  assert.ok(settings.permissions.allow.includes('Bash(nice -n 15 node --no-warnings --test*)'), 'tests run under nice need no prompt');
  assert.match(launch.args.at(-1)!, /# Task T-1: Write the changelog/);

  const task = tasksOf(repo).find((t) => t.id === 'T-1')!;
  assert.equal(task.state, 'running');
  assert.equal(task.run!.bgId, 'bg1');
  assert.equal(task.run!.worktree, out.worktree);
  assert.equal(task.run!.name, 'Tool · T-1 Write the changelog · builder', 'the name is recorded, so the session is found by it');
  assert.equal(task.run!.n, 1);

  // stray-files is required with nothing in gates.required (GH-103): acc done waits for it, and acc gate run
  // runs it, a skip here since the branch adds nothing.
  const early = acc(out.worktree, ['done', ...NOTE], { ...env, ACC_ROLE: 'builder', ACC_TASK: 'T-1' });
  assert.equal(early.code, 1);
  assert.match(early.err, /stray-files/);
  const gate = acc(out.worktree, ['gate', 'run', '--json'], { ...env, ACC_ROLE: 'builder', ACC_TASK: 'T-1' });
  assert.equal(gate.code, 0, gate.err);
  assert.deepEqual(gate.json().results.map((x: { gate: string; status: string }) => [x.gate, x.status]), [['stray-files', 'skip']]);

  // The builder finishes from inside its worktree, identified by its session environment.
  const done = acc(out.worktree, ['done', ...NOTE, '--json'], { ...env, ACC_ROLE: 'builder', ACC_TASK: 'T-1' });
  assert.equal(done.code, 0, done.err);
  assert.equal(done.json().entry.by, 'builder:T-1');
  assert.equal(tasksOf(repo)[0]!.state, 'review');

  // Rework reuses the same worktree and branch, with the task's second builder.
  assert.equal(acc(repo, ['set', 'T-1', 'rework', '--reason', 'needs a date']).code, 0);
  const again = acc(repo, ['dispatch', 'T-1', '--json'], env);
  assert.equal(again.code, 0, again.err);
  assert.equal(again.json().reused, true);
  assert.equal(again.json().bgId, 'bg2');
  const second = claude.calls().filter((c) => c.args[0] === '--bg')[1]!;
  assert.equal(second.args[second.args.indexOf('--name') + 1], 'Tool · T-1 Write the changelog · builder 2');
  assert.deepEqual([tasksOf(repo)[0]!.run!.name, tasksOf(repo)[0]!.run!.n], ['Tool · T-1 Write the changelog · builder 2', 2]);
  assert.match(acc(repo, ['show', 'T-1'], env).out, /Agent: Tool · T-1 Write the changelog · builder 2/);
});

test('a dispatch records its own new session, not an older one of the same name or one named the old way (D-087)', () => {
  const repo = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG), ...IGNORE }));
  const claude = fakeClaude();
  const name = 'Tool · T-1 Write the changelog · builder';
  // A builder of an older run named the old way, and one of this name from another clone, an hour ago.
  writeFileSync(join(claude.dir, 'sessions.json'), JSON.stringify([
    { id: 'old', sessionId: 'sess-old', name: 'T-1', kind: 'background', cwd: repo, startedAt: Date.now(), state: 'done', pid: 3999999 },
    { id: 'clone', sessionId: 'sess-clone', name, kind: 'background', cwd: repo, startedAt: Date.now() - 3_600_000, state: 'working', pid: 3999998 },
    { id: 'there', sessionId: 'sess-there', name, kind: 'background', cwd: '/elsewhere/Tool', startedAt: Date.now() + 60_000, state: 'working', pid: 3999997 },
  ]));
  const env = { PATH: `${claude.bin}${delimiter}${process.env.PATH}`, HOME: trustingHome(repo) };
  assert.equal(acc(repo, ['add', 'Write the changelog']).code, 0);
  const r = acc(repo, ['dispatch', 'T-1', '--json'], env);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual([r.json().bgId, r.json().sessionId], ['bg4', 'sess-4']);
  assert.equal(tasksOf(repo)[0]!.run!.bgId, 'bg4');
});

test('dispatch refuses tasks that aren\'t ready, and stops at the agent cap', () => {
  const repo = makeRepo({ '.acc/config.json': JSON.stringify({ ...GENERIC_CONFIG, agents: { max: 1 } }), ...IGNORE });
  const claude = fakeClaude();
  const env = { PATH: `${claude.bin}${delimiter}${process.env.PATH}`, HOME: trustingHome(repo) };
  acc(repo, ['add', 'First']);
  acc(repo, ['add', 'Second', '--dep', 'T-1']);
  acc(repo, ['add', 'Third']);
  assert.match(acc(repo, ['dispatch', 'T-2'], env).err, /waiting on T-1, which is todo/);
  assert.equal(acc(repo, ['dispatch', 'T-1'], env).code, 0);
  assert.match(acc(repo, ['dispatch', 'T-3'], env).err, /1 builder is running in this project, and its cap is 1 \(agents\.max\)/);
  assert.equal(claude.calls().filter((c) => c.args[0] === '--bg').length, 1, 'no session was started for the refused tasks');
});

test('a builder can block with a reason, but can\'t mark work done or move other tasks', () => {
  const repo = makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG), ...IGNORE });
  const claude = fakeClaude();
  const env = { PATH: `${claude.bin}${delimiter}${process.env.PATH}`, HOME: trustingHome(repo) };
  acc(repo, ['add', 'Work']);
  const wt = acc(repo, ['dispatch', 'T-1', '--json'], env).json().worktree;
  const b = { ...env, ACC_ROLE: 'builder', ACC_TASK: 'T-1' };
  assert.equal(acc(wt, ['block'], b).code, 2, 'a reason is required');
  assert.equal(acc(wt, ['block', 'The', 'org', 'is', 'down'], b).code, 0);
  const t = tasksOf(repo)[0] as { state: string; blocker?: string };
  assert.equal(t.state, 'blocked');
  assert.equal(t.blocker, 'The org is down');
  assert.match(acc(wt, ['set', 'T-1', 'todo'], b).err, /A builder can't move a task from blocked to todo/);
});

test('a builder finishes with a note that its next run, a task that depends on it and acc show read (D-106)', () => {
  const repo = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify({ ...GENERIC_CONFIG, ...QUIET }), ...IGNORE }));
  const claude = fakeClaude();
  const env = { PATH: `${claude.bin}${delimiter}${process.env.PATH}`, HOME: trustingHome(repo) };
  acc(repo, ['add', 'Write the changelog']);
  acc(repo, ['add', 'Link the changelog', '--dep', 'T-1']);
  const wt = acc(repo, ['dispatch', 'T-1', '--json'], env).json().worktree;
  const b = { ...env, ACC_ROLE: 'builder', ACC_TASK: 'T-1' };
  const packet = () => readFileSync(join(repo, '.git', 'acc', 'packets', 'T-1.md'), 'utf8');
  assert.ok(packet().includes(`\`${DONE_COMMAND}\``), 'the finish line gives the command word for word');
  assert.match(packet(), /posted on the pull request on GitHub, so keep secrets and client data out of it/);

  // Without a note, acc done is refused with the exact command, and the task stays running.
  const bare = acc(wt, ['done'], b);
  assert.equal(bare.code, 1);
  assert.ok(bare.err.includes(DONE_COMMAND), bare.err);
  assert.match(acc(wt, ['done', '--landed', 'The changelog'], b).err, /says nothing about --moved, --open/);
  assert.equal(tasksOf(repo)[0]!.state, 'running');

  // With one, each flag a line, and none an empty part.
  const done = acc(wt, ['done', '--landed', 'CHANGELOG.md with one entry', '--moved', 'none', '--open', 'Link it from the README', '--open', 'Date the entry', '--json'], b);
  assert.equal(done.code, 0, done.err);
  const note = (tasksOf(repo)[0]!.run as unknown as { note: RunNote }).note;
  // Its file's name is recorded as code (T-146): the builder wrote it bare, inside double quotes.
  assert.deepEqual({ ...note, at: '' }, { landed: ['`CHANGELOG.md` with one entry'], moved: [], open: ['Link it from the README', 'Date the entry'], at: '', by: 'builder:T-1', ended: 'review' });
  const moved = readFileSync(join(repo, '.git', 'acc', 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.type === 'task.moved' && e.data.to === 'review');
  assert.deepEqual(moved.at(-1).data.note, note, 'its event carries it');
  const shown = acc(repo, ['show', 'T-1']).out;
  assert.match(shown, /Builder's note \(builder:T-1, to review .*\):\n {2}What landed:\n {4}- `CHANGELOG\.md` with one entry\n {2}Numbers that moved:\n {4}none\n {2}Still open:\n {4}- Link it from the README\n {4}- Date the entry/);
  assert.deepEqual(acc(repo, ['show', 'T-1', '--json']).json().run.note, note);

  // A rework's next run is told what the last one left, and keeps it as run.before.
  assert.equal(acc(repo, ['set', 'T-1', 'rework', '--reason', 'needs a date']).code, 0);
  assert.equal(acc(repo, ['dispatch', 'T-1'], env).code, 0);
  assert.match(packet(), /## What your last run left\n\nThis task ran before \(builder 1\), and its builder left this note when it moved it to review\. It's that builder's own account: check it against the tree \(`git status`, `git log --oneline origin\/main\.\.HEAD` and `acc gate list`\)/);
  assert.match(packet(), /\*\*Still open\*\*\n\n- Link it from the README\n- Date the entry/);
  const run = tasksOf(repo)[0]!.run as unknown as { note?: RunNote; before?: RunNote | null };
  assert.deepEqual([run.before, run.note], [note, undefined]);
  assert.match(acc(repo, ['show', 'T-1']).out, /Builder's note, from its last run/);

  // A block needs no note, and may give one.
  assert.equal(acc(wt, ['block', 'Which date format?', '--open', 'Pick a date format'], b).code, 0);
  const blocked = (tasksOf(repo)[0]!.run as unknown as { note: RunNote }).note;
  assert.deepEqual([blocked.landed, blocked.moved, blocked.open, blocked.ended], [[], [], ['Pick a date format'], 'blocked']);

  // A person's move to review needs none. Once T-1 is done, T-2's packet holds T-1's note.
  assert.equal(acc(repo, ['set', 'T-1', 'review']).code, 0);
  assert.equal(acc(repo, ['set', 'T-1', 'done']).code, 0);
  const second = acc(repo, ['dispatch', 'T-2', '--json'], env);
  assert.equal(second.code, 0, second.err);
  assert.match(readFileSync(second.json().packetPath, 'utf8'), /## What the tasks it depends on left\n\nThis task builds on another, whose builder left a note when it finished\. Each is that builder's own account\.\n\n### T-1: Write the changelog\n\n\*\*What landed\*\*\n\n- none\n\n\*\*Numbers that moved\*\*\n\n- none\n\n\*\*Still open\*\*\n\n- Pick a date format\n/);
  assert.doesNotMatch(readFileSync(second.json().packetPath, 'utf8'), /last run/, 'a first run has no last run');
});

test('a re-dispatch after a run that left no note tells its builder to check the tree first (D-106)', () => {
  const repo = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify({ ...GENERIC_CONFIG, ...QUIET }), ...IGNORE }));
  const claude = fakeClaude();
  const env = { PATH: `${claude.bin}${delimiter}${process.env.PATH}`, HOME: trustingHome(repo) };
  acc(repo, ['add', 'Write the changelog']);
  acc(repo, ['add', 'Link the changelog', '--dep', 'T-1']);
  assert.equal(acc(repo, ['dispatch', 'T-1'], env).code, 0);
  // Its builder crashed, and a person set it aside.
  assert.equal(acc(repo, ['set', 'T-1', 'todo', '--reason', 'its builder crashed']).code, 0);
  const again = acc(repo, ['dispatch', 'T-1', '--json'], env);
  assert.equal(again.code, 0, again.err);
  const packet = readFileSync(again.json().packetPath, 'utf8');
  assert.match(packet, /## Your last run left no note\n\nThis task ran before \(builder 1\), and that run ended without a note: it may have crashed, run out of context or been stopped, or a person moved it\. Don't assume its work is finished, or that none was done\. Start by checking the tree: `git status`, `git log --oneline origin\/main\.\.HEAD` and `acc gate list`\./);
  assert.equal(tasksOf(repo)[0]!.run!.before, null);
  assert.match(acc(repo, ['show', 'T-1']).out, /Its last run left no note\./);
  // A dependency that left no note isn't listed.
  assert.equal(acc(repo, ['set', 'T-1', 'review']).code, 0);
  assert.equal(acc(repo, ['set', 'T-1', 'done']).code, 0);
  assert.doesNotMatch(readFileSync(acc(repo, ['dispatch', 'T-2', '--json'], env).json().packetPath, 'utf8'), /tasks it depends on/);
});

test('Salesforce dispatch points the worktree at the environment\'s org', () => {
  const repo = makeRepo({ '.acc/config.json': JSON.stringify(SF_CONFIG), ...IGNORE });
  gitIn(repo, 'branch', 'dev');
  const claude = fakeClaude();
  acc(repo, ['add', 'A field']);
  const env = { PATH: `${claude.bin}${delimiter}${process.env.PATH}`, HOME: trustingHome(repo) };
  // A Salesforce task waits for its analysis (D-052), unless a person says to go without.
  assert.match(acc(repo, ['dispatch', 'T-1'], env).err, /hasn't been analyzed.*acc analyze T-1/s);
  const r = acc(repo, ['dispatch', 'T-1', '--without-analysis', '--json'], env);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(readFileSync(join(r.json().worktree, '.sf', 'config.json'), 'utf8')), { 'target-org': 'Acme Dev' });
  assert.match(readFileSync(r.json().packetPath, 'utf8'), /validate, then deploy, through acc only/);
});

test('cleanup keeps a worktree with uncommitted or unmerged work, and removes it once merged', () => {
  const repo = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify({ ...GENERIC_CONFIG, ...QUIET }), ...IGNORE }));
  const claude = fakeClaude();
  const env = { PATH: `${claude.bin}${delimiter}${process.env.PATH}`, HOME: trustingHome(repo) };
  acc(repo, ['add', 'Docs']);
  const { worktree, branch } = acc(repo, ['dispatch', 'T-1', '--json'], env).json();
  assert.match(acc(repo, ['cleanup', 'T-1']).out, /still running/);
  acc(worktree, ['done', ...NOTE], { ...env, ACC_ROLE: 'builder', ACC_TASK: 'T-1' });
  writeFileSync(join(worktree, 'NOTES.md'), 'draft\n');
  assert.match(acc(repo, ['cleanup', 'T-1']).out, /1 uncommitted change/);
  gitIn(worktree, 'add', 'NOTES.md');
  gitIn(worktree, 'commit', '-q', '-m', 'T-1: notes');
  assert.match(acc(repo, ['cleanup', 'T-1']).out, /1 commit\(s\) that aren't in main yet/);
  gitIn(repo, 'merge', '-q', '--ff-only', branch);
  const ok = acc(repo, ['cleanup', 'T-1', '--json']);
  assert.equal(ok.code, 0, ok.out);
  assert.equal(existsSync(worktree), false);
  assert.equal(spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: repo }).status, 1, 'the merged branch is gone');
});

test('a background dispatch keeps the Mac awake for its session\'s own process, and a builder may never resume (D-067)', () => {
  const repo = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG), ...IGNORE }));
  const config = parseConfig(GENERIC_CONFIG).config!;
  const paths = repoPaths(repo, run);
  mutate(paths, () => new Date(), (l, emit) => { upsertTasks(l, config, [{ source: { kind: 'manual', key: 'T-1' }, title: 'Write the changelog' }], 'human', 'human:test', emit, () => new Date()); });
  const runner = fakeRunner({
    'claude --bg': ok('backgrounded'),
    'claude agents --json': () => ok(JSON.stringify([{ pid: 4242, id: 'bg1', sessionId: 'sess-1', name: 'Tool · T-1 Write the changelog · builder', kind: 'background', startedAt: Date.now(), state: 'working', status: 'busy' }])),
  });
  const awake = fakeAwake();
  const r = dispatch(paths, config, 'T-1', { run: runner, now: () => new Date(), accBinDir: '/acc/bin', env: { HOME: trustingHome(repo), PATH: '/usr/bin' }, awake: awake.deps }, { actor: 'human', by: 'human:test' });
  assert.ok(!r.held);
  assert.deepEqual([r.bgId, r.sessionId], ['bg1', 'sess-1']);
  assert.deepEqual(awake.spawned, [['caffeinate', '-i', '-w', '4242']], 'acc exits now; caffeinate watches the session instead');
  assert.equal(JSON.parse(readFileSync(awakePath(paths, 'T-1'), 'utf8')).watch, 4242, 'written down, so it ends when the task leaves running');
  const s = builderSettings({ id: 'T-1' } as never, config, '/acc/bin', '/usr/bin') as { permissions: { deny: string[] } };
  assert.ok(s.permissions.deny.includes('Bash(acc resume*)'));
});

test('a session listed before its process is asked for again until its pid shows, so the Mac is still kept awake (D-067)', () => {
  const session = { id: 'bg1', sessionId: 'sess-1', name: 'T-1', kind: 'background', startedAt: 1, state: 'working', status: 'busy' };
  let asked = 0;
  const later: typeof run = (cmd, args) => (cmd === 'claude' && args[0] === 'agents'
    ? { code: 0, stdout: JSON.stringify([++asked < 3 ? session : { ...session, pid: 4242 }]), stderr: '', timedOut: false }
    : { code: 0, stdout: '', stderr: '', timedOut: false });
  assert.deepEqual(findSession(later, '/w', 'T-1', 5_000), { bgId: 'bg1', sessionId: 'sess-1', pid: 4242 });
  assert.equal(asked, 3, 'asked until the pid was there');
  const never: typeof run = () => ({ code: 0, stdout: JSON.stringify([session]), stderr: '', timedOut: false });
  assert.deepEqual(findSession(never, '/w', 'T-1', 1_200), { bgId: 'bg1', sessionId: 'sess-1', pid: null }, 'a pid that never shows still finds the session');
});

test('a new session is found by its name, in the folder it started in or its worktree, once it started (D-087)', () => {
  const name = 'Tool · T-1 Write the changelog · builder';
  const listed = (...xs: object[]): typeof run => () => ({ code: 0, stdout: JSON.stringify(xs), stderr: '', timedOut: false });
  const at = { since: 1_000, places: ['/repo', '/repo/.claude/worktrees/T-1'] };
  const s = { id: 'bg1', sessionId: 'sess-1', name, kind: 'background', cwd: '/repo', startedAt: 2_000, pid: 7 };
  assert.deepEqual(findSession(listed(s), '/repo', name, 0, at), { bgId: 'bg1', sessionId: 'sess-1', pid: 7 });
  assert.equal(findSession(listed({ ...s, cwd: '/repo/.claude/worktrees/T-1' }), '/repo', name, 0, at).bgId, 'bg1', 'already in its worktree');
  assert.equal(findSession(listed({ ...s, startedAt: 500 }), '/repo', name, 0, at).bgId, null, 'started before this dispatch');
  assert.equal(findSession(listed({ ...s, cwd: '/other/clone' }), '/repo', name, 0, at).bgId, null, 'another clone\'s');
  assert.equal(findSession(listed({ ...s, name: 'T-1' }), '/repo', name, 0, at).bgId, null, 'named the old way');
  assert.equal(findSession(listed({ ...s, kind: 'interactive' }), '/repo', name, 0, at).bgId, null, 'not a background session');
});

test('dispatch refuses before touching anything when Claude Code doesn\'t trust the repo (D-022)', () => {
  const repo = makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG), ...IGNORE });
  const claude = fakeClaude();
  acc(repo, ['add', 'Work']);
  const r = acc(repo, ['dispatch', 'T-1'], { PATH: `${claude.bin}${delimiter}${process.env.PATH}`, HOME: tempDir('home-') });
  assert.equal(r.code, 1);
  assert.match(r.err, /doesn't trust .* yet.*Run `claude` once in that folder, accept the trust prompt/s);
  assert.equal(existsSync(join(repo, '.claude', 'worktrees', 'T-1')), false, 'no worktree was made');
  assert.equal(claude.calls().length, 0, 'claude was never called');
  assert.equal(tasksOf(repo)[0]!.state, 'todo');
});

test('a rework a person sent back gets the passed review\'s findings in the written packet only while the review is of the branch head (T-76)', () => {
  const repo = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify({ ...GENERIC_CONFIG, ...QUIET }), ...IGNORE }));
  const claude = fakeClaude();
  const env = { PATH: `${claude.bin}${delimiter}${process.env.PATH}`, HOME: trustingHome(repo) };
  const paths = repoPaths(repo, run);
  assert.equal(acc(repo, ['add', 'Write the changelog']).code, 0);
  const first = acc(repo, ['dispatch', 'T-1', '--json'], env);
  assert.equal(first.code, 0, first.err);
  const wt = first.json().worktree as string;
  writeFileSync(join(wt, 'CHANGELOG.md'), 'one\n');
  gitIn(wt, 'add', '.');
  gitIn(wt, 'commit', '-m', 'T-1: changelog');
  const head = gitIn(wt, 'rev-parse', 'HEAD');
  mkdirSync(paths.reviews, { recursive: true });
  const at = new Date().toISOString();
  const findings = [{ file: 'CHANGELOG.md', line: 3, message: 'Date the entry.', must: true }];
  writeFileSync(reviewPath(paths, 'T-1', head), JSON.stringify({ v: 1, task: 'T-1', sha: head, env: 'main', verdict: 'pass', summary: 'Adds it.', criteria: [], findings, sessionId: 's', at, durationMs: 1, costUsd: null }));
  const backToBuilder = (reason: string) => {
    const toReview = acc(repo, ['set', 'T-1', 'review']);
    assert.equal(toReview.code, 0, toReview.err);
    const back = acc(repo, ['set', 'T-1', 'rework', '--reason', reason]);
    assert.equal(back.code, 0, back.err);
    const r = acc(repo, ['dispatch', 'T-1'], env);
    assert.equal(r.code, 0, r.err);
    return readFileSync(join(paths.packets, 'T-1.md'), 'utf8');
  };

  const same = backToBuilder('Fix the findings.');
  assert.ok(same.includes('> Fix the findings.') && same.includes('listed these findings') && same.includes('- **Must fix:** `CHANGELOG.md:3`: Date the entry.'), 'the review is of the branch head');
  assert.ok(same.indexOf('> Fix the findings.') < same.indexOf('Date the entry.'), 'the person\'s reason comes first');

  // The branch has a newer commit than the one reviewed: nothing is said about the review.
  writeFileSync(join(wt, 'CHANGELOG.md'), 'one\ntwo\n');
  gitIn(wt, 'commit', '-am', 'T-1: more');
  const newer = backToBuilder('Again.');
  assert.ok(newer.includes('> Again.'));
  assert.ok(!newer.includes('Date the entry.') && !newer.includes('listed these findings'), 'the review is of an older commit');
});
