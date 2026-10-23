// The builder's packet and settings, and the model and effort a dispatch starts it with. A dispatch run end to
// end is in dispatch-run.test.ts, and conflict-aware dispatch in held.test.ts (T-57).
import assert from 'node:assert/strict';
import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseConfig } from '../src/config.ts';
import { builderSettings, renderPacket } from '../src/packet.ts';
import { slugify, taskBranch, worktreeRoot } from '../src/dispatch.ts';
import { shortPacket } from '../src/hooks.ts';
import { DONE_COMMAND, emptyLedger, upsertTasks } from '../src/ledger.ts';
import { acc, fakeClaude, IGNORE, NOTE, QUIET, tasksOf, trustingHome } from './dispatch-support.ts';
import { GENERIC_CONFIG, gitIn, makeRepo, SF_CONFIG } from './support.ts';

test('names: slugs are short and branch-safe, and worktrees sit beside the repo (D-013)', () => {
  assert.equal(slugify('Fix the Account layout! (urgent)'), 'fix-the-account-layout-urgent');
  assert.equal(slugify('A'.repeat(60)), 'task');
  assert.equal(slugify('one two three four five six seven eight nine ten'), 'one-two-three-four-five-six-seven-eight');
  assert.equal(taskBranch({ id: 'AV-12', title: 'Login page' }), 'task/AV-12-login-page');
  const cfg = parseConfig(JSON.parse(JSON.stringify(GENERIC_CONFIG))).config!;
  assert.equal(worktreeRoot(cfg, '/x/Acme'), '/x/Acme/.claude/worktrees');
  assert.equal(worktreeRoot({ ...cfg, worktrees: { root: '../trees', setup: [] } }, '/x/Acme'), '/x/trees');
});

test('the packet tells a Salesforce builder where it is, how to finish, and what never to touch', () => {
  const config = parseConfig(JSON.parse(JSON.stringify(SF_CONFIG))).config!;
  const l = emptyLedger();
  upsertTasks(l, config, [{ source: { kind: 'jira', key: 'ACME-7', url: 'https://x/ACME-7' }, title: 'Add a field', brief: 'Add Region__c to Account.' }], 'human', 'h', () => {}, () => new Date());
  const env = config.environments.find((e) => e.branch === 'dev')!;
  const p = renderPacket({ task: l.tasks[0]!, config, env, worktree: '/w/ACME-7', branch: 'task/ACME-7-add-a-field', rules: 'Use the selector pattern.', environmentSpecific: ['force-app/main/default/settings/MyDomain.settings-meta.xml'] });
  for (const must of ['# Task ACME-7: Add a field', 'Add Region__c to Account.', 'https://x/ACME-7', '`/w/ACME-7`', '`task/ACME-7-add-a-field`', 'started from `dev`', '`Acme Dev`',
    'validate, then deploy, through acc only', '`acc gate run deploy`', '`acc done`', '`acc block', '`format`, `validate`, `deploy`', 'push, merge a pull request, or open one', 'deploy except through `acc gate run deploy`, and never to a protected org', '`sf project deploy start`', 'MyDomain.settings-meta.xml', 'Use the selector pattern.']) {
    assert.ok(p.includes(must), must);
  }
  assert.ok(!p.includes('refs #'), 'Jira tasks don\'t get GitHub refs');
  assert.ok(p.includes(`by running \`acc done\` as its own command, all on one line: \`${DONE_COMMAND}\``), 'the finish line is acc done with its note, word for word (D-106)');
  assert.ok(p.includes('npm scripts'), 'wrappers are ruled out');
  assert.ok(p.includes('run exactly `acc gate run`') && p.includes('`acc gate run --test AccountServiceTest="covers the new discount rule"`'), 'Apex changes add --test to the same command');
  assert.ok(p.indexOf('**Commit**') < p.indexOf('**Checks:**'), 'commit first: receipts vouch for a commit');
  assert.ok(!p.includes('M4'), 'no stopgap for missing gates');
  const withPath = renderPacket({ task: l.tasks[0]!, config, env, worktree: '/w', branch: 'b', rules: null, environmentSpecific: [], accPath: '/opt/acc/bin/acc' });
  assert.ok(withPath.includes('its full path is `/opt/acc/bin/acc`'));
});

