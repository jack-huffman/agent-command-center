// The deploy guide (T-154): the person's yes typed in its chat, kept by the UserPromptSubmit hook and used once
// by acc deploy; what the guide may run; and how its chat opens.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { test } from 'node:test';
import { ASK_AGAIN, DEPLOY_TO_VAR, DEPLOYER, DEPLOYER_DENIES, deployerSettings, deployerTask, deployGuidePrompt, keepTypedYes, takeTypedYes, typedYesPath, YES_MAX, YES_TTL_MS } from '../src/deploy-guide.ts';
import { run } from '../src/exec.ts';
import { DEPLOYER_ACC, DEPLOYER_GIT, DEPLOYER_SF, guardBash, guardDeployer, guideCommands, preToolUseHook, userPromptSubmitHook } from '../src/hooks.ts';
import { HAND_DEPLOY_DENIES } from '../src/deploy-commands.ts';
import { repoPaths } from '../src/paths.ts';
import { makeRepo, tempDir } from './support.ts';

const at = (iso: string) => () => new Date(iso);
const T0 = '2026-10-30T12:00:00Z';
const state = () => ({ stateDir: tempDir('state-') });
const checked = (iso: string) => ({ at: iso });

test('the person\'s latest short message is their yes, read once', () => {
  const p = state();
  keepTypedYes(p, 'ACME-1', '  Production \n', 'sess-1', at(T0));
  assert.equal(takeTypedYes(p, 'ACME-1', checked('2026-10-30T11:59:00Z'), at('2026-10-30T12:01:00Z')), 'Production', 'trimmed');
  assert.equal(existsSync(typedYesPath(p, 'ACME-1')), false, 'used up');
  assert.throws(() => takeTypedYes(p, 'ACME-1', null, at(T0)), (e: Error) => e.message === `The person hasn't typed a yes for ACME-1 in this chat. ${ASK_AGAIN}`, 'a second deploy needs a second yes');
});

