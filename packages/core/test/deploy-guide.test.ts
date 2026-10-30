// The deploy guide (T-154): the person's yes typed in its chat, kept by the UserPromptSubmit hook and used once
// by acc deploy; what the guide may run; and how its chat opens.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { test } from 'node:test';
import { ASK_AGAIN, DEPLOY_TO_VAR, DEPLOYER, deployerTask, deployGuidePrompt, keepTypedYes, takeTypedYes, typedYesPath, YES_MAX, YES_TTL_MS } from '../src/deploy-guide.ts';
import { run } from '../src/exec.ts';
import { DEPLOYER_ACC, guardDeployer, preToolUseHook, userPromptSubmitHook } from '../src/hooks.ts';
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
  assert.match(guardDeployer('ACME-1', 'git push origin production')!, /changes no branch: git push/);
  assert.match(guardDeployer('ACME-1', 'acc set ACME-1 done')!, /acc set is a person's/);
  assert.match(guardDeployer('ACME-1', 'cat .git/acc/deploy-yes/ACME-1.json')!, /never reads or writes it/);
  assert.match(guardDeployer('ACME-1', 'echo \'{"typed":"Production"}\' > "$(git rev-parse --git-common-dir)/acc/deploy-yes/x"')!, /never reads or writes it/);
  assert.match(guardDeployer('ACME-1', 'ACC_ROLE=human acc deploy --task ACME-1 --yes 0AfX')!, /never sets ACC_ROLE/);
  assert.deepEqual([...DEPLOYER_ACC].sort(), ['board', 'change', 'deploy', 'doctor', 'list', 'show', 'ste', 'ticket']);
});

test('in a deploy guide\'s session, an edit is refused and a command is guarded; a builder\'s guard doesn\'t apply', () => {
  const ctx = { cwd: '/x', env: { ACC_ROLE: DEPLOYER, ACC_TASK: 'ACME-1' }, run, now: at(T0) };
  const reason = (r: Record<string, unknown> | null) => String((r as { hookSpecificOutput?: { permissionDecisionReason?: string } } | null)?.hookSpecificOutput?.permissionDecisionReason);
  assert.match(reason(preToolUseHook({ tool_name: 'Edit', tool_input: { file_path: '/x/force-app/a.cls' } }, ctx)), /changes no file/);
  assert.match(reason(preToolUseHook({ tool_name: 'Bash', tool_input: { command: 'git commit -am x' } }, ctx)), /changes no branch/);
  assert.equal(preToolUseHook({ tool_name: 'Bash', tool_input: { command: 'acc deploy --task ACME-1 --plan' } }, ctx), null);
  assert.equal(preToolUseHook({ tool_name: 'Read', tool_input: { file_path: '/x/a' } }, ctx), null, 'it reads freely');
});

test('the guide\'s first message names the ticket, where it goes and the skill', () => {
  assert.equal(deployGuidePrompt('ACME-1', 'UAT', 'Production'), 'Guide the deploy of ACME-1 from UAT to Production, as the acc:deploy skill says. Start by reading the ticket and checking the deploy, then show me the runbook.');
});
