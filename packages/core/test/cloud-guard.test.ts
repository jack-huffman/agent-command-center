// The cloud push guard (GH-69): the script a repo that opted in commits, run as Claude Code runs it in a
// cloud session, with the input on stdin and the decision on stdout. It allows a cloud builder to push
// its own task branch, plainly, by the record acc put in the fire's text, and refuses everything else
// that could push, a write under .claude/, and the git commands that could change the guard. It fails
// closed; outside a cloud session it says nothing.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { GUARD_COMMAND, GUARD_MATCHER, GUARD_PATH, GUARD_SCRIPT, guardCommitted, guardInstalled, installGuard, RECORD_LINE, SETTINGS_PATH, settingsRunGuard } from '../src/cloud-guard.ts';
import { run } from '../src/exec.ts';
import { commandsOf } from '../src/hooks.ts';
import { gitIn, tempDir } from './support.ts';

const BRANCH = 'task/T-1-a-thing';

/** A transcript as Claude Code writes one: the fire's text in the first user message, then the session's turns. */
function transcript(dir: string, firstText: string | null, later: string[] = []): string {
  const file = join(dir, 'session.jsonl');
  const lines = [
    JSON.stringify({ type: 'summary', summary: 'x' }),
    ...(firstText === null ? [] : [JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: firstText }] } })]),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: `I will. ${RECORD_LINE}: main` }] } }),
    ...later.map((t) => JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: t }, { type: 'text', text: t }] } })),
  ];
  writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

const fired = (branch = BRANCH) => `<routine-fire-payload>\n${RECORD_LINE}: ${branch}\n\n# Cloud builder for T-1\n</routine-fire-payload>`;

/** A repo with the guard written and committed as acc cloud enable writes it, on main, with the task branch and two others to merge. */
function repo(): { root: string; transcript: string } {
  const root = tempDir('guard-');
  const git = (...a: string[]) => gitIn(root, ...a);
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 't');
  git('config', 'user.email', 't@example.com');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(root, 'README.md'), '# r\n');
  installGuard(root);
  git('add', '-A');
  git('commit', '-q', '-m', 'initial, with the guard');
  // A branch that changes the guard, and one that doesn't.
  git('switch', '-q', '-c', 'touches-guard');
  writeFileSync(join(root, GUARD_PATH), '// not the guard\n');
  git('commit', '-q', '-am', 'weaken the guard');
  git('switch', '-q', 'main');
  git('switch', '-q', '-c', 'clean');
  writeFileSync(join(root, 'README.md'), '# r\nmore\n');
  git('commit', '-q', '-am', 'readme');
  git('switch', '-q', 'main');
  git('switch', '-q', '-c', BRANCH);
  return { root, transcript: transcript(tempDir('transcript-'), fired()) };
}

interface Hook { code: number | null; reason: string | null; out: string; err: string }

/** Runs the guard as Claude Code does: the hook's input on stdin, the project dir in the environment, in or out of a cloud session. */
function hook(root: string, input: unknown, opts: { cloud?: boolean; env?: NodeJS.ProcessEnv } = {}): Hook {
  const r = spawnSync(process.execPath, [join(root, GUARD_PATH)], {
    cwd: root, input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8',
    env: { ...process.env, ...opts.env, CLAUDE_PROJECT_DIR: root, CLAUDE_CODE_REMOTE: opts.cloud === false ? '' : 'true', CLAUDE_CODE_REMOTE_SESSION_ID: opts.cloud === false ? '' : 'cse_01TEST' },
  });
  let reason: string | null = null;
  try {
    reason = (JSON.parse(r.stdout) as { hookSpecificOutput?: { permissionDecisionReason?: string } }).hookSpecificOutput?.permissionDecisionReason ?? null;
  } catch {
    reason = null;
  }
  return { code: r.status, reason, out: r.stdout, err: r.stderr };
}

const bash = (root: string, transcript: string | null, command: string, opts?: { cloud?: boolean; env?: NodeJS.ProcessEnv }): Hook => hook(root, { tool_name: 'Bash', tool_input: { command }, cwd: root, ...(transcript ? { transcript_path: transcript } : {}) }, opts);