test('a rework autopilot sent back for failing checks tells its builder what GitHub said, and no review\'s changes (D-076)', () => {
  const config = parseConfig({ ...GENERIC_CONFIG, gates: { required: ['test'], commands: { test: 'npm test' } } }).config!;
  const l = emptyLedger();
  upsertTasks(l, config, [{ source: { kind: 'github', key: '57', url: 'https://github.com/acme/tool/issues/57' }, title: 'Add sum', brief: 'sum(a, b)' }], 'human', 'h', () => {}, () => new Date());
  const env = config.environments[0]!;
  const sha = 'a'.repeat(40);
  const passed = { v: 1 as const, task: 'GH-57', sha, env: 'main', verdict: 'pass' as const, summary: 'Adds sum.', criteria: [], findings: [], sessionId: 's', at: '2026-10-06T09:00:00.000Z', durationMs: 1, costUsd: null };
  const checks = {
    v: 1 as const, task: 'GH-57', sha, pr: { number: 42, url: 'https://github.com/acme/tool/pull/42' }, required: false, at: '2026-10-06T09:10:00.000Z',
    checks: [
      { name: 'test', workflow: 'CI', link: 'https://github.com/acme/tool/actions/runs/1/job/2', log: 'not ok 1 - sum adds\n# fail 1', noLog: null },
      { name: 'lint', workflow: 'CI', link: 'https://github.com/acme/tool/actions/runs/1/job/3', log: null, noLog: 'failed to get run log: log not found' },
    ],
  };
  const p = renderPacket({ task: l.tasks[0]!, config, env, worktree: '/w/GH-57', branch: 'task/GH-57-add-sum', rules: null, environmentSpecific: [], review: passed, checks });
  for (const must of [
    '## What GitHub\'s checks said', 'pull request #42, and its checks failed on GitHub on aaaaaaa: test, lint', '### test (CI)', 'Link: https://github.com/acme/tool/actions/runs/1/job/2',
    '```text\nnot ok 1 - sum adds\n# fail 1\n```', '### lint (CI)', 'Couldn\'t fetch its log: failed to get run log: log not found.',
    'run `acc block "<what you found>"` and stop', 'run exactly `acc gate run`', '`acc done` as its own command',
  ]) assert.ok(p.includes(must), must);
  assert.ok(!p.includes('What the review asked for'), 'its review passed');
  assert.ok(p.indexOf('What GitHub\'s checks said') < p.indexOf('## Where you are'), 'before where it works, as a review\'s changes are');
  const plain = renderPacket({ task: l.tasks[0]!, config, env, worktree: '/w/GH-57', branch: 'task/GH-57-add-sum', rules: null, environmentSpecific: [] });
  assert.ok(!plain.includes('What GitHub\'s checks said'), 'a first build has none');
});

test('a rework a person sent back tells its builder why, in their words, though its review passed', () => {
  const config = parseConfig(GENERIC_CONFIG).config!;
  const l = emptyLedger();
  upsertTasks(l, config, [{ source: { kind: 'github', key: '80', url: null }, title: 'Templates', brief: 'b' }], 'human', 'h', () => {}, () => new Date());
  const env = config.environments[0]!;
  const t = l.tasks[0]!;
  const at = '2026-10-07T14:24:31.030Z';
  const back = { ...t, state: 'rework' as const, history: [...t.history, { at, actor: 'human' as const, by: 'human:jack', from: 'review' as const, to: 'rework' as const, reason: 'Fix (1) the clone.\nThen (2) the docs.' }] };
  const passed = { v: 1 as const, task: 'GH-80', sha: 'a'.repeat(40), env: 'main', verdict: 'pass' as const, summary: 'Adds templates.', criteria: [], findings: [], sessionId: 's', at, durationMs: 1, costUsd: null };
  const p = renderPacket({ task: back, config, env, worktree: '/w', branch: 'b', rules: null, environmentSpecific: [], review: passed });
  for (const must of ['## Why a person sent it back', 'jack moved it back to rework from review, saying:', '> Fix (1) the clone.', '> Then (2) the docs.', 'Do what it asks']) assert.ok(p.includes(must), must);
  assert.ok(p.indexOf('Why a person sent it back') < p.indexOf('## Where you are'));
  // Sent back by a reviewer, it's the review's own section; a first build has neither.
  const byReviewer = { ...back, history: [...t.history, { at, actor: 'reviewer' as const, by: 'reviewer:GH-80', from: 'review' as const, to: 'rework' as const, reason: 'changes' }] };
  assert.ok(!renderPacket({ task: byReviewer, config, env, worktree: '/w', branch: 'b', rules: null, environmentSpecific: [] }).includes('Why a person sent it back'));
  assert.ok(!renderPacket({ task: t, config, env, worktree: '/w', branch: 'b', rules: null, environmentSpecific: [] }).includes('Why a person sent it back'));
});

