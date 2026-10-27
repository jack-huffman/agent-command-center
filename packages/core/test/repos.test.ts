// The repos acc has set up on this machine (GH-81), and which of them uses an epic, a label, an area path
// or a group already. Every test keeps its list in a temporary file (ACC_REPOS_FILE), never ~/.acc.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseConfig, type Tracker } from '../src/config.ts';
import { gitCommonDir, hostsInUse, listedRepos, rememberRepo, repoIdentity, type RepoInUse, reposFile, reposInUse, usedBy } from '../src/repos.ts';
import { gitIn, makeRepo, tempDir } from './support.ts';

const envFor = () => ({ ACC_REPOS_FILE: join(tempDir('acc-repos-'), 'repos.json') });
const tracker = (t: Partial<Tracker> & Pick<Tracker, 'kind'>): Tracker => ({ site: null, project: null, repo: null, organization: null, account: null, workspace: null, channel: null, reaction: null, doneReaction: null, team: null, board: null, statusColumn: null, prefix: null, skipLabels: [], epics: [], sprint: null, queue: null, labels: [], areaPath: null, group: null, edits: false, statusFor: null, changesField: null, ...t });
const repo = (name: string, key: string, trackers: Tracker[], github: string | null = null): RepoInUse => ({ root: `/code/${name}`, name, key, github, trackers });
const OWN = { root: '/code/acme-service', key: 'github:acme/service' };
const SITE = 'acme.atlassian.net';

test('the list holds roots only, in a file of its own, and a repo whose config is gone drops out', () => {
  const env = envFor();
  assert.equal(reposFile(env), env.ACC_REPOS_FILE);
  assert.deepEqual(listedRepos(env), [], 'no file is no repos');
  const config = JSON.stringify({ schema: 1, project: 'acme-portal', environments: [{ name: 'main', default: true }], trackers: [{ kind: 'jira', site: SITE, project: 'ACME', epic: 'ACME-3' }] });
  const a = makeRepo({ '.acc/config.json': config });
  const b = makeRepo({ '.acc/config.json': config.replace('acme-portal', 'acme-billing') });
  assert.equal(rememberRepo(a, env), true);
  assert.equal(rememberRepo(a, env), false, 'listed already: nothing written');
  assert.equal(rememberRepo(b, env), true);
  assert.deepEqual(listedRepos(env), [a, b]);
  // Loading the projects again remembers each: one listed already stays where it is, and nothing is written.
  const written = statSync(env.ACC_REPOS_FILE).ino;
  assert.deepEqual([rememberRepo(a, env), rememberRepo(b, env), rememberRepo(a, env)], [false, false, false]);
  assert.deepEqual(listedRepos(env), [a, b], 'not moved to the end');
  assert.equal(statSync(env.ACC_REPOS_FILE).ino, written, 'the file wasn\'t replaced');
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(env.ACC_REPOS_FILE, 'utf8'))), ['schema', 'repos'], 'roots, never a copy of a config');
  assert.deepEqual(reposInUse(env).map((r) => [r.name, r.trackers.map((t) => t.epics)]), [['acme-portal', [['ACME-3']]], ['acme-billing', [['ACME-3']]]], 'each config read now');

  writeFileSync(join(b, '.acc', 'config.json'), '{ not json');
  assert.deepEqual(reposInUse(env).map((r) => r.name), ['acme-portal'], 'a config that can\'t be read is skipped');
  rmSync(b, { recursive: true });
  assert.deepEqual(reposInUse(env).map((r) => r.name), ['acme-portal'], 'a repo that\'s gone is skipped');
  const c = makeRepo({ '.acc/config.json': config });
  rememberRepo(c, env);
  assert.deepEqual(listedRepos(env), [a, c], 'and dropped when the list is next written');

  writeFileSync(env.ACC_REPOS_FILE, '[broken');
  assert.deepEqual(listedRepos(env), [], 'a list that can\'t be read is empty');
  const unwritable = { ACC_REPOS_FILE: join(a, 'README.md', 'repos.json') };
  assert.equal(rememberRepo(a, unwritable), false, 'a list that can\'t be written fails nothing');
});

