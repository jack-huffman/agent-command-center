// Join a team project in the Command Center (T-176): the account choice, acc join's answers, the org logins a
// joined project offers, Setup in a joined clone, Join where no project is set up, and Share how to join.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JOIN_COMMAND, OWN_STEPS, TEAM_STEPS_TITLE } from '../../packages/core/src/join.ts';
import { STEPS } from '../../packages/core/src/onboarding/steps.ts';
import { WINDOWS_SKIPS } from '../../scripts/windows-tests.ts';
import { ACCOUNT_OPTIONS_MAX, accountChoices, joinAnswer, joinArgs, loginEnvironments, OWN_ACCOUNT } from '../src/logic/join.ts';
import type { DoctorItem } from '../src/logic/setup.ts';
import type { IdentityCard } from '../src/model/environments.ts';
import { area, JOIN_ACTION, joinedParts, SHARE_JOIN_COMMAND } from '../src/model/join.ts';
import { githubAccount, shareJoinAction } from '../src/model/settings.ts';
import { setupModel } from '../src/model/setup.ts';
import type { ProjectLike } from '../src/model/shared.ts';

test('more than one account that can read it: at most three, the active one first, then the person\'s own words (D-205)', () => {
  const five = ['a1', 'a2', 'a3', 'a4', 'a5'];
  const c = accountChoices(five, 'a4');
  assert.equal(c.length, ACCOUNT_OPTIONS_MAX + 1);
  assert.deepEqual(c.slice(0, 3).map((x) => x.account), ['a4', 'a1', 'a2']);
  assert.match(c[0]!.description!, /suggested/);
  assert.equal(c[3], OWN_ACCOUNT);
  assert.deepEqual(accountChoices(['a1', 'a2'], null).map((x) => x.account ?? 'own'), ['a1', 'a2', 'own']);
  assert.deepEqual(accountChoices(['a1', 'a2'], 'not-a-reader').map((x) => x.account ?? 'own'), ['a1', 'a2', 'own'], 'an active account that can\'t read it isn\'t offered');
});

test('acc join\'s answer is read as JSON, and a refusal, or no answer at all, is its words', () => {
  assert.deepEqual(joinAnswer('{"repo":"acme-co/x","readers":["a"],"account":"a","dir":"/d"}'), { ok: true, repo: 'acme-co/x', readers: ['a'], account: 'a', dir: '/d' });
  assert.deepEqual(joinAnswer('{"error":"refused","message":"No GitHub account can read it."}'), { ok: false, message: 'No GitHub account can read it.' });
  assert.deepEqual(joinAnswer(''), { ok: false, message: 'The Command Center gave no answer.' });
  assert.deepEqual(joinAnswer('not json'), { ok: false, message: 'not json' });
});

test('acc join is asked with the address, the folder and the account, and --dry-run asks without writing', () => {
  assert.deepEqual(joinArgs(' https://github.com/a/b ', { dryRun: true }), ['join', 'https://github.com/a/b', '--dry-run', '--json']);
  assert.deepEqual(joinArgs('https://github.com/a/b', { dir: '/x y', account: 'acme-bot' }), ['join', 'https://github.com/a/b', '--dir', '/x y', '--account', 'acme-bot', '--json']);
});

test('a joined Salesforce project offers no Production login; one set up here still does, and an environment with no org never', () => {
  const envs = [{ name: 'Production', type: 'production', org: 'Acme Production' }, { name: 'Dev', type: 'developer', org: 'Acme Dev' }, { name: 'Off', type: 'none', org: 'x' }, { name: 'UAT', type: 'full', org: null }];
  assert.deepEqual(loginEnvironments(envs, true).map((e) => e.name), ['Dev']);
  assert.deepEqual(loginEnvironments(envs, false).map((e) => e.name), ['Production', 'Dev']);
  assert.deepEqual(loginEnvironments([], true), []);
});

/** Every Setup step, as acc doctor answers it: the machine's passed, the project's partly to do. */
const items = (): DoctorItem[] => STEPS.map((s) => ({ id: s.id, part: s.part, title: s.title, status: s.part === 'machine' || s.id === 'B6.org-match' ? 'pass' : 'fail', detail: '' }));