/** The guard's own functions, from the committed script, for the long lists: the same text the hook runs. */
async function guardModule(root: string): Promise<{ guard: (line: string, record: string | null, ctx: { cwd: string; projectDir: string; transcript: string | null }) => string | null; recordOf: (t: string) => string | null; fileProblem: (input: unknown, ctx: { cwd: string; projectDir: string; transcript: string | null }) => string | null; commandsOf: (line: string) => string[][] }> {
  return import(pathToFileURL(join(root, GUARD_PATH)).href) as never;
}

test('in a cloud session, the guard allows a plain push of the recorded branch alone, in its two forms, and refuses every other form that could push', async () => {
  const { root, transcript } = repo();
  const g = await guardModule(root);
  const ctx = { cwd: root, projectDir: root, transcript };
  // End to end, as Claude Code runs it: the two allowed forms, with -u or --set-upstream, exit 0 with no decision.
  for (const c of [`git push origin ${BRANCH}`, `git push origin HEAD:${BRANCH}`, `git push -u origin ${BRANCH}`, `git push --set-upstream origin HEAD:${BRANCH}`, `git fetch origin ${BRANCH} && git checkout ${BRANCH}`, 'npm test', `git status && git push origin ${BRANCH}`]) {
    const r = bash(root, transcript, c);
    assert.equal(r.code, 0, `${c}: exits 0 (${r.err})`);
    assert.equal(r.out, '', `${c}: allowed, with nothing said`);
  }
  const allowed = [
    'git commit -m "x: git push later"', 'gh pr view 3', 'git checkout -- a.txt', 'git config user.name "Acme Bot"', 'git config --get alias.co', 'gh api repos/o/r/pulls/3', 'gh api -H "Accept: x" repos/o/r/pulls/3',
    'gh api graphql -f query="query { viewer { login } }"', 'nice -n 15 npm run check', 'timeout 600 npm test', 'cat .claude/settings.json', `git diff HEAD -- ${GUARD_PATH}`, `sh -c "git push origin ${BRANCH}"`,
    'node scripts/near-tests.mjs', 'git remote -v', 'git merge --abort', 'git reset HEAD~1', 'git restore a.txt', 'curl -s https://api.github.com/repos/o/r', 'ls .claude/hooks', 'git log --oneline -5', 'git merge clean', 'git rebase clean', 'git --version', 'git', 'ls', 'echo done',
  ];
  for (const c of allowed) assert.equal(g.guard(c, BRANCH, ctx), null, `${c}: allowed`);
  const refused: [string, RegExp][] = [
    // a bare push, and pushes elsewhere or with force
    ['git push', /bare git push could go anywhere/],
    ['git push origin main', /never push main/],
    ['git push origin HEAD:main', /never push main/],
    [`git push origin ${BRANCH}:main`, /never push main/],
    ['git push origin task/T-2-other', /not task\/T-2-other/],
    [`git push origin ${BRANCH} main`, /never push main/],
    [`git push --force origin ${BRANCH}`, /Never force-push \(--force\)/],
    ['git push -f', /Never force-push \(-f\)/],
    [`git push -fu origin ${BRANCH}`, /Never force-push/],
    [`git push --force-with-lease origin ${BRANCH}`, /force-push/],
    [`git push origin +${BRANCH}`, /force-push/],
    [`git push origin :${BRANCH}`, /delete a branch/],
    [`git push --delete origin ${BRANCH}`, /delete a branch/],
    ['git push --all', /push everything/],
    ['git push --mirror', /push everything/],
    ['git push --tags', /push tags/],
    [`git push upstream ${BRANCH}`, /origin only, not upstream/],
    [`git push origin ${BRANCH} --no-verify`, /push with --no-verify/],
    [`git push origin ${BRANCH} -u`, /push with -u/],
    // git's global options before the subcommand
    [`git -C ../x push origin ${BRANCH}`, /without -C/],
    ['git -c alias.p=push p', /Never set alias\.p/],
    ['git -c push.default=upstream push', /Never set push\.default/],
    [`git --git-dir=.git push origin ${BRANCH}`, /without --git-dir/],
    [`git --work-tree=. push origin ${BRANCH}`, /without --work-tree/],
    [`git --no-pager push origin ${BRANCH}`, /Push plainly, as its own command/],
    [`git -c user.name=x push origin ${BRANCH}`, /Push plainly, as its own command/],
    // a path to git
    [`/usr/bin/git push origin ${BRANCH}`, /Push plainly, as its own command/],
    [`./git push origin ${BRANCH}`, /Push plainly, as its own command/],
    // wrappers
    [`timeout 10 git push origin ${BRANCH}`, /Push plainly/],
    [`timeout -s KILL 10 git push origin ${BRANCH}`, /Push plainly/],
    [`env -i git push origin ${BRANCH}`, /Push plainly/],
    [`env GIT_TRACE=1 git push origin ${BRANCH}`, /Push plainly/],
    [`nohup git push origin ${BRANCH}`, /Push plainly/],
    [`nice -n 15 git push origin ${BRANCH}`, /Push plainly/],
    [`echo origin ${BRANCH} | xargs git push`, /Push plainly/],
    [`xargs -I{} git push origin {}`, /Push plainly/],
    ['eval "git push origin main"', /Push plainly/],
    [`eval git push origin ${BRANCH}`, /Push plainly/],
    [`exec git push origin ${BRANCH}`, /Push plainly/],
    ['nice -n 15 git push origin main', /never push main/],
    // shells: -c lines are guarded, script files and bare shells refused
    ['sh -c "git push origin main"', /never push main/],
    ['bash -lc "git push origin main"', /never push main/],
    ['zsh -c "cd x; git push origin main"', /never push main/],
    ['bash -c "sh -c \'git push origin main\'"', /never push main/],
    ['bash push.sh', /Never run a script file with bash/],
    ['sh ./deploy.sh', /Never run a script file with sh/],
    ['./push.sh', /Never run a script file \(push\.sh\)/],
    ['source x.sh', /Never run a script file \(source\)/],
    ['. x.sh', /Never run a script file \(source\)/],
    ['bash', /bare bash reads commands the guard can't see/],
    ['sh -c', /runs nothing/],
    // aliases and the settings that make them, remotes
    ['git config alias.p push', /Never set alias\.p/],
    ['git config --global alias.p "push origin main"', /Never set alias\.p/],
    ['git config push.default upstream', /Never set push\.default/],
    ['git config remote.origin.url https://x', /Never set remote\.origin\.url/],
    ['git config url.x.insteadOf y', /Never set url\.x\.insteadOf/],
    ['git config core.hooksPath .githooks', /Never set core\.hooksPath/],
    ['git config -e', /Never open the git config in an editor/],
    ['git remote set-url origin https://x', /Never change the remotes \(git remote set-url\)/],
    ['git remote add other https://x', /Never change the remotes \(git remote add\)/],
    ['git remote rename origin o', /Never change the remotes/],
    [`git send-pack origin ${BRANCH}`, /Push only with git push/],
    // gh api: writes, git/refs, mutations; gh pr merge
    ['gh api -X POST repos/o/r/pulls', /only reads here \(GET\), not POST/],
    ['gh api --method PUT repos/o/r/pulls/3/merge', /not PUT/],
    ['gh api --method=DELETE repos/o/r/git/refs/heads/main', /not DELETE/],
    ['gh api -XPATCH repos/o/r/git/refs/heads/main', /not PATCH/],
    ['gh api -f title=x repos/o/r/pulls', /with a field .* posts/],
    ['gh api -F title=x repos/o/r/pulls', /with a field .* posts/],
    ['gh api --input body.json repos/o/r/pulls', /with a field .* posts/],
    ['gh api repos/o/r/git/refs/heads/main', /Never touch git\/refs/],
    ['gh api repos/o/r/git/refs', /Never touch git\/refs/],
    ['gh api graphql -f query="mutation { mergePullRequest(input: {}) { pullRequest { id } } }"', /Never run a GraphQL mutation/],
    ['gh api graphql -f query=\'mutation($id: ID!) { x }\'', /Never run a GraphQL mutation/],
    ['gh pr merge 3', /Pull requests are a person's/],
    ['gh pr create --fill', /Pull requests are a person's/],
    ['gh pr close 3', /Pull requests are a person's/],
    // curl and wget to GitHub, writing
    ['curl -X POST https://api.github.com/repos/o/r/pulls', /Never write to GitHub with curl/],
    ['curl -d @body.json https://api.github.com/repos/o/r/pulls', /Never write to GitHub with curl/],
    ['wget --post-data=x https://api.github.com/repos/o/r/pulls', /Never write to GitHub with wget/],
    // a deploy
    ['sf project deploy start -o Dev', /never deploy/],
    // what hides a program or a push
    ['G=git; $G push origin main', /can't tell what \$G runs/],
    ['`git push origin main`', /never push main/],
    ['$(git push origin main)', /never push main/],
    ['node -e "require(\\"child_process\\").execSync(\\"git push origin main\\")"', /can't see what node -e does with git/],
    ['python3 -c "import subprocess; subprocess.run([\'git\',\'push\'])"', /can't see what python3 -c does with git/],
    // the checkout, and git commands that could change the guard
    ['git checkout main', /Stay on your task branch, task\/T-1-a-thing\. git checkout main would leave it/],
    ['git switch main', /Stay on your task branch/],
    ['git checkout origin/main', /Stay on your task branch/],
    ['git switch -c task/evil', /Make no new branch/],
    ['git checkout -b task/other', /Make no new branch/],
    ['git reset --hard HEAD~3', /Don't reset --hard/],
    ['git restore --source=main~5 .', /Don't restore from another commit/],
    ['git pull origin main', /Don't pull/],
    ['git worktree add ../x', /acc makes and removes worktrees/],
    ['git merge touches-guard', /git merge touches-guard would change the guard \(\.claude\/hooks\/acc-push-guard\.mjs\)/],
    ['git rebase touches-guard', /would change the guard/],
    ['git cherry-pick touches-guard', /git cherry-pick touches-guard would change the guard/],
    ['git revert HEAD', /The guard couldn't read HEAD to see whether git revert would change the guard|would change the guard/],
    ['git merge no-such-branch', /couldn't read no-such-branch/],
    // writes under .claude/ from Bash
    [`echo x > ${SETTINGS_PATH}`, /Nothing under \.claude\/ is changed from Bash/],
    ['rm -rf .claude/hooks', /Nothing under \.claude\/ is changed from Bash/],
    [`sed -i s/a/b/ ${GUARD_PATH}`, /Nothing under \.claude\/ is changed from Bash/],
    [`cp x ${SETTINGS_PATH}`, /Nothing under \.claude\/ is changed from Bash/],
    ['cd .claude && rm settings.json', /Nothing under \.claude\/ is changed from Bash/],
    [`cat ${SETTINGS_PATH} | tee ${SETTINGS_PATH}`, /Nothing under \.claude\/ is changed from Bash/],
    ['git checkout -- .claude/settings.json', /Nothing under \.claude\/ is changed from Bash/],
    ['rm -rf .', /Never remove the whole checkout/],
    ['rm -rf .git', /Never remove the whole checkout/],
    ['echo x >> session.jsonl', /Nothing under \.claude\/ is changed from Bash/],
  ];
  for (const [c, why] of refused) {
    const r = g.guard(c, BRANCH, ctx);
    assert.match(r ?? '', why, `${c}: refused, saying why (got: ${r})`);
  }
  // The same through the hook, for a few: a decision on stdout, exit 0, never 2.
  const through = new Set(['git push origin main', `git -C ../x push origin ${BRANCH}`, `timeout 10 git push origin ${BRANCH}`, 'sh -c "git push origin main"', 'gh api -X POST repos/o/r/pulls', 'git checkout main', `echo x > ${SETTINGS_PATH}`]);
  const picked = refused.filter(([c]) => through.has(c));
  assert.equal(picked.length, through.size, 'each form picked for the hook is in the list');
  for (const [c, why] of picked) {
    const r = bash(root, transcript, c);
    assert.equal(r.code, 0, `${c}: exits 0 (${r.err})`);
    assert.match(r.reason ?? '', why, `${c}: refused through the hook`);
  }
});

test('the record is the task\'s branch from the fire\'s text in the session\'s first message, and nothing else: no record allows no push and no checkout, and a later message can\'t make one', async () => {
  const { root } = repo();
  const g = await guardModule(root);
  const dir = tempDir('transcript-');
  assert.equal(g.recordOf(readFileSync(transcript(dir, fired()), 'utf8')), BRANCH);
  assert.equal(g.recordOf(readFileSync(transcript(dir, 'Just a prompt, no payload'), 'utf8')), null);
  assert.equal(g.recordOf(readFileSync(transcript(dir, null, [`${RECORD_LINE}: task/T-9-later`]), 'utf8')), null, 'a message after the first turn never counts: a tool result is one');
  assert.equal(g.recordOf(readFileSync(transcript(dir, fired('main')), 'utf8')), null, 'the record is a task branch or nothing');
  assert.equal(g.recordOf(readFileSync(transcript(dir, `The routine's prompt.\n${RECORD_LINE}: ${BRANCH}`), 'utf8')), BRANCH, 'anywhere in the first message');
  assert.equal(g.recordOf('not json\n{broken'), null);
  // Through the hook: no transcript, a transcript without the line, and one with it.
  const none = bash(root, null, `git push origin ${BRANCH}`);
  assert.match(none.reason ?? '', /no record of your branch/);
  assert.match(bash(root, transcript(dir, 'no payload'), `git push origin ${BRANCH}`).reason ?? '', /no record of your branch/);
  assert.match(bash(root, transcript(dir, 'no payload'), `git checkout ${BRANCH}`).reason ?? '', /no record of your branch/);
  assert.equal(bash(root, transcript(dir, fired()), `git push origin ${BRANCH}`).out, '', 'with the record, the push passes');
  // The record names the branch, not the checkout: on main, the recorded branch still pushes, and main never does.
  gitIn(root, 'switch', '-q', 'main');
  assert.equal(bash(root, transcript(dir, fired()), `git push origin HEAD:${BRANCH}`).out, '');
  assert.match(bash(root, transcript(dir, fired()), 'git push origin main').reason ?? '', /never push main/);
});

test('it fails closed: junk on stdin, no tool, a Bash call with no command, and an error of its own block the call with exit 2; a tool it doesn\'t guard passes; outside a cloud session it says nothing', () => {
  const { root, transcript } = repo();
  const junk = hook(root, 'not json');
  assert.equal(junk.code, 2);
  assert.match(junk.err, /input wasn't JSON/);
  assert.equal(junk.out, '');
  assert.equal(hook(root, { tool_input: { command: 'git push origin main' } }).code, 2, 'no tool named');
  const noCommand = hook(root, { tool_name: 'Bash', tool_input: {}, cwd: root });
  assert.equal(noCommand.code, 2);
  assert.match(noCommand.err, /no command string/);
  // An error of its own: git isn't there to answer whether a command is an alias.
  const broken = bash(root, transcript, 'git status', { env: { PATH: '/nonexistent' } });
  assert.equal(broken.code, 2, `exit 2 (${broken.err})`);
  assert.match(broken.err, /error of its own/);
  // A tool it doesn't guard, and a cloud session's ordinary commands, pass with nothing said.
  assert.deepEqual([hook(root, { tool_name: 'Read', tool_input: { file_path: SETTINGS_PATH }, cwd: root }).code, hook(root, { tool_name: 'Read', tool_input: { file_path: SETTINGS_PATH }, cwd: root }).out], [0, '']);
  assert.deepEqual([bash(root, transcript, 'npm test').code, bash(root, transcript, 'npm test').out], [0, '']);
  // Outside a cloud session: nothing, whatever the command.
  for (const c of ['git push origin main', 'rm -rf .claude']) {
    const r = bash(root, transcript, c, { cloud: false });
    assert.deepEqual([r.code, r.out], [0, ''], `${c}: outside the cloud, nothing`);
  }
  assert.equal(hook(root, 'not json', { cloud: false }).code, 0, 'outside the cloud, junk is nobody\'s business');
  // Either of the two cloud marks is enough: the documented session id alone, or the flag alone.
  assert.match(bash(root, transcript, 'git push origin main', { env: { CLAUDE_CODE_REMOTE: '', CLAUDE_CODE_REMOTE_SESSION_ID: 'cse_01X' } }).reason ?? '', /never push main/);
  assert.match(bash(root, transcript, 'git push origin main', { env: { CLAUDE_CODE_REMOTE: 'true', CLAUDE_CODE_REMOTE_SESSION_ID: '' } }).reason ?? '', /never push main/);
});

test('an Edit, Write, MultiEdit or NotebookEdit under .claude/hooks/, of .claude/settings.json or of the transcript is refused; another file, even under .claude/, passes', async () => {
  const { root, transcript } = repo();
  const g = await guardModule(root);
  const ctx = { cwd: root, projectDir: root, transcript };
  for (const tool of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']) {
    const key = tool === 'NotebookEdit' ? 'notebook_path' : 'file_path';
    for (const path of [SETTINGS_PATH, GUARD_PATH, '.claude/hooks/other.mjs', join(root, SETTINGS_PATH), transcript]) {
      const r = hook(root, { tool_name: tool, tool_input: { [key]: path }, cwd: root, transcript_path: transcript });
      assert.equal(r.code, 0);
      assert.match(r.reason ?? '', /a cloud builder never changes it|transcript isn't yours/, `${tool} ${path}: refused`);
    }
    assert.equal(hook(root, { tool_name: tool, tool_input: { [key]: 'src/a.ts' }, cwd: root, transcript_path: transcript }).out, '', `${tool} src/a.ts: passes`);
    assert.equal(hook(root, { tool_name: tool, tool_input: { [key]: '.claude/rules/x.md' }, cwd: root }).out, '', `${tool} .claude/rules/x.md: passes`);
    assert.match(hook(root, { tool_name: tool, tool_input: {}, cwd: root }).reason ?? '', /couldn't see which file/, `${tool} with no path: refused`);
  }
  // From a subfolder, the path is still the project's.
  mkdirSync(join(root, 'sub'), { recursive: true });
  assert.match(g.fileProblem({ file_path: `../${SETTINGS_PATH}` }, { ...ctx, cwd: join(root, 'sub') }) ?? '', /never changes it/);
  assert.equal(g.fileProblem({ file_path: '../src/a.ts' }, { ...ctx, cwd: join(root, 'sub') }), null);
});

test('the guard\'s command splitter and acc\'s hooks.ts commandsOf give the same words for the same lines', async () => {
  const { root } = repo();
  const g = await guardModule(root);
  const cases = [
    'git push origin main', 'nice -n 15 git push origin main', 'sudo git push', 'env FOO=1 git status', 'A=1 B=2 npm test', 'git add . ; git push origin main', 'a && b || c | d',
    'echo "a b" \'c d\' e\\ f', 'git commit -m "say \\"hi\\""', 'x\ny', '(cd a && git push)', '`git push origin main`', '$(git push)', 'npx acc done --landed "x"', 'time npm test', 'command git push', '',
    'git commit -m \'it\'"\'"\'s\'', 'FOO="a b" git status', 'nice -5 git push', 'nice git push', 'acc done --landed "a; b" --open none',
  ];
  for (const c of cases) assert.deepEqual(g.commandsOf(c), commandsOf(c), JSON.stringify(c));
  assert.equal(cases.length, 22, 'every case ran');
});

test('installGuard writes the script and a PreToolUse hook on every tool it guards, from the project root, keeps other settings, replaces an older entry of its own, and writes again only when something changed', () => {
  const root = tempDir('guard-install-');
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(join(root, SETTINGS_PATH), JSON.stringify({ permissions: { allow: ['Bash(npm test)'] }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo bye' }] }], PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node .claude/hooks/acc-push-guard.mjs', timeout: 10 }] }] } }));
  assert.equal(guardInstalled(root), false);
  const first = installGuard(root);
  assert.deepEqual(first.written.sort(), [GUARD_PATH, SETTINGS_PATH].sort());
  assert.ok(existsSync(join(root, GUARD_PATH)));
  assert.equal(readFileSync(join(root, GUARD_PATH), 'utf8'), GUARD_SCRIPT);
  const settings = JSON.parse(readFileSync(join(root, SETTINGS_PATH), 'utf8'));
  assert.deepEqual(settings.permissions, { allow: ['Bash(npm test)'] }, 'other settings are kept');
  assert.equal(settings.hooks.Stop[0].hooks[0].command, 'echo bye', 'other hooks are kept');
  assert.deepEqual(settings.hooks.PreToolUse, [{ matcher: GUARD_MATCHER, hooks: [{ type: 'command', command: GUARD_COMMAND, timeout: 20 }] }], 'the older entry is replaced by the new one');
  assert.equal(GUARD_COMMAND, 'node "$CLAUDE_PROJECT_DIR"/.claude/hooks/acc-push-guard.mjs', 'the path is from the project root Claude Code gives the hook, so a cd can\'t make it fail to load');
  assert.equal(GUARD_MATCHER, 'Bash|Edit|Write|MultiEdit|NotebookEdit');
  assert.equal(guardInstalled(root), true);
  assert.deepEqual(installGuard(root).written, [], 'nothing to write again');
  // A script someone changed is written again, so the committed guard is always acc's; so is a settings file whose entry is gone.
  writeFileSync(join(root, GUARD_PATH), '// changed\n');
  assert.deepEqual(installGuard(root).written, [GUARD_PATH]);
  assert.equal(settingsRunGuard(JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: GUARD_COMMAND }] }] } })), false, 'an entry on Bash alone doesn\'t guard the edits');
  assert.equal(settingsRunGuard('not json'), false);
});

test('guardCommitted reads a commit\'s tree, never the files on disk: the guard uncommitted, older, or without its hook entry says no, with the fix', () => {
  const root = tempDir('guard-commit-');
  const git = (...a: string[]) => gitIn(root, ...a);
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 't');
  git('config', 'user.email', 't@example.com');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(root, 'README.md'), '# r\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'initial');
  const at = (ref: string) => guardCommitted(run, root, ref);
  assert.equal(at('HEAD').ok, false);
  assert.match(at('HEAD').why ?? '', /HEAD doesn't carry \.claude\/hooks\/acc-push-guard\.mjs: run acc cloud enable, commit/);
  installGuard(root);
  assert.equal(at('HEAD').ok, false, 'written, not committed: the cloud would never see it');
  assert.equal(guardInstalled(root), true, 'the files on disk say otherwise, which is why dispatch doesn\'t ask them');
  git('add', '-A');
  git('commit', '-q', '-m', 'guard');
  assert.deepEqual(at('HEAD'), { ok: true, why: null });
  assert.deepEqual(at('main'), { ok: true, why: null });
  // An older guard on a branch: the cloud would run a weaker one.
  git('switch', '-q', '-c', 'old');
  writeFileSync(join(root, GUARD_PATH), '// an older guard\n');
  git('commit', '-q', '-am', 'older');
  assert.match(at('old').why ?? '', /old carries an older \.claude\/hooks\/acc-push-guard\.mjs than this acc writes/);
  assert.equal(at('main').ok, true, 'main still has the current one');
  // The settings without the entry.
  writeFileSync(join(root, GUARD_PATH), GUARD_SCRIPT);
  writeFileSync(join(root, SETTINGS_PATH), JSON.stringify({ hooks: {} }));
  git('commit', '-q', '-am', 'no entry');
  assert.match(at('old').why ?? '', /\.claude\/settings\.json on old doesn't run the guard on Bash\|Edit\|Write\|MultiEdit\|NotebookEdit/);
  assert.match(at('nope').why ?? '', /nope doesn't carry/);
});

test('this repo commits the guard, so the real run on it is guarded (GH-69)', () => {
  const repoRoot = join(import.meta.dirname, '..', '..', '..');
  assert.equal(guardInstalled(repoRoot), true, `${GUARD_PATH} and its hook in ${SETTINGS_PATH} are in the tree`);
  assert.equal(readFileSync(join(repoRoot, GUARD_PATH), 'utf8'), GUARD_SCRIPT, 'the committed script is the current one');
  assert.deepEqual(guardCommitted(run, repoRoot, 'HEAD'), { ok: true, why: null }, 'and HEAD carries both, as a cloud session would see them');
});