test('a long or many-line message is no yes, and clears the one before it, so the yes is always the latest message', () => {
  const p = state();
  keepTypedYes(p, 'ACME-1', 'Production', null, at(T0));
  keepTypedYes(p, 'ACME-1', 'x'.repeat(YES_MAX + 1), null, at(T0));
  assert.throws(() => takeTypedYes(p, 'ACME-1', null, at(T0)), /hasn't typed a yes/);
  keepTypedYes(p, 'ACME-1', 'Production', null, at(T0));
  keepTypedYes(p, 'ACME-1', 'wait\nno', null, at(T0));
  assert.throws(() => takeTypedYes(p, 'ACME-1', null, at(T0)), /hasn't typed a yes/);
  keepTypedYes(p, 'ACME-1', 'Production', null, at(T0));
  keepTypedYes(p, 'ACME-1', 'stop', null, at(T0));
  assert.equal(takeTypedYes(p, 'ACME-1', null, at(T0)), 'stop', 'what it says is the deploy\'s to judge');
  keepTypedYes(p, 'ACME-1', '   ', null, at(T0));
  assert.equal(existsSync(typedYesPath(p, 'ACME-1')), false, 'edge case: an empty message keeps nothing');
});

test('a yes older than the limit, or typed before the latest check, is refused and used up', () => {
  const p = state();
  keepTypedYes(p, 'ACME-1', 'Production', null, at(T0));
  assert.throws(() => takeTypedYes(p, 'ACME-1', null, () => new Date(Date.parse(T0) + YES_TTL_MS + 1)), /more than 15 minutes old/);
  assert.equal(existsSync(typedYesPath(p, 'ACME-1')), false);
  keepTypedYes(p, 'ACME-1', 'Production', null, at(T0));
  assert.throws(() => takeTypedYes(p, 'ACME-1', checked('2026-10-30T12:00:01Z'), at('2026-10-30T12:02:00Z')), /typed it before the latest check\. Show them the check's result/);
  keepTypedYes(p, 'ACME-1', 'Production', null, at(T0));
  assert.equal(takeTypedYes(p, 'ACME-1', checked(T0), () => new Date(Date.parse(T0) + YES_TTL_MS)), 'Production', 'edge case: at the limit, and at the check\'s own second');
});

test('edge case: a yes is for its own task: another task\'s file, or one that isn\'t acc\'s, is no yes', () => {
  const p = state();
  keepTypedYes(p, 'ACME-2', 'Production', null, at(T0));
  assert.throws(() => takeTypedYes(p, 'ACME-1', null, at(T0)), /hasn't typed a yes for ACME-1/);
  mkdirSync(dirname(typedYesPath(p, 'ACME-1')), { recursive: true });
  writeFileSync(typedYesPath(p, 'ACME-1'), JSON.stringify({ v: 1, task: 'ACME-2', typed: 'Production', at: T0 }));
  assert.throws(() => takeTypedYes(p, 'ACME-1', null, at(T0)), /hasn't typed a yes/);
  writeFileSync(typedYesPath(p, 'ACME-1'), 'not json');
  assert.throws(() => takeTypedYes(p, 'ACME-1', null, at(T0)), /hasn't typed a yes/);
});

test('the UserPromptSubmit hook keeps what the person types in a deploy guide\'s chat, and nothing anywhere else', () => {
  const dir = makeRepo({ '.acc/config.json': '{}' });
  const paths = repoPaths(dir, run);
  const guide = { cwd: dir, env: { ACC_ROLE: DEPLOYER, ACC_TASK: 'acme-1' }, run, now: at(T0) };
  assert.equal(userPromptSubmitHook({ prompt: 'Production', session_id: 's1' }, guide), null, 'it never answers in the chat');
  assert.equal(takeTypedYes(paths, 'ACME-1', null, at(T0)), 'Production', 'the task is read as its id');
  for (const env of [{ ACC_ROLE: 'builder', ACC_TASK: 'ACME-1' }, { ACC_ROLE: DEPLOYER }, {}]) {
    userPromptSubmitHook({ prompt: 'Production' }, { ...guide, env });
    assert.equal(existsSync(typedYesPath(paths, 'ACME-1')), false, `nothing kept for ${JSON.stringify(env)}`);
  }
  userPromptSubmitHook({ prompt: 'Production' }, { ...guide, cwd: tempDir('elsewhere-') });
  assert.equal(existsSync(typedYesPath(paths, 'ACME-1')), false, 'edge case: outside a project with acc, nothing');
  assert.equal(deployerTask({ ACC_ROLE: DEPLOYER, ACC_TASK: 'T-9' }), 'T-9');
  assert.equal(DEPLOY_TO_VAR, 'ACC_DEPLOY_TO', 'the name the skill and the guard read');
  assert.equal(deployerTask({ ACC_ROLE: 'builder', ACC_TASK: 'T-9' }), null);
});

test('the guide deploys only its own ticket through acc deploy, and never types the name, deploys by hand, or moves a branch', () => {
  assert.equal(guardDeployer('ACME-1', 'acc deploy --task ACME-1 --plan'), null);
  assert.equal(guardDeployer('ACME-1', 'acc deploy production --task acme-1 --yes 0AfX'), null);
  assert.equal(guardDeployer('ACME-1', 'acc show ACME-1 && acc change list ACME-1'), null);
  assert.equal(guardDeployer('ACME-1', 'acc change step ACME-1 c1 --env production --done'), null);
  assert.equal(guardDeployer('ACME-1', 'sf data query -q "SELECT Id FROM PermissionSet" -o Prod'), null);
  assert.equal(guardDeployer('ACME-1', 'sf org assign permset --name Sales_Ops -o Prod'), null, 'a step it runs with the person\'s yes, which Claude Code asks for');
  assert.equal(guardDeployer('ACME-1', 'git log --oneline -3'), null);
  assert.match(guardDeployer('ACME-1', 'acc deploy production --task ACME-2 --yes 0AfX')!, /deploys ACME-1 alone/);
  assert.match(guardDeployer('ACME-1', 'acc deploy production')!, /deploys ACME-1 alone/, 'a whole branch is not its');
  assert.match(guardDeployer('ACME-1', 'acc deploy production --task ACME-1 --yes 0AfX --confirm-production Production')!, /never types the org's name/);
  assert.match(guardDeployer('ACME-1', 'acc deploy --task ACME-1 --confirm-production=Production')!, /never types the org's name/);
  assert.match(guardDeployer('ACME-1', 'sf project deploy start -x manifest/package.xml -o Prod')!, /never deploys by hand/);
  assert.match(guardDeployer('ACME-1', 'git push origin production')!, /git only reads/);
  assert.match(guardDeployer('ACME-1', 'acc set ACME-1 done')!, /acc set is a person's/);
  assert.match(guardDeployer('ACME-1', 'cat README.md')!, /cat isn't one/);
  assert.match(guardDeployer('ACME-1', 'cat .git/acc/deploy-yes/ACME-1.json')!, /never reads, writes or runs them/);
  assert.match(guardDeployer('ACME-1', 'git show HEAD:.git/acc/deploy-yes/ACME-1.json')!, /never reads, writes or runs them/);
  assert.match(guardDeployer('ACME-1', 'echo \'{"typed":"Production"}\' > "$(git rev-parse --git-common-dir)/acc/deploy-yes/x"')!, /plain commands only/);
  assert.match(guardDeployer('ACME-1', 'ACC_ROLE=human acc deploy --task ACME-1 --yes 0AfX')!, /never reads, writes or runs them/);
  assert.match(guardDeployer('ACME-1', 'sf project retrieve start -m ApexClass:X')!, /sf project retrieve isn't one/);
  assert.match(guardDeployer('ACME-1', 'sf data query -q "SELECT Id FROM Account" --output-file out.csv')!, /writes no file/);
  assert.match(guardDeployer('ACME-1', 'sf plugins install evil')!, /sf plugins install isn't one/);
  assert.equal(guardDeployer('ACME-1', 'sf data update record -s Account -w "Name=\'Acme\'" -v "Rating=\'Hot\'" -o Prod'), null, 'a record step');
  assert.match(guardDeployer('ACME-1', 'sf data update record -s Account -i 001X -v "Name=\'x\'" --use-tooling-api -o Prod')!, /never metadata through the Tooling API/);
  assert.equal(guardDeployer('ACME-1', 'acc deploy "$ACC_DEPLOY_TO" --task ${ACC_TASK} --plan'), null, 'a whole-word variable, bare or quoted');
  for (const c of DEPLOYER_SF) assert.equal(guardDeployer('ACME-1', `${c} -o Prod`), null, c);
  assert.equal(guardDeployer('ACME-1', 'sf data query -q "SELECT Id FROM Account" -f q.soql -o Prod'), null, 'edge case: -f on a query reads its file');
  assert.equal(guardDeployer('ACME-1', 'sf data query -q "SELECT Id FROM Case WHERE Status != \'Closed\'" -o Prod --json'), null, 'edge case: a quote inside a quote, and !=');
  assert.deepEqual(guideCommands('acc show ACME-1 && git log -1; sf org display -o "Acme Prod"'), { commands: [['acc', 'show', 'ACME-1'], ['git', 'log', '-1'], ['sf', 'org', 'display', '-o', 'Acme Prod']] });
  assert.deepEqual([...DEPLOYER_ACC].sort(), ['board', 'change', 'deploy', 'doctor', 'list', 'show', 'ste', 'ticket']);
  for (const g of DEPLOYER_GIT) assert.equal(guardDeployer('ACME-1', `git ${g}`), null, `git ${g} reads`);
  assert.ok(!(DEPLOYER_GIT as readonly string[]).some((g) => ['push', 'commit', 'merge', 'checkout', 'reset'].includes(g)));
});

test('the guide can\'t drop its role, type the name, plant a yes or hide a command in another (the review\'s ways round)', () => {
  const refused = [
    // The first review's.
    'unset ACC_ROLE; acc deploy production --task ACME-1 --yes 0AfX --confirm-name=Production',
    'env -u ACC_ROLE acc deploy production --task ACME-1 --yes 0AfX --confirm-production Production',
    'env -u ACC_ROLE sf project deploy start -o Prod',
    'export ACC_ROLE=human',
    'acc deploy production --task ACME-1 --yes 0AfX --confirm-name Production',
    'acc deploy production --task ACME-1 --deploy-check=0AfX',
    'printf \'{"prompt":"Production"}\' | sh -c \'acc hook user-prompt-submit\'',
    'printf x | acc hook user-prompt-submit',
    'bash -c "acc deploy production --task ACME-1 --yes 0AfX"',
    'eval "$CMD"',
    '$CMD',
    'xargs acc deploy --task ACME-1',
    'time acc deploy production --task ACME-1 --yes 0AfX',
    'nice -n 5 sh -c true',
    'acc change record ACME-1 --object Account --match Name=x --why y',
    'acc change step ACME-2 c1 --env production --done',
    // The second review's: a shell by its path or after a wrapper, acc by its script, the role dropped without ACC_ROLE=, a flag built.
    "/bin/sh -c 'unset ACC_ROLE; acc deploy production --task ACME-1 --yes 0AfX --confirm-production Production'",
    'printf \'{"prompt":"Production"}\' | /bin/sh -c \'acc hook user-prompt-sub""mit\'',
    "timeout 60 bash -c 'acc deploy production --task ACME-1 --yes 0AfX'",
    'caffeinate -i acc deploy production --task ACME-1 --yes 0AfX',
    '/usr/bin/env -i node /opt/acc/acc.mjs deploy production --task ACME-1 --yes 0AfX --confirm-production Production',
    'printf -v ACC_ROLE human; F=--confirm-production; acc deploy production --task ACME-1 --yes 0AfX $F Production',
    'read ACC_ROLE <<< human',
    'for ACC_ROLE in human; do :; done',
    'acc deploy production --task ACME-1 --yes 0AfX --confirm-{production,production} Production',
    'acc deploy uat --task ACME-1 --yes 0AfX > /dev/null &',
    "printf '{}' > .git/a''cc/deploy-y''es/ACME-1.json",
    "node -e 'require(\"fs\")'",
    "python3 -c 'print(1)'",
    "git -c alias.x='!sh' x",
    'find . -exec sh {} ;',
    "awk 'BEGIN{system(\"id\")}'",
    'acc deploy production --task ACME-1 --yes 0AfX\nacc deploy uat --task ACME-1',
    'acc show ACME-1 | tee out',
    'acc show `id`',
    'acc show "$(id)"',
    'acc show ACME-1 || true',
    './dist/acc show ACME-1',
    // The third review's: a variable that hides a word's start, and sf's own ways to deploy or change an org.
    "git log -1 '--format={\"v\":1}' $ACC_TASKZ--output=.git$ACC_TASKZ/acc/deploy$ACC_TASKZ-yes/ACME-1.json",
    'acc show $ACC_TASK_',
    'acc show $ACC_TASK:s@ACME-1@x@',
    'acc show "$ACC_TASK"x',
    'acc show x"$ACC_TASK"',
    'acc show "$ACC_TASKZ"',
    "sf api request rest '/services/data/v62.0/metadata/deployRequest/0AfX?quickDeploy=true' --method POST -o Prod",
    "sf api request graphql --body '{}' -o Prod",
    'sf org delete sandbox -o Prod',
    'sf org login web --alias Prod',
    'sf org logout -o Prod',
    'sf apex run -o Prod',
    'sf data query --flags-dir flags',
    'sf --json data query -q x',
    'sfdx data query -q x',
    // The fourth review's: sf's one-letter output flags, the token, and setup objects through record writes.
    'sf apex get log -d /tmp/x -o Prod',
    'sf org list metadata -m ApexClass -f force-app/main/default/classes/X.cls -o Prod',
    'sf org list metadata-types -f .acc/config.json -o Prod',
    'sf org display --verbose -o Prod',
    'sf data update record -s PermissionSet -i 0PSX -v "Label=x" -o Prod',
    'sf data create record --sobject FieldPermissions -v "Field=x" -o Prod',
    'sf data update record --sobject=PermissionSet -i 0PSX -o Prod',
  ];
  for (const line of refused) assert.ok(guardDeployer('ACME-1', line), `refused: ${line}`);
  assert.equal(guardDeployer('ACME-1', 'acc deploy production --task=ACME-1 --yes 0AfX'), null, '--task= names it too');
  assert.equal(guardDeployer('ACME-1', 'acc deploy "$ACC_DEPLOY_TO" --task "${ACC_TASK}" --plan'), null, 'edge case: as the skill writes it, quoted');
});

test('every acc command the skill names passes the guard, but the ones it says never to run', () => {
  const skill = readFileSync(new URL('../../../plugin/skills/deploy/SKILL.md', import.meta.url), 'utf8');
  const commands = [...skill.matchAll(/`(acc [^`]+)`/g)].map((m) => m[1]!.replace(/<[^>]+>/g, 'x'));
  assert.ok(commands.length >= 5, `found ${commands.length}`);
  for (const c of commands) {
    if (c === 'acc hook') assert.ok(guardDeployer('ACME-1', c), 'acc hook is named as never');
    else assert.equal(guardDeployer('ACME-1', c.replaceAll('$ACC_TASK', 'ACME-1')), null, c);
  }
  for (const c of commands.filter((x) => x !== 'acc hook')) assert.equal(guardDeployer('ACME-1', c), null, `with $ACC_TASK as written: ${c}`);
});

test('the guide\'s settings ask before every command, deny the ways round in Claude Code itself, and run acc\'s two hooks', () => {
  const s = deployerSettings('/opt/acc') as { permissions: { ask: string[]; deny: string[] }; hooks: Record<string, { hooks: { command: string }[] }[]> };
  assert.deepEqual(s.permissions.ask, ['Bash']);
  for (const d of [...HAND_DEPLOY_DENIES, 'Bash(acc hook*)', 'Bash(unset *)', 'Bash(env *)', 'Bash(sh *)', 'Bash(eval *)', 'Bash(git push*)', 'Edit', 'Write']) assert.ok(s.permissions.deny.includes(d), d);
  assert.deepEqual(s.permissions.deny, DEPLOYER_DENIES);
  assert.equal(s.hooks.PreToolUse![0]!.hooks[0]!.command, '/opt/acc hook pre-tool-use');
  assert.equal(s.hooks.UserPromptSubmit![0]!.hooks[0]!.command, '/opt/acc hook user-prompt-submit');
  assert.equal('hooks' in deployerSettings(), false, 'edge case: with no acc to name, no hooks');
});

test('a builder can\'t run acc\'s hooks by hand, to plant a yes for any ticket', () => {
  const b = { task: { id: 'T-1' } as never, worktree: '/w', root: '/r' };
  assert.ok(guardBash(b, 'ACC_ROLE=deployer ACC_TASK=X acc hook user-prompt-submit'));
  assert.ok(guardBash(b, 'acc hook pre-tool-use'));
});

test('in a deploy guide\'s session, an edit is refused and a command is guarded; a builder\'s guard doesn\'t apply', () => {
  const ctx = { cwd: '/x', env: { ACC_ROLE: DEPLOYER, ACC_TASK: 'ACME-1' }, run, now: at(T0) };
  const reason = (r: Record<string, unknown> | null) => String((r as { hookSpecificOutput?: { permissionDecisionReason?: string } } | null)?.hookSpecificOutput?.permissionDecisionReason);
  assert.match(reason(preToolUseHook({ tool_name: 'Edit', tool_input: { file_path: '/x/force-app/a.cls' } }, ctx)), /changes no file/);
  assert.match(reason(preToolUseHook({ tool_name: 'Bash', tool_input: { command: 'git commit -am x' } }, ctx)), /git only reads/);
  assert.equal(preToolUseHook({ tool_name: 'Bash', tool_input: { command: 'acc deploy --task ACME-1 --plan' } }, ctx), null);
  assert.equal(preToolUseHook({ tool_name: 'Read', tool_input: { file_path: '/x/a' } }, ctx), null, 'it reads freely');
});

test('the guide\'s first message names the ticket, where it goes and the skill', () => {
  assert.equal(deployGuidePrompt('ACME-1', 'UAT', 'Production'), 'Guide the deploy of ACME-1 from UAT to Production, as the acc:deploy skill says. Start by reading the ticket and checking the deploy, then show me the runbook.');
});
