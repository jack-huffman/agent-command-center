// The cloud push guard (GH-69): the script a repo that opted in commits, run as Claude Code runs it in a
// cloud session, with the input on stdin and the decision on stdout, and the git pre-push hook it installs
// into the clone. The script allows a cloud builder to push its own task branch, plainly, by the record acc
// put in the fire's text, and refuses everything else that could push, a write under .claude/ or .git/, and
// the git commands that could change the guard or switch its hooks off; the pre-push hook checks the push
// itself, whatever ran git. Both fail closed; outside a cloud session the script says nothing.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { GUARD_COMMAND, GUARD_MATCHER, GUARD_PATH, GUARD_SCRIPT, guardCommitted, guardInstalled, installGuard, PRE_PUSH_PATH, PRE_PUSH_SCRIPT, RECORD_LINE, SESSION_COMMAND, SETTINGS_PATH, settingsRunGuard } from '../src/cloud-guard.ts';
import { run } from '../src/exec.ts';
import { commandsOf, SUBSTITUTED } from '../src/hooks.ts';
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

/** A repo with the guard written and committed as acc cloud enable writes it, on main, with the task branch, two others to merge, a patch of each, and symlinks to .git and .claude. */
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
  // A patch of each, as git apply, git am or patch would read them; symlinks a builder might make first.
  writeFileSync(join(root, 'weak.patch'), run('git', ['diff', 'main', 'touches-guard'], { cwd: root }).stdout);
  writeFileSync(join(root, 'clean.patch'), run('git', ['diff', 'main', 'clean'], { cwd: root }).stdout);
  mkdirSync(join(root, 'sub'));
  symlinkSync('.git', join(root, 'g'));
  symlinkSync('.claude', join(root, 'c'));
  return { root, transcript: transcript(tempDir('transcript-'), fired()) };
}

interface Hook { code: number | null; reason: string | null; out: string; err: string }