test('a clone or worktree is the same repo: by its GitHub repo, else by the git directory they share', () => {
  const main = makeRepo();
  gitIn(main, 'worktree', 'add', '-q', join(main, '.claude', 'worktrees', 'GH-1'), '-b', 'task/GH-1');
  const wt = join(main, '.claude', 'worktrees', 'GH-1');
  assert.equal(gitCommonDir(wt), realpathSync(join(main, '.git')));
  assert.equal(repoIdentity(wt, null), repoIdentity(main, null));
  assert.equal(repoIdentity(main, { repo: 'Acme/Service' }), 'github:acme/service');
  const plain = tempDir();
  mkdirSync(join(plain, 'x'));
  assert.equal(repoIdentity(plain, null), `git:${plain}`, 'not git: its root');
});

test('used by: the same epic, label, group, or an area path over or under, in another repo; never this repo or a clone of it', () => {
  const repos = [
    repo('acme-portal', 'github:acme/portal', [tracker({ kind: 'jira', site: SITE, project: 'ACME', epics: ['ACME-3'] })]),
    repo('acme-portal-clone', 'github:acme/service', [tracker({ kind: 'jira', site: SITE, project: 'ACME', epics: ['ACME-5', 'ACME-7'] })]),
    repo('acme-labels', 'git:/code/acme-labels/.git', [tracker({ kind: 'github', repo: 'acme/service', labels: ['Billing'] })]),
    repo('acme-own-labels', 'github:acme/web', [tracker({ kind: 'github', labels: ['billing'] })], 'acme/web'),
    repo('crm-billing', 'github:acme/crm', [tracker({ kind: 'azure', organization: 'acme', project: 'CRM', areaPath: 'CRM\\Billing' })]),
    repo('crm-invoices', 'github:acme/invoices', [tracker({ kind: 'azure', organization: 'acme', project: 'CRM', areaPath: 'CRM\\Billing\\Invoices' })]),
    repo('acme-monday', 'github:acme/monday', [tracker({ kind: 'monday', account: 'acme', board: 111, group: 'topics' })]),
    { ...repo('this-one', 'git:elsewhere', [tracker({ kind: 'jira', site: SITE, project: 'ACME', epics: ['ACME-9'] })]), root: OWN.root },
  ];
  const cases: [Parameters<typeof usedBy>[1], string | null][] = [
    [{ kind: 'jira', host: SITE, value: 'ACME-3' }, 'used by acme-portal'],
    [{ kind: 'jira', host: 'ACME.atlassian.net', value: 'acme-3' }, 'used by acme-portal'],
    [{ kind: 'jira', host: 'other.atlassian.net', value: 'ACME-3' }, null],
    [{ kind: 'jira', host: SITE, value: 'ACME-7' }, null],
    [{ kind: 'jira', host: SITE, value: 'ACME-9' }, null],
    [{ kind: 'jira', host: SITE, value: 'ACME-4' }, null],
    [{ kind: 'github', host: 'acme/service', value: 'billing' }, 'used by acme-labels'],
    [{ kind: 'github', host: 'acme/web', value: 'BILLING' }, 'used by acme-own-labels'],
    [{ kind: 'github', host: 'acme/other', value: 'billing' }, null],
    [{ kind: 'azure', host: 'acme', project: 'CRM', value: 'CRM\\Billing' }, 'used by crm-billing; overlaps crm-invoices'],
    [{ kind: 'azure', host: 'acme', project: 'crm', value: 'CRM' }, 'overlaps crm-billing or crm-invoices'],
    [{ kind: 'azure', host: 'acme', project: 'CRM', value: 'CRM\\Billing\\Invoices\\EU' }, 'overlaps crm-billing or crm-invoices'],
    [{ kind: 'azure', host: 'acme', project: 'CRM', value: 'CRM\\Bill' }, null],
    [{ kind: 'azure', host: 'acme', project: 'Sales', value: 'CRM\\Billing' }, null],
    [{ kind: 'monday', host: 'acme', board: '111', value: 'topics' }, 'used by acme-monday'],
    [{ kind: 'monday', host: 'acme', board: '222', value: 'topics' }, null],
  ];
  let checked = 0;
  for (const [c, want] of cases) {
    assert.equal(usedBy(repos, c, OWN)?.words ?? null, want, JSON.stringify(c));
    checked++;
  }
  assert.equal(checked, 16);
  assert.deepEqual(usedBy(repos, { kind: 'azure', host: 'acme', project: 'CRM', value: 'CRM' }, OWN), { names: ['crm-billing', 'crm-invoices'], overlap: true, words: 'overlaps crm-billing or crm-invoices' });
  // A clone listed twice (main checkout and a worktree) is one repo.
  const twice = [repo('acme-portal', 'github:acme/portal', [tracker({ kind: 'jira', site: SITE, project: 'ACME', epics: ['ACME-3'] })]), { ...repo('acme-portal', 'github:acme/portal', [tracker({ kind: 'jira', site: SITE, project: 'ACME', epics: ['ACME-3'] })]), root: '/code/acme-portal/.claude/worktrees/GH-2' }];
  assert.equal(usedBy(twice, { kind: 'jira', host: SITE, value: 'ACME-3' }, OWN)?.words, 'used by acme-portal');
});