test('a rework a person sent back carries the passed review\'s findings with files and lines, of the latest commit only', () => {
  const config = parseConfig(GENERIC_CONFIG).config!;
  const l = emptyLedger();
  upsertTasks(l, config, [{ source: { kind: 'github', key: '74', url: null }, title: 'Sheet', brief: 'b' }], 'human', 'h', () => {}, () => new Date());
  const env = config.environments[0]!;
  const t = l.tasks[0]!;
  const at = '2026-10-19T09:00:00.000Z';
  const back = { ...t, state: 'rework' as const, history: [...t.history, { at, actor: 'human' as const, by: 'human:jack', from: 'review' as const, to: 'rework' as const, reason: 'Fix the findings.' }] };
  const head = 'b'.repeat(40);
  const findings = [
    { file: 'src/a.ts', line: 12, message: 'Name the edge case.', must: true },
    { file: 'src/b.ts', message: 'Tidy this later.', must: false },
  ];
  const passed = { v: 1 as const, task: 'GH-74', sha: head, env: 'main', verdict: 'pass' as const, summary: 'Adds a sheet.', criteria: [], findings, sessionId: 's', at, durationMs: 1, costUsd: null };
  const input = { config, env, worktree: '/w', branch: 'b', rules: null, environmentSpecific: [] };
  const p = renderPacket({ task: back, ...input, review: passed, head });
  for (const must of ['The review of bbbbbbb passed, and listed these findings:', '- **Must fix:** `src/a.ts:12`: Name the edge case.', '- `src/b.ts`: Tidy this later.']) assert.ok(p.includes(must), must);
  assert.ok(p.indexOf('> Fix the findings.') < p.indexOf('Name the edge case.'), 'the person\'s reason comes first');
  // The review is of an older commit than the branch's last, there's none, or the branch's commit is unknown: nothing is said.
  for (const [what, extra] of [['an older commit', { review: passed, head: 'c'.repeat(40) }], ['no review', { review: null, head }], ['an unknown head', { review: passed }]] as const) {
    const q = renderPacket({ task: back, ...input, ...extra });
    assert.ok(q.includes('> Fix the findings.'), what);
    assert.ok(!q.includes('Name the edge case.') && !q.includes('listed these findings') && !q.includes('review of'), what);
  }
  // A review that asked for changes shows its must-fix findings once, in its own section; the person's send-back adds none.
  const asked = { ...passed, verdict: 'changes' as const };
  const r = renderPacket({ task: back, ...input, review: asked, head });
  assert.equal(r.split('Name the edge case.').length - 1, 1, 'listed once');
  assert.ok(r.includes('## What the review asked for') && !r.includes('Tidy this later.') && !r.includes('listed these findings'));
});

test('where a ratchet is a builder\'s check, the finish line says to commit the floor acc raised and never to make one worse; a builder can\'t relax one (GH-99)', () => {
  const raw = {
    ...GENERIC_CONFIG, autonomy: 'review', autopilot: { autoMerge: true },
    gates: { required: ['check', 'tests'], builder: ['typecheck', 'tests'], commands: { check: 'npm run check', typecheck: 'tsc' }, ratchets: { tests: { command: 'node scripts/count-tests.mjs', limit: 'floor', label: 'tests' } } },
  };
  const config = parseConfig(raw).config!;
  const l = emptyLedger();
  upsertTasks(l, config, [{ source: { kind: 'github', key: '99', url: 'https://github.com/acme/tool/issues/99' }, title: 'A ratchet' }], 'human', 'h', () => {}, () => new Date());
  const task = { ...l.tasks[0]!, run: { worktree: '/w/GH-99', branch: 'task/GH-99-a-ratchet' } };
  const env = config.environments[0]!;
  const p = renderPacket({ task, config, env, worktree: '/w/GH-99', branch: 'task/GH-99-a-ratchet', rules: null, environmentSpecific: [] });
  assert.ok(p.includes('   `tests` is a ratchet: a number that may only get better. When yours beats its floor, `acc gate run` writes the new floor to `.acc/floors.json`: commit that file, then run `acc gate run` again. Never make the number, or a floor in that file, worse by hand. If this change has to make one worse, block and say why: only a person relaxes a floor.'), p);
  assert.ok(p.indexOf('is a ratchet') < p.indexOf('3. **Finish**'), 'in the checks step');
  const without = parseConfig({ ...raw, gates: { ...raw.gates, builder: ['typecheck'] } }).config!;
  assert.ok(!renderPacket({ task, config: without, env, worktree: '/w', branch: 'b', rules: null, environmentSpecific: [] }).includes('is a ratchet'), 'not where builders don\'t run one');
  const deny = (builderSettings(task, config, '/acc/bin', '/usr/bin') as { permissions: { deny: string[] } }).permissions.deny;
  assert.ok(deny.includes('Bash(acc gate relax*)') && deny.includes('Bash(acc gate waive*)'));
});