/** Runs the guard as Claude Code does: the hook's input on stdin, the project dir in the environment, in or out of a cloud session. */
function hook(root: string, input: unknown, opts: { cloud?: boolean; env?: NodeJS.ProcessEnv; args?: string[] } = {}): Hook {
  const r = spawnSync(process.execPath, [join(root, GUARD_PATH), ...(opts.args ?? [])], {
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

interface Ctx { cwd: string; projectDir: string; transcript: string | null }
interface GuardModule {
  guard: (line: string, record: string | null, ctx: Ctx) => string | null;
  recordOf: (t: string) => string | null;
  fileProblem: (input: unknown, ctx: Ctx) => string | null;
  commandsOf: (line: string) => string[][];
  rawCommandsOf: (line: string) => string[][];
  installPrePush: (ctx: Ctx, record: string | null) => string | null;
  PRE_PUSH_RECORD: string;
}

/** The guard's own functions, from the committed script, for the long lists: the same text the hook runs. */
async function guardModule(root: string): Promise<GuardModule> {
  return import(pathToFileURL(join(root, GUARD_PATH)).href) as never;
}

const HEREDOC_COMMIT = `git commit -m "$(cat <<'EOF'\nT-1: the subject\n\nA body that says git push origin main, which is only words here.\nEOF\n)"`;

test('in a cloud session, the guard allows a plain push of the recorded branch alone, in its two forms, and refuses every other form that could push, however it is written or wrapped', async () => {
  const { root, transcript } = repo();
  const g = await guardModule(root);
  const ctx = { cwd: root, projectDir: root, transcript };
  // End to end, as Claude Code runs it: the two allowed forms, with -u or --set-upstream, exit 0 with no decision.
  for (const c of [`git push origin ${BRANCH}`, `git push origin HEAD:${BRANCH}`, `git push -u origin ${BRANCH}`, `git push --set-upstream origin HEAD:${BRANCH}`, `git fetch origin ${BRANCH} && git checkout ${BRANCH}`, 'npm test', `git status && git push origin ${BRANCH}`, `FOO=1 git push origin ${BRANCH}`]) {
    const r = bash(root, transcript, c);
    assert.equal(r.code, 0, `${c}: exits 0 (${r.err})`);
    assert.equal(r.out, '', `${c}: allowed, with nothing said`);
  }
  const allowed = [
    'git commit -m "x: git push later"', HEREDOC_COMMIT, 'gh pr view 3', 'gh pr list', 'gh pr diff 3', 'gh pr checks 3', 'gh issue view 3', 'gh run view 1', 'gh run list', 'gh auth status', 'gh --version',
    'git checkout -- a.txt', 'git checkout -- .', 'git checkout clean -- README.md', 'git config user.name "Acme Bot"', 'git config user.email bot@acme.example', 'git config commit.gpgsign false', 'git config --unset user.name', 'git config --get alias.co', 'git config -l', 'git config --get core.hooksPath',
    'gh api repos/o/r/pulls/3', 'gh api -H "Accept: x" repos/o/r/pulls/3', 'nice -n 15 npm run check', 'timeout 600 npm test', 'cat .claude/settings.json', `git diff HEAD -- ${GUARD_PATH}`, `sh -c "git push origin ${BRANCH}"`,
    'node scripts/near-tests.mjs', 'git remote -v', 'git merge --abort', 'git reset HEAD~1', 'git restore a.txt', 'curl -s https://api.github.com/repos/o/r', 'ls .claude/hooks', 'git log --oneline -5', 'git merge clean', 'git rebase clean', 'git --version', 'git', 'ls', 'echo done',
    'git apply clean.patch', 'git apply --check weak.patch', 'patch -p1 -i clean.patch', 'cat .git/HEAD', 'ls .git/hooks', 'cat g/HEAD', 'cat .cl*/settings.json', 'echo \'$(git push origin main)\'', 'grep -n "git push" file', 'rg "git push" .', 'NO_COLOR=1 npm test', 'hash -r', 'git commit -m "$(cat msg.txt)"',
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
    [`git push origin ${BRANCH} --no-verify`, /Never skip the repo's git hooks \(--no-verify\)/],
    [`git push origin ${BRANCH} -u`, /push with -u/],
    [`git push origin ${BRANCH} 2>&1 | tail -3`, /with nothing after the branch \(not 2>\)/],
    // a quoted or escaped name: the words the shell will run are what's read
    ["'g'it push --force origin main", /Never force-push/],
    ['g""it push origin main', /never push main/],
    ['g\\it push origin main', /never push main/],
    // git's global options before the subcommand
    [`git -C ../x push origin ${BRANCH}`, /without -C/],
    ['git -c alias.p=push p', /Never set alias\.p for a command/],
    ['git -c push.default=upstream push', /Never set push\.default for a command/],
    [`git -c core.hooksPath=/dev/null push origin ${BRANCH}`, /Never set core\.hooksPath/],
    ['git -c core.editor=x commit -m y', /Never set core\.editor for a command/],
    [`git --git-dir=.git push origin ${BRANCH}`, /without --git-dir|Nothing under \.git\//],
    [`git --git-dir=../other push origin ${BRANCH}`, /without --git-dir/],
    [`git --work-tree=. push origin ${BRANCH}`, /without --work-tree/],
    [`git --no-pager push origin ${BRANCH}`, /Push plainly, as its own command/],
    [`git -c user.name=x push origin ${BRANCH}`, /Push plainly, as its own command/],
    // a path to git
    [`/usr/bin/git push origin ${BRANCH}`, /Push plainly, as its own command/],
    [`./git push origin ${BRANCH}`, /Push plainly, as its own command/],
    // wrappers, and the assignments that change what git is or where it looks
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
    ['nice -n 15 git push origin main', /Push plainly/],
    [`GIT_DIR=/x git push origin ${BRANCH}`, /Push plainly/],
    [`HOME=/tmp git push origin ${BRANCH}`, /Push plainly/],
    [`PATH=/tmp:$PATH git push origin ${BRANCH}`, /Push plainly/],
    [`XDG_CONFIG_HOME=/x git push origin ${BRANCH}`, /Push plainly/],
    [`LD_PRELOAD=/x.so git push origin ${BRANCH}`, /Push plainly/],
    [`EDITOR=vim git push origin ${BRANCH}`, /Push plainly/],
    [`VISUAL=vim git push origin ${BRANCH}`, /Push plainly/],
    [`GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/x git push origin ${BRANCH}`, /Never set core\.hooksPath, by any means/],
    ['PATH=/tmp:$PATH', /Never set PATH in the session/],
    ['GIT_DIR=/x', /Never set GIT_DIR in the session/],
    ['export PATH=/tmp:$PATH', /Never set PATH in the session/],
    ['export GIT_CONFIG_KEY_0=core.hooksPath', /Never set core\.hooksPath, by any means/],
    // programs that run another from their arguments
    ['find . -maxdepth 0 -exec git push -f origin main \\;', /Push plainly, as its own command/],
    ['find . -exec sh -c "git push origin main" \\;', /Push plainly, as its own command/],
    ['npm exec -- git push origin main', /Push plainly, as its own command/],
    ['watch -n1 git push origin main', /Push plainly, as its own command/],
    ['flock f git push origin main', /Push plainly, as its own command/],
    ['script -c "git push origin main" out.txt', /Push plainly, as its own command/],
    ['parallel git push origin main ::: a', /Push plainly, as its own command/],
    ['if git push origin main; then echo y; fi', /Push plainly, as its own command/],
    ['{ git push origin main; }', /Push plainly, as its own command/],
    ['echo git push origin main', /Push plainly, as its own command: .* Not through echo/],
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
    // a substitution inside double quotes runs: only single quotes are literal
    ['echo "$(git push origin main)"', /never push main/],
    ['echo "`git push origin main`"', /never push main/],
    ['echo "a $(git push origin main) b"', /never push main/],
    // aliases, the settings off the allow-list, remotes, and --no-verify
    ['git config alias.p push', /Never set alias\.p/],
    ['git config --global alias.p "push origin main"', /Never set alias\.p/],
    ['git config push.default upstream', /Never set push\.default/],
    ['git config remote.origin.url https://x', /Never set remote\.origin\.url/],
    ['git config url.x.insteadOf y', /Never set url\.x\.insteadOf/],
    ['git config core.hooksPath .githooks', /Never set core\.hooksPath/],
    ['git config core.editor vim', /Never set core\.editor/],
    ['git config diff.external x', /Never set diff\.external/],
    ['git config filter.x.clean y', /Never set filter\.x\.clean/],
    ['git config sequence.editor x', /Never set sequence\.editor/],
    ['git config gpg.program x', /Never set gpg\.program/],
    ['git config core.sshCommand x', /Never set core\.sshCommand/],
    ['git config credential.helper x', /Never set credential\.helper/],
    ['git config set core.editor x', /Never set core\.editor/],
    ['git config -e', /Never open the git config in an editor/],
    ['git config -f .claude/x user.name y', /Nothing under \.claude\/ is changed from Bash/],
    ['git remote set-url origin https://x', /Never change the remotes \(git remote set-url\)/],
    ['git remote add other https://x', /Never change the remotes \(git remote add\)/],
    ['git remote rename origin o', /Never change the remotes/],
    [`git send-pack origin ${BRANCH}`, /Push only with git push/],
    ['git commit --no-verify -m x', /Never skip the repo's git hooks/],
    ['git commit -n -m x', /Never skip the repo's git hooks/],
    ['git merge --no-verify clean', /Never skip the repo's git hooks/],
    // gh: off the allow-list, api writes, git/refs, graphql; gh pr merge
    ['gh api -X POST repos/o/r/pulls', /only reads here \(GET\), not POST/],
    ['gh api --method PUT repos/o/r/pulls/3/merge', /not PUT/],
    ['gh api --method=DELETE repos/o/r/git/refs/heads/main', /not DELETE/],
    ['gh api -XPATCH repos/o/r/git/refs/heads/main', /not PATCH/],
    ['gh api -f title=x repos/o/r/pulls', /with a field .* posts/],
    ['gh api -F title=x repos/o/r/pulls', /with a field .* posts/],
    ['gh api --input body.json repos/o/r/pulls', /with a field .* posts/],
    ['gh api repos/o/r/git/refs/heads/main', /Never touch git\/refs/],
    ['gh api repos/o/r/git/refs', /Never touch git\/refs/],
    ['gh api graphql -f query="query { viewer { login } }"', /gh api graphql posts/],
    ['gh api graphql -f query="mutation { mergePullRequest(input: {}) { pullRequest { id } } }"', /gh api graphql posts/],
    ['gh pr merge 3', /Pull requests are a person's/],
    ['gh pr create --fill', /Pull requests are a person's/],
    ['gh pr close 3', /Pull requests are a person's/],
    ['gh pr review 3 --approve', /gh pr review isn't one of a cloud builder's commands/],
    ['gh pr comment 3 -b hi', /gh pr comment isn't one/],
    ['gh workflow run x', /gh workflow run isn't one/],
    ['gh release create v1', /gh release create isn't one/],
    ['gh secret set X', /gh secret set isn't one/],
    ['gh issue close 3', /gh issue close isn't one/],
    ['gh repo delete o/r', /gh repo delete isn't one/],
    // curl and wget to GitHub, writing
    ['curl -X POST https://api.github.com/repos/o/r/pulls', /Never write to GitHub with curl/],
    ['curl -d @body.json https://api.github.com/repos/o/r/pulls', /Never write to GitHub with curl/],
    ['wget --post-data=x https://api.github.com/repos/o/r/pulls', /Never write to GitHub with wget/],
    // a deploy
    ['sf project deploy start -o Dev', /never deploy/],
    // what hides a program, a push or a file
    ['G=git; $G push origin main', /can't tell what \$G runs/],
    ['`git push origin main`', /never push main/],
    ['$(git push origin main)', /never push main/],
    ['node -e "require(\\"child_process\\").execSync(\\"git push origin main\\")"', /can't see what node -e does with git/],
    ['python3 -c "import subprocess; subprocess.run([\'git\',\'push\'])"', /can't see what python3 -c does with git/],
    ['echo x > $X', /can't tell where > writes/],
    ['tee $HOME/x < y', /can't tell where \$HOME\/x writes/],
    // the checkout, and git commands that could change the guard
    ['git checkout main', /Stay on your task branch, task\/T-1-a-thing\. git checkout main would leave it/],
    ['git switch main', /Stay on your task branch/],
    ['git checkout origin/main', /Stay on your task branch/],
    ['git switch -c task/evil', /Make no new branch/],
    ['git checkout -b task/other', /Make no new branch/],
    ['git checkout touches-guard -- .', /git checkout touches-guard would change the guard \(\.claude\/hooks\/acc-push-guard\.mjs\)/],
    ['git checkout touches-guard -- .claude/settings.json', /Nothing under \.claude\/ is changed from Bash/],
    ['git checkout touches-guard -- :/', /would change the guard/],
    ['git reset --hard HEAD~3', /Don't reset --hard/],
    ['git reset --keep HEAD~1', /Don't reset --hard, --merge or --keep/],
    ['git restore --source=main~5 .', /Don't restore from another commit/],
    ['git pull origin main', /Don't pull/],
    ['git worktree add ../x', /acc makes and removes worktrees/],
    ['git update-index --cacheinfo 100644,abc,x', /Don't write the index or the tree with git update-index/],
    ['git read-tree -u -m touches-guard', /Don't write the index or the tree with git read-tree/],
    ['git merge touches-guard', /git merge touches-guard would change the guard \(\.claude\/hooks\/acc-push-guard\.mjs\)/],
    ['git rebase touches-guard', /would change the guard/],
    ['git cherry-pick touches-guard', /git cherry-pick touches-guard would change the guard/],
    ['git revert HEAD', /The guard couldn't read HEAD to see whether git revert would change the guard|would change the guard/],
    ['git merge no-such-branch', /couldn't read no-such-branch/],
    // patches that would touch the guard, or that the guard can't see
    ['git apply weak.patch', /git apply weak\.patch would change \.claude\/ or \.git\//],
    ['git am weak.patch', /git am weak\.patch would change \.claude\/ or \.git\//],
    ['patch -p1 -i weak.patch', /patch weak\.patch would change \.claude\/ or \.git\//],
    ['patch -p1 < weak.patch', /patch weak\.patch would change \.claude\/ or \.git\//],
    ['cat weak.patch | patch -p1', /can't see what patch would change from a pipe/],
    ['cat weak.patch | git apply', /can't see what git apply would change from a pipe/],
    ['git apply no-such.patch', /couldn't read no-such\.patch/],
    // writes under .claude/ and .git/ from Bash, by name, by glob, or through a symlink
    [`echo x > ${SETTINGS_PATH}`, /Nothing under \.claude\/ is changed from Bash/],
    ['rm -rf .claude/hooks', /Nothing under \.claude\/ is changed from Bash/],
    [`sed -i s/a/b/ ${GUARD_PATH}`, /Nothing under \.claude\/ is changed from Bash/],
    [`cp x ${SETTINGS_PATH}`, /Nothing under \.claude\/ is changed from Bash/],
    ['cd .claude && rm settings.json', /Nothing under \.claude\/ is changed from Bash/],
    [`cat ${SETTINGS_PATH} | tee ${SETTINGS_PATH}`, /Nothing under \.claude\/ is changed from Bash/],
    ['git checkout -- .claude/settings.json', /Nothing under \.claude\/ is changed from Bash/],
    ['git show main:.claude/settings.json > /tmp/x', /Nothing under \.claude\/ is changed from Bash/],
    ['rm -rf .cl*', /Nothing under \.claude\/ is changed from Bash/],
    ['rm -rf .claud?', /Nothing under \.claude\/ is changed from Bash/],
    ['find .claude -delete', /Nothing under \.claude\/ is changed from Bash/],
    ['ln -s .claude x', /Nothing under \.claude\/ is changed from Bash/],
    ['echo x > c/settings.json', /Nothing under \.claude\/ is changed from Bash/],
    ['echo x > .git/hooks/pre-push', /Nothing under \.git\/ is changed from Bash/],
    ['rm .git/hooks/pre-push', /Nothing under \.git\/ is changed from Bash/],
    ['chmod -x .git/hooks/pre-push', /Nothing under \.git\/ is changed from Bash/],
    ['cp x .git/hooks/pre-push', /Nothing under \.git\/ is changed from Bash/],
    ['echo x > .git/acc-task-branch', /Nothing under \.git\/ is changed from Bash/],
    ['echo x > g/hooks/pre-push', /Nothing under \.git\/ is changed from Bash/],
    ['cd sub && echo x > ../.git/config', /Nothing under \.git\/ is changed from Bash/],
    ['rm -rf .', /Never remove the whole checkout/],
    ['rm -rf .git', /Never remove the whole checkout|Nothing under \.git\//],
    ['echo x >> session.jsonl', /Nothing under \.claude\/ is changed from Bash/],
    // a substitution in a push's words leaves its placeholder, so the push isn't read as the plain one it hides (S1)
    [`git push origin "${BRANCH}$(echo :main)"`, /not task\/\S+\$\(\.\.\.\)\./],
    [`git push origin ${BRANCH}\`echo :main\``, /not task\/\S+\$\(\.\.\.\)\./],
    [`git push origin $(echo ${BRANCH})`, /not \$\(\.\.\.\)/],
    [`git push origin "${BRANCH}$(echo x)" && echo ok`, /not task\/\S+\$\(\.\.\.\)\./],
    // --no-verify with any program, not only git
    ['npm run push -- --no-verify', /Never skip the repo's git hooks \(--no-verify\), with any program/],
    ['npx husky --no-verify=1', /Never skip the repo's git hooks \(--no-verify\), with any program/],
    // what would change the program a name runs, and a repo without the guard's hooks
    ['alias git="git --no-verify"', /defines no shell aliases/],
    ['alias p="git push origin main"', /defines no shell aliases/],
    ['hash -p /tmp/evil git', /Never point a command's name at another program \(hash -p\)/],
    ['git clone https://github.com/o/r x', /Work in this clone: a repo from git clone/],
    ['git init y', /Work in this clone: a repo from git init/],
  ];
  for (const [c, why] of refused) {
    const r = g.guard(c, BRANCH, ctx);
    assert.match(r ?? '', why, `${c}: refused, saying why (got: ${r})`);
  }
  // The same through the hook, for a few of each kind: a decision on stdout, exit 0, never 2. The quoted
  // names and the launchers go through here above all, since the hook reads the line whole.
  const through = new Set(['git push origin main', `git -C ../x push origin ${BRANCH}`, `timeout 10 git push origin ${BRANCH}`, 'sh -c "git push origin main"', 'gh api -X POST repos/o/r/pulls', 'git checkout main', `echo x > ${SETTINGS_PATH}`,
    "'g'it push --force origin main", 'g""it push origin main', 'g\\it push origin main', 'find . -maxdepth 0 -exec git push -f origin main \\;', 'echo "$(git push origin main)"', 'git checkout touches-guard -- .', 'git apply weak.patch',
    'echo x > .git/hooks/pre-push', `GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/x git push origin ${BRANCH}`, `git push origin ${BRANCH} --no-verify`, 'echo x > g/hooks/pre-push', 'rm -rf .cl*']);
  const picked = refused.filter(([c]) => through.has(c));
  assert.equal(picked.length, through.size, 'each form picked for the hook is in the list');
  for (const [c, why] of picked) {
    const r = bash(root, transcript, c);
    assert.equal(r.code, 0, `${c}: exits 0 (${r.err})`);
    assert.match(r.reason ?? '', why, `${c}: refused through the hook`);
  }
  // From a subfolder the shell moved to, a bare name still lands where it lands.
  for (const [c, why] of [['echo x > settings.json', /Nothing under \.claude\//], ['echo x > config', /Nothing under \.git\//]] as const) {
    assert.match(g.guard(c, BRANCH, { ...ctx, cwd: join(root, c.endsWith('config') ? '.git' : '.claude') }) ?? '', why, `${c} from inside the folder: refused`);
  }
});

test('the pre-push hook in the clone checks the push itself, whatever ran git: the task branch passes; main, a force, a delete, a renamed copy of git and find -exec are refused; --no-verify and core.hooksPath skip it, which is why the guard refuses both', async () => {
  const root = tempDir('prepush-');
  const git = (...a: string[]) => gitIn(root, ...a);
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 't');
  git('config', 'user.email', 't@example.com');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(root, 'README.md'), '# r\n');
  installGuard(root);
  git('add', '-A');
  git('commit', '-q', '-m', 'initial, with the guard');
  const originDir = tempDir('origin-');
  const origin = join(originDir, 'origin.git');
  assert.equal(run('git', ['init', '-q', '--bare', origin], { cwd: originDir }).code, 0);
  git('remote', 'add', 'origin', origin);
  git('push', '-q', 'origin', 'main');
  git('switch', '-q', '-c', BRANCH);
  writeFileSync(join(root, 'a.txt'), 'a\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'T-1: a thing');
  const headOf = (b: string) => gitIn(origin, 'rev-parse', b);
  const g = await guardModule(root);
  const ctx = { cwd: root, projectDir: root, transcript: null };
  // The session starting, as Claude Code runs the SessionStart hook: the hook goes into the clone, executable; the record waits for the fire's text.
  const start = hook(root, { hook_event_name: 'SessionStart', source: 'startup', cwd: root }, { args: ['--session-start'] });
  assert.deepEqual([start.code, start.out], [0, ''], start.err);
  const hookFile = join(root, '.git', 'hooks', 'pre-push');
  assert.equal(readFileSync(hookFile, 'utf8'), PRE_PUSH_SCRIPT);
  assert.ok(statSync(hookFile).mode & 0o100, 'executable');
  assert.equal(existsSync(join(root, '.git', g.PRE_PUSH_RECORD)), false, 'no record yet');
  // No record: the hook refuses even the task branch. It fails closed.
  const none = run('git', ['push', 'origin', BRANCH], { cwd: root });
  assert.notEqual(none.code, 0);
  assert.match(none.stderr, /acc's pre-push hook: no record of the task's branch/);
  // The first call with the fire's text in the transcript writes the record, before any push.
  const t = transcript(tempDir('transcript-'), fired());
  assert.deepEqual([bash(root, t, 'npm test').code, bash(root, t, 'npm test').out], [0, '']);
  assert.equal(readFileSync(join(root, '.git', g.PRE_PUSH_RECORD), 'utf8'), `${BRANCH}\n`);
  // The task branch passes, for real, and lands on origin.
  const ok = run('git', ['push', 'origin', BRANCH], { cwd: root });
  assert.equal(ok.code, 0, ok.stderr);
  assert.equal(headOf(BRANCH), git('rev-parse', 'HEAD'));
  // main: refused, and origin's main hasn't moved; HEAD:main from the task branch, the same.
  const main0 = headOf('main');
  git('switch', '-q', 'main');
  writeFileSync(join(root, 'm.txt'), 'm\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'on main');
  const toMain = run('git', ['push', 'origin', 'main'], { cwd: root });
  assert.notEqual(toMain.code, 0);
  assert.match(toMain.stderr, /acc's pre-push hook: push only your task branch, task\/T-1-a-thing, not refs\/heads\/main/);
  assert.equal(headOf('main'), main0);
  assert.match(run('git', ['push', 'origin', 'HEAD:main'], { cwd: root }).stderr, /not refs\/heads\/main/);
  assert.match(run('git', ['push', 'origin', 'HEAD:refs/heads/task/T-2-other'], { cwd: root }).stderr, /not refs\/heads\/task\/T-2-other/);
  assert.match(run('git', ['push', '--tags', 'origin'], { cwd: root }).stderr ?? '', /./);
  // A delete.
  const del = run('git', ['push', 'origin', `:${BRANCH}`], { cwd: root });
  assert.notEqual(del.code, 0);
  assert.match(del.stderr, /never delete a branch \(refs\/heads\/task\/T-1-a-thing\)/);
  assert.equal(headOf(BRANCH), gitIn(root, 'rev-parse', BRANCH));
  // A force push: the branch rewritten isn't a fast-forward, with or without -f.
  git('switch', '-q', BRANCH);
  const before = headOf(BRANCH);
  git('commit', '-q', '--amend', '-m', 'T-1: rewritten');
  const forced = run('git', ['push', '-f', 'origin', BRANCH], { cwd: root });
  assert.notEqual(forced.code, 0);
  assert.match(forced.stderr, /never force-push: task\/T-1-a-thing on origin .* isn't behind what you'd push/);
  assert.equal(headOf(BRANCH), before, 'origin keeps the earlier head');
  git('reset', '-q', '--hard', before);
  // A renamed copy of git, and git run from inside find -exec: git runs the hook all the same.
  const copy = join(tempDir('gitcopy-'), 'g');
  copyFileSync(join(git('--exec-path'), 'git'), copy);
  chmodSync(copy, 0o755);
  git('switch', '-q', 'main');
  const viaCopy = run(copy, ['push', 'origin', 'main'], { cwd: root });
  assert.notEqual(viaCopy.code, 0, `the copy ran (${viaCopy.stderr})`);
  assert.match(viaCopy.stderr, /acc's pre-push hook: push only your task branch/);
  assert.equal(headOf('main'), main0);
  const viaFind = run('find', ['.', '-maxdepth', '0', '-exec', copy, 'push', 'origin', 'main', ';'], { cwd: root });
  assert.match(viaFind.stderr, /acc's pre-push hook: push only your task branch/);
  assert.equal(headOf('main'), main0);
  // What would skip it: --no-verify, and core.hooksPath pointed elsewhere. With the hook alone on, each push
  // lands, which is why the guard refuses both before the command runs (pinned above).
  assert.equal(run('git', ['push', '--no-verify', 'origin', 'main'], { cwd: root }).code, 0);
  assert.notEqual(headOf('main'), main0, '--no-verify skipped the hook');
  writeFileSync(join(root, 'm2.txt'), 'm\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'on main again');
  assert.equal(run('git', ['-c', 'core.hooksPath=/nonexistent', 'push', 'origin', 'main'], { cwd: root }).code, 0, 'core.hooksPath skipped the hook');
  // The guard's own push path insists: core.hooksPath set means no push; a hook changed by hand is put back
  // before a push passes; without the committed script beside the guard, no push.
  git('config', 'core.hooksPath', '.githooks');
  assert.match(g.guard(`git push origin ${BRANCH}`, BRANCH, ctx) ?? '', /core\.hooksPath is set \(\.githooks\), so the clone's pre-push hook wouldn't run: no push/);
  git('config', '--unset', 'core.hooksPath');
  writeFileSync(hookFile, '#!/bin/sh\nexit 0\n');
  assert.equal(g.guard(`git push origin ${BRANCH}`, BRANCH, ctx), null);
  assert.equal(readFileSync(hookFile, 'utf8'), PRE_PUSH_SCRIPT, 'put back');
  assert.equal(readFileSync(join(root, '.git', g.PRE_PUSH_RECORD), 'utf8'), `${BRANCH}\n`);
  assert.equal(g.installPrePush(ctx, BRANCH), null);
  rmSync(join(root, PRE_PUSH_PATH));
  assert.match(g.guard(`git push origin ${BRANCH}`, BRANCH, ctx) ?? '', /pre-push hook's script isn't beside the guard \(acc-pre-push\)/);
  assert.match(hook(root, { hook_event_name: 'SessionStart', cwd: root }, { args: ['--session-start'] }).err, /pre-push hook isn't installed/);
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

test('it fails closed: junk on stdin, no tool, a Bash call with no command, an error of its own, and a guard that can\'t load block the call with exit 2; a tool it doesn\'t guard passes; outside a cloud session it says nothing', () => {
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
  // The settings run it as `node … || exit 2`: a guard that's missing or can't be parsed denies the call too.
  assert.equal(GUARD_COMMAND, 'node "$CLAUDE_PROJECT_DIR"/.claude/hooks/acc-push-guard.mjs || exit 2');
  const env = { PATH: process.env.PATH ?? '', CLAUDE_CODE_REMOTE: 'true' };
  const empty = tempDir('no-guard-');
  assert.equal(spawnSync('sh', ['-c', GUARD_COMMAND], { input: '{}', env: { ...env, CLAUDE_PROJECT_DIR: empty }, encoding: 'utf8' }).status, 2, 'missing: denied');
  mkdirSync(join(empty, '.claude', 'hooks'), { recursive: true });
  writeFileSync(join(empty, GUARD_PATH), 'this is not javascript (\n');
  assert.equal(spawnSync('sh', ['-c', GUARD_COMMAND], { input: '{}', env: { ...env, CLAUDE_PROJECT_DIR: empty }, encoding: 'utf8' }).status, 2, 'unparseable: denied');
  assert.equal(spawnSync('sh', ['-c', GUARD_COMMAND], { input: JSON.stringify({ tool_name: 'Read', tool_input: {}, cwd: root }), env: { ...env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf8' }).status, 0, 'the real one, on a tool it doesn\'t guard: exit 0');
  // A tool it doesn't guard, and a cloud session's ordinary commands, pass with nothing said.
  assert.deepEqual([hook(root, { tool_name: 'Read', tool_input: { file_path: SETTINGS_PATH }, cwd: root }).code, hook(root, { tool_name: 'Read', tool_input: { file_path: SETTINGS_PATH }, cwd: root }).out], [0, '']);
  assert.deepEqual([bash(root, transcript, 'npm test').code, bash(root, transcript, 'npm test').out], [0, '']);
  // Outside a cloud session: nothing, whatever the command, and no hook installed.
  for (const c of ['git push origin main', 'rm -rf .claude']) {
    const r = bash(root, transcript, c, { cloud: false });
    assert.deepEqual([r.code, r.out], [0, ''], `${c}: outside the cloud, nothing`);
  }
  assert.equal(hook(root, 'not json', { cloud: false }).code, 0, 'outside the cloud, junk is nobody\'s business');
  const local = tempDir('local-');
  gitIn(local, 'init', '-q');
  installGuard(local);
  assert.equal(hook(local, { hook_event_name: 'SessionStart', cwd: local }, { cloud: false, args: ['--session-start'] }).code, 0);
  assert.equal(existsSync(join(local, '.git', 'hooks', 'pre-push')), false, 'a clone on a Mac gets no pre-push hook');
  // Either of the two cloud marks is enough: the documented session id alone, or the flag alone.
  assert.match(bash(root, transcript, 'git push origin main', { env: { CLAUDE_CODE_REMOTE: '', CLAUDE_CODE_REMOTE_SESSION_ID: 'cse_01X' } }).reason ?? '', /never push main/);
  assert.match(bash(root, transcript, 'git push origin main', { env: { CLAUDE_CODE_REMOTE: 'true', CLAUDE_CODE_REMOTE_SESSION_ID: '' } }).reason ?? '', /never push main/);
});

test('an Edit, Write, MultiEdit or NotebookEdit of the hooks, any .claude settings file, anything under .git/ or the transcript is refused, through a symlink too; another file, even under .claude/, passes', async () => {
  const { root, transcript } = repo();
  const g = await guardModule(root);
  const ctx = { cwd: root, projectDir: root, transcript };
  const home = tempDir('home-');
  mkdirSync(join(home, '.claude'), { recursive: true });
  for (const tool of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']) {
    const key = tool === 'NotebookEdit' ? 'notebook_path' : 'file_path';
    for (const path of [SETTINGS_PATH, GUARD_PATH, PRE_PUSH_PATH, '.claude/hooks/other.mjs', '.claude/settings.local.json', join(root, SETTINGS_PATH), transcript, '.git/hooks/pre-push', '.git/acc-task-branch', '.git/config', 'g/hooks/pre-push', 'c/settings.json', 'c/hooks/acc-pre-push', join(home, '.claude', 'settings.json')]) {
      const r = hook(root, { tool_name: tool, tool_input: { [key]: path }, cwd: root, transcript_path: transcript });
      assert.equal(r.code, 0);
      assert.match(r.reason ?? '', /a cloud builder never changes them|transcript isn't yours/, `${tool} ${path}: refused`);
    }
    assert.equal(hook(root, { tool_name: tool, tool_input: { [key]: 'src/a.ts' }, cwd: root, transcript_path: transcript }).out, '', `${tool} src/a.ts: passes`);
    assert.equal(hook(root, { tool_name: tool, tool_input: { [key]: '.claude/rules/x.md' }, cwd: root }).out, '', `${tool} .claude/rules/x.md: passes`);
    assert.equal(hook(root, { tool_name: tool, tool_input: { [key]: 'c/rules/x.md' }, cwd: root }).out, '', `${tool} c/rules/x.md: passes`);
    assert.equal(hook(root, { tool_name: tool, tool_input: { [key]: '.gitignore' }, cwd: root }).out, '', `${tool} .gitignore: passes`);
    assert.match(hook(root, { tool_name: tool, tool_input: {}, cwd: root }).reason ?? '', /couldn't see which file/, `${tool} with no path: refused`);
  }
  // From a subfolder, the path is still the project's; a link made first can't hide where a write lands.
  assert.match(g.fileProblem({ file_path: `../${SETTINGS_PATH}` }, { ...ctx, cwd: join(root, 'sub') }) ?? '', /never changes them/);
  assert.match(g.fileProblem({ file_path: '../g/hooks/pre-push' }, { ...ctx, cwd: join(root, 'sub') }) ?? '', /never changes them/);
  assert.equal(g.fileProblem({ file_path: '../src/a.ts' }, { ...ctx, cwd: join(root, 'sub') }), null);
});

test('the guard\'s command splitter and acc\'s hooks.ts commandsOf give the same words for the same lines: a substitution in double quotes is a command and leaves its placeholder, a heredoc\'s body isn\'t', async () => {
  const { root } = repo();
  const g = await guardModule(root);
  const cases = [
    'git push origin main', 'nice -n 15 git push origin main', 'sudo git push', 'env FOO=1 git status', 'A=1 B=2 npm test', 'git add . ; git push origin main', 'a && b || c | d',
    'echo "a b" \'c d\' e\\ f', 'git commit -m "say \\"hi\\""', 'x\ny', '(cd a && git push)', '`git push origin main`', '$(git push)', 'npx acc done --landed "x"', 'time npm test', 'command git push', '',
    'git commit -m \'it\'"\'"\'s\'', 'FOO="a b" git status', 'nice -5 git push', 'nice git push', 'acc done --landed "a; b" --open none',
    'echo "$(git push origin main)"', 'echo "`git push origin main`"', 'echo \'$(git push origin main)\'', 'echo "a $(b) c"', 'git push origin "x$(echo :main)"', 'x `y` z', 'echo $(a', '(a; b) c', 'echo "x $(y "z $(w)") v"', 'echo ""', HEREDOC_COMMIT,
    'cat <<EOF\ngit push origin main\nEOF\necho after', 'cat << \'EOF\'\n\tx\nEOF', 'cat <<-EOF\n\tbody\n\tEOF\nls', 'cat <<EOF >out\nbody\nEOF',
  ];
  for (const c of cases) assert.deepEqual(g.commandsOf(c), commandsOf(c), JSON.stringify(c));
  assert.equal(cases.length, 37, 'every case ran');
  // What the shared cases say: the substitution is its own command, first, and leaves its placeholder in the
  // command around it, which stays whole; the single quotes keep theirs; the heredoc's body is skipped.
  assert.deepEqual(commandsOf('echo "$(git push origin main)"'), [['git', 'push', 'origin', 'main'], ['echo', SUBSTITUTED]]);
  assert.deepEqual(commandsOf('echo "a $(b) c"'), [['b'], ['echo', 'a $(...) c']]);
  assert.deepEqual(commandsOf('git push origin "x$(echo :main)"'), [['echo', ':main'], ['git', 'push', 'origin', 'x$(...)']]);
  assert.deepEqual(commandsOf('x `y` z'), [['y'], ['x', SUBSTITUTED, 'z']]);
  // A group still cuts; a substitution left open still leaves its command whole.
  assert.deepEqual(commandsOf('(a; b) c'), [['a'], ['b'], ['c']]);
  assert.deepEqual(commandsOf('echo $(a'), [['a'], ['echo', SUBSTITUTED]]);
  assert.deepEqual(commandsOf('echo \'$(git push origin main)\''), [['echo', '$(git push origin main)']]);
  assert.deepEqual(commandsOf(HEREDOC_COMMIT), [['cat', '<<EOF'], ['git', 'commit', '-m', SUBSTITUTED]]);
  assert.deepEqual(commandsOf('cat <<EOF\ngit push origin main\nEOF\necho after'), [['cat', '<<EOF'], ['echo', 'after']]);
  assert.deepEqual(commandsOf('cat <<-EOF\n\tbody\n\tEOF\nls'), [['cat', '<<-EOF'], ['ls']]);
});

test('installGuard writes both scripts and the hooks on every tool it guards and at SessionStart, from the project root and failing closed, keeps other settings, replaces older entries of its own, and writes again only when something changed', () => {
  const root = tempDir('guard-install-');
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(join(root, SETTINGS_PATH), JSON.stringify({ permissions: { allow: ['Bash(npm test)'] }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo bye' }] }], PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node .claude/hooks/acc-push-guard.mjs', timeout: 10 }] }] } }));
  assert.equal(guardInstalled(root), false);
  const first = installGuard(root);
  assert.deepEqual(first.written.sort(), [GUARD_PATH, PRE_PUSH_PATH, SETTINGS_PATH].sort());
  assert.equal(readFileSync(join(root, GUARD_PATH), 'utf8'), GUARD_SCRIPT);
  assert.equal(readFileSync(join(root, PRE_PUSH_PATH), 'utf8'), PRE_PUSH_SCRIPT);
  assert.ok(PRE_PUSH_SCRIPT.startsWith('#!/bin/sh\n'), 'a shell script, which any clone runs');
  const settings = JSON.parse(readFileSync(join(root, SETTINGS_PATH), 'utf8'));
  assert.deepEqual(settings.permissions, { allow: ['Bash(npm test)'] }, 'other settings are kept');
  assert.equal(settings.hooks.Stop[0].hooks[0].command, 'echo bye', 'other hooks are kept');
  assert.deepEqual(settings.hooks.PreToolUse, [{ matcher: GUARD_MATCHER, hooks: [{ type: 'command', command: GUARD_COMMAND, timeout: 20 }] }], 'the older entry is replaced by the new one');
  assert.deepEqual(settings.hooks.SessionStart, [{ hooks: [{ type: 'command', command: SESSION_COMMAND, timeout: 20 }] }], 'and the session start installs the pre-push hook');
  assert.equal(GUARD_COMMAND, 'node "$CLAUDE_PROJECT_DIR"/.claude/hooks/acc-push-guard.mjs || exit 2', 'the path is from the project root Claude Code gives the hook, so a cd can\'t make it fail to load, and a guard that can\'t run denies');
  assert.equal(SESSION_COMMAND, 'node "$CLAUDE_PROJECT_DIR"/.claude/hooks/acc-push-guard.mjs --session-start || exit 2');
  assert.equal(GUARD_MATCHER, 'Bash|Edit|Write|MultiEdit|NotebookEdit');
  assert.equal(guardInstalled(root), true);
  assert.deepEqual(installGuard(root).written, [], 'nothing to write again');
  // A script someone changed is written again, so the committed guard is always acc's; so is a settings file whose entry is gone.
  writeFileSync(join(root, GUARD_PATH), '// changed\n');
  assert.deepEqual(installGuard(root).written, [GUARD_PATH]);
  writeFileSync(join(root, PRE_PUSH_PATH), '# changed\n');
  assert.deepEqual(installGuard(root).written, [PRE_PUSH_PATH]);
  assert.equal(settingsRunGuard(JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: GUARD_COMMAND }] }], SessionStart: [{ hooks: [{ type: 'command', command: SESSION_COMMAND }] }] } })), false, 'an entry on Bash alone doesn\'t guard the edits');
  assert.equal(settingsRunGuard(JSON.stringify({ hooks: { PreToolUse: [{ matcher: GUARD_MATCHER, hooks: [{ type: 'command', command: GUARD_COMMAND }] }] } })), false, 'without SessionStart, the pre-push hook would wait for the first push');
  assert.equal(settingsRunGuard(JSON.stringify({ hooks: { PreToolUse: [{ matcher: GUARD_MATCHER, hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR"/.claude/hooks/acc-push-guard.mjs' }] }], SessionStart: [{ hooks: [{ type: 'command', command: SESSION_COMMAND }] }] } })), false, 'an entry without || exit 2 wouldn\'t fail closed');
  assert.equal(settingsRunGuard('not json'), false);
});

test('guardCommitted reads a commit\'s tree, never the files on disk: the guard uncommitted, older, without its pre-push hook or without its hook entries says no, with the fix', () => {
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
  // The pre-push hook missing, or older.
  writeFileSync(join(root, GUARD_PATH), GUARD_SCRIPT);
  git('rm', '-q', PRE_PUSH_PATH);
  git('commit', '-q', '-am', 'no pre-push');
  assert.match(at('old').why ?? '', /old doesn't carry \.claude\/hooks\/acc-pre-push/);
  writeFileSync(join(root, PRE_PUSH_PATH), '# older\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'older pre-push');
  assert.match(at('old').why ?? '', /old carries an older \.claude\/hooks\/acc-pre-push/);
  // The settings without the entries.
  writeFileSync(join(root, PRE_PUSH_PATH), PRE_PUSH_SCRIPT);
  writeFileSync(join(root, SETTINGS_PATH), JSON.stringify({ hooks: {} }));
  git('commit', '-q', '-am', 'no entry');
  assert.match(at('old').why ?? '', /\.claude\/settings\.json on old doesn't run the guard on Bash\|Edit\|Write\|MultiEdit\|NotebookEdit and at SessionStart/);
  assert.match(at('nope').why ?? '', /nope doesn't carry/);
});

test('this repo commits the guard, so the real run on it is guarded (GH-69)', () => {
  const repoRoot = join(import.meta.dirname, '..', '..', '..');
  assert.equal(guardInstalled(repoRoot), true, `${GUARD_PATH}, ${PRE_PUSH_PATH} and their hooks in ${SETTINGS_PATH} are in the tree`);
  assert.equal(readFileSync(join(repoRoot, GUARD_PATH), 'utf8'), GUARD_SCRIPT, 'the committed script is the current one');
  assert.equal(readFileSync(join(repoRoot, PRE_PUSH_PATH), 'utf8'), PRE_PUSH_SCRIPT, 'and so is the pre-push hook');
  assert.deepEqual(guardCommitted(run, repoRoot, 'HEAD'), { ok: true, why: null }, 'and HEAD carries all three, as a cloud session would see them');
});