test('the hosts other repos use, the most used first, to find a sign-in every project shares', () => {
  const repos = [
    repo('a', 'k:a', [tracker({ kind: 'jira', site: 'globex.atlassian.net', project: 'G' })]),
    repo('b', 'k:b', [tracker({ kind: 'jira', site: SITE, project: 'A' }), tracker({ kind: 'azure', organization: 'Acme', project: 'CRM' })]),
    repo('c', 'k:c', [tracker({ kind: 'jira', site: 'Acme.atlassian.net', project: 'B' })]),
  ];
  assert.deepEqual(hostsInUse(repos, 'jira'), [SITE, 'globex.atlassian.net']);
  assert.deepEqual(hostsInUse(repos, 'azure'), ['acme']);
  assert.deepEqual(hostsInUse(repos, 'github'), []);
});

test('a repo listed is read as acc reads its config: its own GitHub repo names a GitHub tracker\'s', () => {
  const env = envFor();
  const root = makeRepo({ '.acc/config.json': JSON.stringify({ schema: 1, project: 'acme-web', github: { repo: 'acme/web', account: 'jordan-kim' }, environments: [{ name: 'main', default: true }], trackers: [{ kind: 'github', labels: ['billing'] }] }) });
  rememberRepo(root, env);
  const [r] = reposInUse(env);
  assert.deepEqual([r!.key, r!.github, r!.trackers[0]!.labels], ['github:acme/web', 'acme/web', ['billing']]);
  assert.equal(parseConfig({ schema: 1, project: 'x', environments: [{ name: 'main', default: true }] }).config!.trackers.length, 0);
  assert.equal(usedBy([r!], { kind: 'github', host: 'acme/web', value: 'billing' }, OWN)?.words, 'used by acme-web');
});

test('edge case: a listed root is kept when it is absolute on this system, a Windows drive path on Windows too, and a relative one never', () => {
  const env = envFor();
  writeFileSync(env.ACC_REPOS_FILE, JSON.stringify({ schema: 1, repos: ['/Users/jordan/acme', 'C:\\Users\\jordan\\acme', 'acme', 7] }));
  assert.deepEqual(listedRepos(env), process.platform === 'win32' ? ['/Users/jordan/acme', 'C:\\Users\\jordan\\acme'] : ['/Users/jordan/acme']);
});