test('where the merge queue runs the full check, the packet and the short one name a builder\'s lighter checks, and say the full one runs in the queue (GH-73)', () => {
  const raw = { ...GENERIC_CONFIG, autonomy: 'review', autopilot: { autoMerge: true }, gates: { required: ['check'], builder: ['typecheck', 'near-tests'], commands: { check: 'npm run check', typecheck: 'tsc', 'near-tests': 'node near.mjs' } } };
  const config = parseConfig(raw).config!;
  const l = emptyLedger();
  upsertTasks(l, config, [{ source: { kind: 'github', key: '73', url: 'https://github.com/acme/tool/issues/73' }, title: 'A queue' }], 'human', 'h', () => {}, () => new Date());
  const task = { ...l.tasks[0]!, run: { worktree: '/w/GH-73', branch: 'task/GH-73-a-queue' } };
  const env = config.environments[0]!;
  const p = renderPacket({ task, config, env, worktree: '/w/GH-73', branch: 'task/GH-73-a-queue', rules: null, environmentSpecific: [] });
  assert.ok(p.includes('It runs the required checks (`typecheck`, `near-tests`, `stray-files`) on your latest commit'), p);
  assert.ok(p.includes('These are the lighter checks, such as the tests near what you changed. The full check (`check`) runs once, in the merge queue, before your pull request merges'));
  assert.ok(p.includes('- push, merge a pull request, or open one (a person, `acc land` and autopilot do that)'), 'merging the base in isn\'t forbidden');
  assert.match(shortPacket(task, ['typecheck', 'near-tests'], ['check']), /run exactly `acc gate run` \(typecheck, near-tests\), then finish with your note, all on one line: `acc done --landed .*\nThe full check \(check\) runs once, in the merge queue, before the merge\.\nNever push, merge a pull request, or open one\. Never deploy except through `acc gate run deploy`.*never to a protected org\./s);
  // Elsewhere, as before: the required checks, and nothing about a queue.
  const off = parseConfig({ ...raw, autopilot: { autoMerge: false } }).config!;
  const plain = renderPacket({ task, config: off, env, worktree: '/w/GH-73', branch: 'task/GH-73-a-queue', rules: null, environmentSpecific: [] });
  assert.ok(plain.includes('It runs the required checks (`check`, `stray-files`)') && !plain.includes('merge queue'));
  assert.ok(!shortPacket(task, ['check']).includes('merge queue'));
  // A builder may bring its own base in, as the queue asks when it conflicts, with flags or without: only
  // where the queue runs, and no other branch.
  const allows = (c: typeof config, t = task) => (builderSettings(t, c, '/acc/bin', '/usr/bin') as { permissions: { allow: string[] } }).permissions.allow;
  const merges = (c: typeof config, t = task) => allows(c, t).filter((a) => a.startsWith('Bash(git merge'));
  assert.equal(task.environment, 'main');
  assert.deepEqual(merges(config), ['Bash(git merge origin/main)', 'Bash(git merge origin/main *)']);
  assert.ok(!allows(config).some((a) => a.includes('origin/*')), 'not any branch on origin');
  assert.deepEqual(merges(off), [], 'auto-merge off: it asks first, as before');
  assert.deepEqual(merges(parseConfig({ ...raw, autonomy: 'manual' }).config!), [], 'manual autonomy merges nothing on its own');
  const kept = parseConfig({ ...raw, environments: [...GENERIC_CONFIG.environments, { name: 'release', protected: true }] }).config!;
  assert.deepEqual(merges(kept, { ...task, environment: 'release' }), [], 'a protected environment never auto-merges');
  // The config refuses auto-merge in a Salesforce project; set on one anyway, it still isn't allowed.
  const sfParsed = parseConfig({ ...JSON.parse(JSON.stringify(SF_CONFIG)), autonomy: 'review' }).config!;
  const sf = { ...sfParsed, autopilot: { appendOnly: [], autoMerge: true as const } };
  const sfEnv = sf.environments.find((e) => !e.protected)!;
  assert.deepEqual(merges(sf, { ...task, environment: sfEnv.branch }), [], 'never in a Salesforce project');
});

test('builder settings: identity, acc on PATH, and the dangerous commands denied even if the user allows them', () => {
  const config = parseConfig(JSON.parse(JSON.stringify(SF_CONFIG))).config!;
  const s = builderSettings({ id: 'ACME-7' } as never, config, '/acc/bin', '/usr/bin') as { env: Record<string, string>; permissions: { allow: string[]; deny: string[] } };
  assert.deepEqual(s.env, { ACC_TASK: 'ACME-7', ACC_ROLE: 'builder', PATH: '/acc/bin:/usr/bin' });
  for (const d of ['Bash(git push*)', 'Bash(gh pr *)', 'Bash(sf project deploy start*)', 'Bash(acc set *)', 'Bash(git checkout *)', 'Bash(acc agents autonomy*)', 'Bash(acc agents auto-merge*)', 'Bash(acc trackers set*)', 'Bash(gh release create*)', 'Bash(npm run release*)']) assert.ok(s.permissions.deny.includes(d), d);
  assert.ok(s.permissions.allow.includes('Bash(sf project deploy validate *)'));
  // A builder works from the brief it was given, so it can't edit its task (T-74).
  assert.ok(s.permissions.deny.includes('Bash(acc edit*)'), 'acc edit is denied');
  for (const a of ['Bash(acc gate run)', 'Bash(acc gate run *)', 'Bash(acc gate list*)']) assert.ok(s.permissions.allow.includes(a), a);
});

test('a builder runs with the project\'s model and this clone\'s effort, when they\'re chosen (D-036)', () => {
  const repo = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify({ ...GENERIC_CONFIG, agents: { builder: { model: 'opus', effort: 'high' } } }), ...IGNORE }));
  gitIn(repo, 'config', 'acc.builder.effort', 'low');
  const claude = fakeClaude();
  const env = { PATH: `${claude.bin}:${process.env.PATH}`, HOME: trustingHome(repo) };
  assert.equal(acc(repo, ['add', 'Write the changelog']).code, 0);
  assert.equal(acc(repo, ['dispatch', 'T-1', '--json'], env).code, 0);
  const launch = claude.calls().find((c) => c.args[0] === '--bg')!;
  assert.deepEqual(launch.args.slice(5, 9), ['--model', 'opus', '--effort', 'low']);
});

const modelOfLaunch = (args: string[]) => args[args.indexOf('--model') + 1];

test('a builder nobody chose a model for runs the Command Center\'s default, and its run says so without calling it picked (D-086)', () => {
  const repo = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG), ...IGNORE }));
  const claude = fakeClaude();
  const env = { PATH: `${claude.bin}:${process.env.PATH}`, HOME: trustingHome(repo) };
  acc(repo, ['add', 'Write the changelog']);
  const r = acc(repo, ['dispatch', 'T-1'], env);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /model: {4}claude-opus-5-5\n/);
  const launch = claude.calls().find((c) => c.args[0] === '--bg')!;
  assert.deepEqual(launch.args.slice(5, 7), ['--model', 'claude-opus-5-5']);
  assert.equal(launch.args.filter((a) => a === '--model').length, 1);
  const run = tasksOf(repo)[0]!.run!;
  assert.equal(run.model, 'claude-opus-5-5');
  assert.ok(!('modelPicked' in run));
});

test('a model picked for a task reaches claude --bg over the project\'s and the clone\'s, and a rework keeps it (D-086)', () => {
  const repo = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify({ ...GENERIC_CONFIG, ...QUIET, agents: { builder: { model: 'opus', fallbackModel: 'sonnet' } } }), ...IGNORE }));
  gitIn(repo, 'config', 'acc.builder.model', 'haiku');
  const claude = fakeClaude();
  const env = { PATH: `${claude.bin}:${process.env.PATH}`, HOME: trustingHome(repo) };
  acc(repo, ['add', 'Write the changelog']);
  const r = acc(repo, ['dispatch', 'T-1', '--model', 'sonnet', '--json'], env);
  assert.equal(r.code, 0, r.err);
  const first = claude.calls().filter((c) => c.args[0] === '--bg')[0]!;
  assert.equal(modelOfLaunch(first.args), 'sonnet');
  assert.ok(!first.args.includes('--fallback-model'), 'the fallback is the model itself, which Claude Code refuses');
  assert.deepEqual([tasksOf(repo)[0]!.run!.model, tasksOf(repo)[0]!.run!.modelPicked], ['sonnet', true]);
  assert.equal(r.json().task.run.model, 'sonnet');

  // Sent back for rework, it's re-dispatched with no --model, as autopilot does: the pick stays.
  acc(r.json().worktree, ['done', ...NOTE], { ...env, ACC_ROLE: 'builder', ACC_TASK: 'T-1' });
  assert.equal(acc(repo, ['set', 'T-1', 'rework', '--reason', 'needs a date']).code, 0);
  const again = acc(repo, ['dispatch', 'T-1', '--json'], env);
  assert.equal(again.code, 0, again.err);
  assert.equal(modelOfLaunch(claude.calls().filter((c) => c.args[0] === '--bg')[1]!.args), 'sonnet');
  assert.deepEqual([tasksOf(repo)[0]!.run!.model, tasksOf(repo)[0]!.run!.modelPicked], ['sonnet', true]);

  // Another pick replaces it.
  acc(again.json().worktree, ['done', ...NOTE], { ...env, ACC_ROLE: 'builder', ACC_TASK: 'T-1' });
  acc(repo, ['set', 'T-1', 'rework', '--reason', 'and a heading']);
  assert.equal(acc(repo, ['dispatch', 'T-1', '--model', 'claude-fable-5-1'], env).code, 0);
  assert.equal(modelOfLaunch(claude.calls().filter((c) => c.args[0] === '--bg')[2]!.args), 'claude-fable-5-1');
  assert.equal(tasksOf(repo)[0]!.run!.model, 'claude-fable-5-1');
});

test('a task nobody picked a model for follows the clone\'s choice as it is at each re-dispatch (D-086)', () => {
  const repo = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify({ ...GENERIC_CONFIG, ...QUIET, agents: { builder: { model: 'opus' } } }), ...IGNORE }));
  const claude = fakeClaude();
  const env = { PATH: `${claude.bin}:${process.env.PATH}`, HOME: trustingHome(repo) };
  acc(repo, ['add', 'Write the changelog']);
  const r = acc(repo, ['dispatch', 'T-1', '--json'], env);
  assert.equal(modelOfLaunch(claude.calls().filter((c) => c.args[0] === '--bg')[0]!.args), 'opus', 'the project\'s');
  assert.equal(tasksOf(repo)[0]!.run!.model, 'opus');
  acc(r.json().worktree, ['done', ...NOTE], { ...env, ACC_ROLE: 'builder', ACC_TASK: 'T-1' });
  acc(repo, ['set', 'T-1', 'rework', '--reason', 'needs a date']);
  gitIn(repo, 'config', 'acc.builder.model', 'haiku');
  assert.equal(acc(repo, ['dispatch', 'T-1'], env).code, 0);
  assert.equal(modelOfLaunch(claude.calls().filter((c) => c.args[0] === '--bg')[1]!.args), 'haiku', 'the clone\'s, chosen since');
  const run = tasksOf(repo)[0]!.run!;
  assert.equal(run.model, 'haiku');
  assert.ok(!('modelPicked' in run));
});

test('dispatch refuses a model that isn\'t a model name before it makes a worktree (D-086)', () => {
  const repo = makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG), ...IGNORE });
  const claude = fakeClaude();
  acc(repo, ['add', 'Work']);
  const r = acc(repo, ['dispatch', 'T-1', '--model', 'two words'], { PATH: `${claude.bin}:${process.env.PATH}`, HOME: trustingHome(repo) });
  assert.equal(r.code, 2, 'a usage error');
  assert.match(r.err, /"two words" isn't a model name/);
  assert.equal(existsSync(join(repo, '.claude', 'worktrees', 'T-1')), false, 'no worktree was made');
  assert.equal(claude.calls().length, 0);
  assert.equal(tasksOf(repo)[0]!.state, 'todo');
});

const effortOfLaunch = (args: string[]) => (args.includes('--effort') ? args[args.indexOf('--effort') + 1] : null);

test('an effort picked for a task reaches claude --bg over the project\'s and the clone\'s, and a rework keeps it (D-128)', () => {
  const repo = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify({ ...GENERIC_CONFIG, ...QUIET, agents: { builder: { effort: 'low' } } }), ...IGNORE }));
  gitIn(repo, 'config', 'acc.builder.effort', 'medium');
  const claude = fakeClaude();
  const env = { PATH: `${claude.bin}:${process.env.PATH}`, HOME: trustingHome(repo) };
  acc(repo, ['add', 'Write the changelog']);
  const r = acc(repo, ['dispatch', 'T-1', '--effort', 'xhigh', '--json'], env);
  assert.equal(r.code, 0, r.err);
  const launches = () => claude.calls().filter((c) => c.args[0] === '--bg');
  assert.deepEqual([modelOfLaunch(launches()[0]!.args), effortOfLaunch(launches()[0]!.args)], ['claude-opus-5-5', 'xhigh']);
  assert.equal(launches()[0]!.args.filter((a) => a === '--effort').length, 1);
  assert.deepEqual([tasksOf(repo)[0]!.run!.effort, tasksOf(repo)[0]!.run!.effortPicked], ['xhigh', true]);
  assert.ok(!('modelPicked' in tasksOf(repo)[0]!.run!), 'an effort alone picks no model');

  // Sent back for rework, it's re-dispatched with no --effort, as autopilot does: the pick stays.
  const wt = r.json().worktree;
  acc(wt, ['done', ...NOTE], { ...env, ACC_ROLE: 'builder', ACC_TASK: 'T-1' });
  assert.equal(acc(repo, ['set', 'T-1', 'rework', '--reason', 'needs a date']).code, 0);
  const again = acc(repo, ['dispatch', 'T-1'], env);
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /effort: {3}xhigh \(picked for this task\)\n/);
  assert.equal(effortOfLaunch(launches()[1]!.args), 'xhigh');
  assert.deepEqual([tasksOf(repo)[0]!.run!.effort, tasksOf(repo)[0]!.run!.effortPicked], ['xhigh', true]);

  // A model picked later, with another effort, replaces it.
  acc(wt, ['done', ...NOTE], { ...env, ACC_ROLE: 'builder', ACC_TASK: 'T-1' });
  acc(repo, ['set', 'T-1', 'rework', '--reason', 'and a heading']);
  assert.equal(acc(repo, ['dispatch', 'T-1', '--model', 'claude-sonnet-5-5', '--effort', 'high'], env).code, 0);
  assert.deepEqual([modelOfLaunch(launches()[2]!.args), effortOfLaunch(launches()[2]!.args)], ['claude-sonnet-5-5', 'high']);
  assert.equal(tasksOf(repo)[0]!.run!.effort, 'high');
});

test('a task nobody picked an effort for follows the clone\'s, records it, and names none when nothing is set (D-128)', () => {
  const repo = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify({ ...GENERIC_CONFIG, ...QUIET }), ...IGNORE }));
  const claude = fakeClaude();
  const env = { PATH: `${claude.bin}:${process.env.PATH}`, HOME: trustingHome(repo) };
  acc(repo, ['add', 'Write the changelog']);
  const r = acc(repo, ['dispatch', 'T-1'], env);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /effort: {3}the model's default\n/);
  assert.equal(effortOfLaunch(claude.calls().find((c) => c.args[0] === '--bg')!.args), null, 'Claude Code\'s default');
  assert.ok(!('effort' in tasksOf(repo)[0]!.run!) && !('effortPicked' in tasksOf(repo)[0]!.run!));
  acc(join(repo, '.claude', 'worktrees', 'T-1'), ['done', ...NOTE], { ...env, ACC_ROLE: 'builder', ACC_TASK: 'T-1' });
  acc(repo, ['set', 'T-1', 'rework', '--reason', 'needs a date']);
  gitIn(repo, 'config', 'acc.builder.effort', 'high');
  assert.equal(acc(repo, ['dispatch', 'T-1'], env).code, 0);
  assert.equal(effortOfLaunch(claude.calls().filter((c) => c.args[0] === '--bg')[1]!.args), 'high', 'the clone\'s, chosen since');
  assert.deepEqual([tasksOf(repo)[0]!.run!.effort, tasksOf(repo)[0]!.run!.effortPicked], ['high', undefined]);
});

test('dispatch refuses a level the model doesn\'t take, in words, with the levels it does and where acc\'s list came from, before anything starts (D-128)', () => {
  const repo = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG), ...IGNORE }));
  const claude = fakeClaude();
  const env = { PATH: `${claude.bin}:${process.env.PATH}`, HOME: trustingHome(repo) };
  acc(repo, ['add', 'Work']);
  // Claude Opus 4.6 takes max but not xhigh.
  const r = acc(repo, ['dispatch', 'T-1', '--model', 'claude-opus-4-6', '--effort', 'xhigh'], env);
  assert.equal(r.code, 2, 'a usage error');
  assert.match(r.err, /claude-opus-4-6 doesn't take effort xhigh\. It takes low, medium, high, max\./);
  assert.match(r.err, /from https:\/\/platform\.claude\.com\/docs\/en\/build-with-claude\/effort, read 2026-10-09/);
  // Claude Haiku 4.5 takes none: the effort picked meets the model this clone names.
  gitIn(repo, 'config', 'acc.builder.model', 'claude-haiku-4-5-20251001');
  assert.match(acc(repo, ['dispatch', 'T-1', '--effort', 'low'], env).err, /claude-haiku-4-5-20251001 doesn't take effort low\. It takes no effort level/);
  assert.match(acc(repo, ['dispatch', 'T-1', '--effort', 'huge'], env).err, /"huge" isn't an effort level\. Effort is one of low, medium, high, xhigh, max, or default for the builder's own\./);
  assert.equal(existsSync(join(repo, '.claude', 'worktrees', 'T-1')), false, 'no worktree was made');
  assert.equal(claude.calls().length, 0);
  assert.equal(tasksOf(repo)[0]!.state, 'todo');
  // A model acc doesn't know, such as an alias, isn't refused: Claude Code decides.
  gitIn(repo, 'config', '--unset', 'acc.builder.model');
  const alias = acc(repo, ['dispatch', 'T-1', '--model', 'opus', '--effort', 'xhigh'], env);
  assert.equal(alias.code, 0, alias.err);
});

test('an effort picked for a task can be cleared: --effort default drops it, and a model picked that doesn\'t take it drops it and says so (D-128)', () => {
  const repo = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify({ ...GENERIC_CONFIG, ...QUIET }), ...IGNORE }));
  const claude = fakeClaude();
  const env = { PATH: `${claude.bin}:${process.env.PATH}`, HOME: trustingHome(repo) };
  const launches = () => claude.calls().filter((c) => c.args[0] === '--bg');
  const rework = (why: string) => {
    acc(join(repo, '.claude', 'worktrees', 'T-1'), ['done', ...NOTE], { ...env, ACC_ROLE: 'builder', ACC_TASK: 'T-1' });
    assert.equal(acc(repo, ['set', 'T-1', 'rework', '--reason', why]).code, 0);
  };
  acc(repo, ['add', 'Write the changelog']);
  assert.equal(acc(repo, ['dispatch', 'T-1', '--effort', 'xhigh'], env).code, 0);

  // Claude Haiku 4.5 takes no level: picking it drops the task's xhigh, says so, and names no effort.
  rework('needs a date');
  const haiku = acc(repo, ['dispatch', 'T-1', '--model', 'claude-haiku-4-5-20251001'], env);
  assert.equal(haiku.code, 0, haiku.err);
  assert.match(haiku.out, /Its effort xhigh, picked for it before, was dropped: claude-haiku-4-5-20251001 doesn't take it\. The builder's own applies\./);
  assert.match(haiku.out, /effort: {3}the model's default\n/);
  assert.equal(effortOfLaunch(launches()[1]!.args), null);
  assert.deepEqual([tasksOf(repo)[0]!.run!.effort, tasksOf(repo)[0]!.run!.effortPicked, tasksOf(repo)[0]!.run!.modelPicked], [undefined, undefined, true]);

  // Picked again on another model, then dropped by hand: the clone's effort applies, and the model stays picked.
  rework('and a heading');
  assert.equal(acc(repo, ['dispatch', 'T-1', '--model', 'claude-opus-5-5', '--effort', 'max'], env).code, 0);
  assert.equal(effortOfLaunch(launches()[2]!.args), 'max');
  rework('shorter');
  gitIn(repo, 'config', 'acc.builder.effort', 'low');
  const cleared = acc(repo, ['dispatch', 'T-1', '--effort', 'default'], env);
  assert.equal(cleared.code, 0, cleared.err);
  assert.doesNotMatch(cleared.out, /was dropped/, 'asked for, so not news');
  assert.match(cleared.out, /effort: {3}low\n/);
  assert.equal(effortOfLaunch(launches()[3]!.args), 'low');
  assert.deepEqual([tasksOf(repo)[0]!.run!.effort, tasksOf(repo)[0]!.run!.effortPicked, tasksOf(repo)[0]!.run!.model], ['low', undefined, 'claude-opus-5-5']);
  // A later re-dispatch follows the clone, as a task never picked for does.
  rework('once more');
  gitIn(repo, 'config', 'acc.builder.effort', 'high');
  assert.equal(acc(repo, ['dispatch', 'T-1'], env).code, 0);
  assert.equal(effortOfLaunch(launches()[4]!.args), 'high');
});

test('every dispatch checks the model and effort pair, not only one that picks either: a pick meeting a changed clone model is refused in acc\'s words (D-128)', () => {
  const repo = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify({ ...GENERIC_CONFIG, ...QUIET }), ...IGNORE }));
  const claude = fakeClaude();
  const env = { PATH: `${claude.bin}:${process.env.PATH}`, HOME: trustingHome(repo) };
  acc(repo, ['add', 'Write the changelog']);
  assert.equal(acc(repo, ['dispatch', 'T-1', '--effort', 'xhigh'], env).code, 0);
  acc(join(repo, '.claude', 'worktrees', 'T-1'), ['done', ...NOTE], { ...env, ACC_ROLE: 'builder', ACC_TASK: 'T-1' });
  acc(repo, ['set', 'T-1', 'rework', '--reason', 'needs a date']);
  // This clone's builder model changes to one that takes max but not xhigh; the re-dispatch names neither.
  gitIn(repo, 'config', 'acc.builder.model', 'claude-opus-4-6');
  const r = acc(repo, ['dispatch', 'T-1'], env);
  assert.equal(r.code, 2, 'a usage error');
  assert.match(r.err, /claude-opus-4-6 doesn't take effort xhigh\. It takes low, medium, high, max\. It was picked for T-1: pick another with acc dispatch T-1 --effort <level>, or drop it with acc dispatch T-1 --effort default\./);
  assert.match(r.err, /from https:\/\/platform\.claude\.com\/docs\/en\/build-with-claude\/effort, read 2026-10-09/);
  assert.equal(claude.calls().filter((c) => c.args[0] === '--bg').length, 1, 'nothing more started');
  assert.equal(tasksOf(repo)[0]!.state, 'rework');
  // The builder's own effort meeting the clone's model says where that's set.
  acc(repo, ['add', 'Second']);
  gitIn(repo, 'config', 'acc.builder.effort', 'xhigh');
  assert.match(acc(repo, ['dispatch', 'T-2'], env).err, /claude-opus-4-6 doesn't take effort xhigh\. It takes low, medium, high, max\. It's the builder's own: pick one for T-2 with acc dispatch T-2 --effort <level>, or clear it with acc agents set builder --clear effort\./);
  assert.equal(existsSync(join(repo, '.claude', 'worktrees', 'T-2')), false, 'no worktree was made');
  // As the refusal says, the task's pick is dropped, and it starts.
  gitIn(repo, 'config', '--unset', 'acc.builder.effort');
  const dropped = acc(repo, ['dispatch', 'T-1', '--effort', 'default'], env);
  assert.equal(dropped.code, 0, dropped.err);
  assert.equal(effortOfLaunch(claude.calls().filter((c) => c.args[0] === '--bg')[1]!.args), null);
});

test('a builder can\'t close the issues of tasks already done: its settings deny acc sync --close-done, as guardBash and the CLI refuse it (D-082)', () => {
  const s = builderSettings({ id: 'GH-9' } as never, parseConfig(GENERIC_CONFIG).config!, '/acc/bin', '/usr/bin') as { permissions: { allow: string[]; deny: string[] } };
  assert.ok(s.permissions.deny.includes('Bash(acc sync --close-done*)'));
  assert.ok(!s.permissions.allow.some((a) => a.startsWith('Bash(acc sync')), 'nor is a plain sync pre-approved');
});