test('Setup in a joined clone shows only each person\'s own steps under Join <project>, and folds the project\'s own under Set up by your team', () => {
  const m = setupModel(items(), new Set(), true, null, null, 'Acme');
  const join = m.parts.find((p) => p.part === 'project')!;
  assert.equal(join.label, 'Join Acme');
  assert.deepEqual(join.steps.map((s) => s.id), [...OWN_STEPS]);
  assert.equal(join.todo, OWN_STEPS.length - 2, 'the plugin and the org logins passed');
  // The plugin moves to the person's list, so it isn't shown twice.
  assert.ok(!m.parts.find((p) => p.part === 'machine')!.steps.some((s) => s.id === 'A4.plugin'));
  assert.equal(m.team!.title, TEAM_STEPS_TITLE);
  const team = m.team!.rows.map((r) => r.id);
  assert.ok(team.includes('B1.orgs') && team.includes('B6.branches') && team.includes('B0.config'), team.join());
  for (const id of OWN_STEPS) assert.ok(!team.includes(id), id);
  // The walk goes through the person's own steps alone.
  const walked = m.chapters.filter((c) => c.part === 'project').flatMap((c) => c.steps.map((s) => s.id));
  assert.deepEqual(walked, [...OWN_STEPS]);
  assert.equal(m.join, null, 'a project is open: nothing to join');
});

test('Setup in a project set up here is unchanged: no team fold, every project step in This project', () => {
  const m = setupModel(items(), new Set(), true);
  assert.equal(m.team, null);
  assert.equal(m.parts.find((p) => p.part === 'project')!.label, 'This project');
  assert.ok(m.parts.find((p) => p.part === 'project')!.steps.some((s) => s.id === 'B1.orgs'));
});

test('joinedParts with no project steps checked yet still heads the person\'s list, empty', () => {
  const { parts, team } = joinedParts([], 'Acme', () => []);
  assert.deepEqual(parts.map((p) => [p.label, p.steps.length]), [['Join Acme', 0]]);
  assert.deepEqual(team.rows, []);
});

test('Join a team project is offered where no project is set up: no folder open, or one with no settings', () => {
  assert.deepEqual(setupModel([], new Set(), null).join, JOIN_ACTION);
  assert.deepEqual(setupModel([], new Set(), false).join, JOIN_ACTION);
  assert.equal(setupModel([], new Set(), true).join, null);
  assert.equal(JOIN_ACTION.command, JOIN_COMMAND.id);
  assert.equal(JOIN_ACTION.label, 'Join a team project…');
  assert.ok(area.commands!.includes('acc.join') && area.commands!.includes('acc.join.share'), 'the page may ask for both');
});

const project = { root: '/acme', name: 'Acme', config: { github: { repo: 'acme-co/acme-salesforce', account: 'work-account' } } } as unknown as ProjectLike;
const card = (more: Partial<IdentityCard> = {}): IdentityCard => ({
  account: 'jordan-kim', initials: 'JK', from: 'config', projectAccount: 'jordan-kim', signedIn: true, scopes: ['repo', 'project'], projects: true,
  problem: null, pushesAs: 'jordan-kim', commit: null, profile: 'https://github.com/jordan-kim', others: 0, ...more,
});

test('Settings offers Share how to join to whoever set the project up, and not in a clone that joined it, nor before it\'s read', () => {
  const share = (a: ReturnType<typeof githubAccount>) => a.actions.filter((x) => x.command === SHARE_JOIN_COMMAND.id);
  assert.deepEqual(share(githubAccount(project, card())), [shareJoinAction(project)]);
  assert.deepEqual(share(githubAccount(project, card({ joined: true }))), []);
  assert.deepEqual(share(githubAccount(project, null)), []);
  assert.deepEqual(shareJoinAction(project), { command: 'acc.join.share', label: 'Share how to join', icon: 'copy', arg: '/acme', name: 'Copy how a teammate joins Acme', primary: false, disabled: null });
});

test('Share how to join is a command with its params, off with why for a project with no GitHub repo', () => {
  assert.match(SHARE_JOIN_COMMAND.params, /no person.*no secret/);
  assert.deepEqual(SHARE_JOIN_COMMAND.enabled({ repo: 'acme-co/x' }), { ok: true });
  const off = SHARE_JOIN_COMMAND.enabled({ repo: null });
  assert.ok(!off.ok && /no GitHub repo/.test(off.why));
});

test('the join commands are in the Command Palette, and Windows CI runs every join test, skipping none', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { contributes: { commands: { command: string; title: string }[] } };
  const titles = Object.fromEntries(manifest.contributes.commands.map((c) => [c.command, c.title]));
  assert.equal(titles['acc.join'], 'Join a team project');
  assert.equal(titles['acc.join.share'], 'Share how to join this project');
  const files = ['packages/core/test/join.test.ts', 'packages/cli/test/join.test.ts', 'extension/test/join.test.ts'];
  for (const f of files) assert.ok(!WINDOWS_SKIPS.some((s) => s.file === f), f);
  assert.equal(files.length, 3);
});
