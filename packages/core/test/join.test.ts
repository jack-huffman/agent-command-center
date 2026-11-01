// Join a team project (join.ts, T-176): the address, who can read it, the folder, the clone pinned to its
// person in that clone only, Setup's own steps, and the text Share how to join copies.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { AccError, run, type Runner, type RunResult } from '../src/exec.ts';
import { CLONE_ACCOUNT_KEY, githubIdentity, JOINED_KEY } from '../src/github.ts';
import {
  accountIdentity, addressProblem, defaultJoinDir, isJoined, JOIN_COMMAND, JOIN_TITLE, joinEnabled, joinPlan, joinProject, joinReaders, joinText, OWN_STEPS,
  parseRepoAddress, pinnedHelper, TEAM_STEPS_TITLE,
} from '../src/join.ts';
import { makeContext } from '../src/onboarding/helpers.ts';
import { runSteps, STEPS } from '../src/onboarding/steps.ts';
import { PRODUCTION_NOT_HERE } from '../src/sf-discovery.ts';
import { bad, fakeRunner, gitIn, makeRepo, ok, SF_CONFIG, sf, tempDir } from './support.ts';

const ADDRESS = 'https://github.com/acme-co/acme-salesforce';
const STATUS = 'github.com\n  ✓ Logged in to github.com account jordan-kim (keyring)\n  - Active account: true\n  ✓ Logged in to github.com account acme-bot (keyring)\n  - Active account: false\n';

/** gh with two accounts: jordan-kim, and acme-bot; readable lists the ones that can read the repo. */
function gh(readable: string[], status = STATUS): Record<string, RunResult | ((o?: { env?: NodeJS.ProcessEnv }) => RunResult)> {
  return {
    'gh auth status --hostname github.com': ok(status),
    'gh auth token -u jordan-kim --hostname github.com': ok('tok-jordan'),
    'gh auth token -u acme-bot --hostname github.com': ok('tok-bot'),
    'gh api repos/acme-co/acme-salesforce --jq .full_name': (o) => {
      const who = o?.env?.GH_TOKEN === 'tok-jordan' ? 'jordan-kim' : o?.env?.GH_TOKEN === 'tok-bot' ? 'acme-bot' : '';
      return readable.includes(who) ? ok('acme-co/acme-salesforce') : bad('HTTP 404: Not Found');
    },
    'gh api user': (o) => ok(JSON.stringify(o?.env?.GH_TOKEN === 'tok-bot' ? { id: 7, login: 'acme-bot', name: null } : { id: 42, login: 'jordan-kim', name: 'Jordan Kim' })),
  };
}

/** A runner whose git clone copies a real local repo, as GitHub would hand it over; every other git is real. */
function cloning(source: string, fixtures: ReturnType<typeof gh>, calls: string[] = [], cloneFails = false): Runner {
  const fake = fakeRunner(fixtures, calls);
  return (cmd, args, opts) => {
    if (cmd === 'git' && args.includes('clone')) {
      calls.push(['git', ...args].join(' '));
      if (cloneFails) {
        mkdirSync(args[args.length - 1]!, { recursive: true });
        return bad('fatal: Authentication failed');
      }
      return run('git', ['clone', '-q', source, args[args.length - 1]!]);
    }
    return fake(cmd, args, opts);
  };
}

/** A global git config of the test's own, so a join that wrote there would show. */
function ownGlobal(): { file: string; restore: () => void } {
  const file = join(tempDir('global-'), 'gitconfig');
  writeFileSync(file, '');
  const before = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = file;
  return { file, restore: () => { if (before === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = before; } };
}

const source = () => makeRepo({ '.acc/config.json': JSON.stringify(SF_CONFIG, null, 2) });

test('a GitHub address in each form people paste is read, and anything else is none', () => {
  for (const a of [ADDRESS, `${ADDRESS}.git`, `${ADDRESS}/`, `${ADDRESS}/tree/main`, 'git@github.com:acme-co/acme-salesforce.git', `  ${ADDRESS}  `]) {
    assert.deepEqual(parseRepoAddress(a), { owner: 'acme-co', repo: 'acme-salesforce', slug: 'acme-co/acme-salesforce', url: 'https://github.com/acme-co/acme-salesforce.git' }, a);
  }
  for (const a of ['', 'acme-co/acme-salesforce', 'https://gitlab.com/acme-co/x', 'https://github.com/acme-co', 'https://github.com/-bad/x', 'https://github.com/a/..']) {
    assert.equal(parseRepoAddress(a), null, a);
    assert.match(addressProblem(a)!, /GitHub repo's address/);
  }
  assert.equal(addressProblem(ADDRESS), null);
});

test('the clone goes under Documents by default: This PC\'s on Windows, the home folder\'s on a Mac', () => {
  assert.equal(defaultJoinDir('acme-salesforce', 'darwin', { HOME: '/Users/jordan' }), '/Users/jordan/Documents/acme-salesforce');
  assert.equal(defaultJoinDir('acme-salesforce', 'win32', { USERPROFILE: 'C:\\Users\\jordan' }), 'C:\\Users\\jordan\\Documents\\acme-salesforce');
});

test('Join a team project is a command with an id and params, and waits with a reason while gh is missing or a join runs', () => {
  assert.equal(JOIN_COMMAND.id, 'acc.join');
  assert.match(JOIN_COMMAND.params, /address/);
  assert.equal(JOIN_COMMAND.enabled, joinEnabled);
  assert.deepEqual(joinEnabled({ gh: true, joining: false }), { ok: true });
  assert.deepEqual(joinEnabled({ gh: null, joining: false }), { ok: true }, 'not known yet: acc says so if it is missing');
  const missing = joinEnabled({ gh: false, joining: false });
  assert.ok(!missing.ok && /GitHub CLI isn't installed/.test(missing.why));
  const busy = joinEnabled({ gh: true, joining: true });
  assert.ok(!busy.ok && /being joined now/.test(busy.why));
  assert.equal(JOIN_TITLE, 'Join a team project');
});

test('only the accounts that can read the repo are its readers, each asked with its own token; none when gh isn\'t installed', () => {
  const addr = parseRepoAddress(ADDRESS)!;
  assert.deepEqual(joinReaders(fakeRunner(gh(['acme-bot'])), addr), ['acme-bot']);
  assert.deepEqual(joinReaders(fakeRunner(gh(['jordan-kim', 'acme-bot'])), addr), ['jordan-kim', 'acme-bot']);
  assert.deepEqual(joinReaders(fakeRunner(gh([])), addr), []);
  assert.equal(joinReaders(fakeRunner({}), addr), null, 'gh missing');
});

test('acc join refuses an address no account can read, with a reason, and makes no folder', () => {
  const dir = join(tempDir('join-'), 'acme-salesforce');
  assert.throws(() => joinPlan({ address: ADDRESS, dir, run: fakeRunner(gh([])) }), (e: AccError) => e.code === 'refused' && /can read acme-co\/acme-salesforce.*No folder was made/.test(e.message));
  assert.throws(() => joinProject({ address: ADDRESS, dir, run: fakeRunner(gh([])) }), /No GitHub account signed in on this machine can read/);
  assert.equal(existsSync(dir), false);
  assert.throws(() => joinProject({ address: 'https://gitlab.com/a/b', dir, run: fakeRunner(gh([])) }), (e: AccError) => e.code === 'usage');
  assert.throws(() => joinProject({ address: ADDRESS, dir, run: fakeRunner({}) }), (e: AccError) => e.code === 'no-gh');
  assert.equal(existsSync(dir), false);
});

test('two accounts that can read it, with none named, are refused for a choice; one named that can\'t is refused', () => {
  const dir = join(tempDir('join-'), 'acme-salesforce');
  const both = fakeRunner(gh(['jordan-kim', 'acme-bot']));
  assert.deepEqual(joinPlan({ address: ADDRESS, dir, run: both }), { address: parseRepoAddress(ADDRESS), readers: ['jordan-kim', 'acme-bot'], account: null, dir });
  assert.throws(() => joinProject({ address: ADDRESS, dir, run: both }), (e: AccError) => e.code === 'choose' && /jordan-kim, acme-bot/.test(e.message));
  assert.throws(() => joinPlan({ address: ADDRESS, dir, account: 'someone', run: both }), (e: AccError) => e.code === 'refused' && /someone can't read/.test(e.message));
  assert.equal(joinPlan({ address: ADDRESS, dir, account: 'ACME-BOT', run: both }).account, 'acme-bot', 'named in another case');
  assert.equal(existsSync(dir), false);
});

test('a folder that holds files already is refused; an empty one is not', () => {
  const full = tempDir('join-full-');
  writeFileSync(join(full, 'notes.txt'), 'mine');
  assert.throws(() => joinPlan({ address: ADDRESS, dir: full, run: fakeRunner(gh(['jordan-kim'])) }), /holds files already/);
  const empty = tempDir('join-empty-');
  assert.equal(joinPlan({ address: ADDRESS, dir: empty, run: fakeRunner(gh(['jordan-kim'])) }).dir, empty);
});

test('a join clones as the account that can read it, and sets the identity and account in that clone only, never the global config', () => {
  const g = ownGlobal();
  try {
    const dir = join(tempDir('join-'), 'acme-salesforce');
    const calls: string[] = [];
    const joined = joinProject({ address: ADDRESS, dir, run: cloning(source(), gh(['acme-bot']), calls) });
    assert.deepEqual(joined, { dir, repo: 'acme-co/acme-salesforce', account: 'acme-bot', identity: { name: 'acme-bot', email: '7+acme-bot@users.noreply.github.com' }, project: 'Acme' });
    // The clone itself used the reader's token, pinned on the command line, not any git config.
    const clone = calls.find((c) => c.includes(' clone '))!;
    assert.ok(clone.includes(`credential.helper=${pinnedHelper('acme-bot')}`), clone);
    assert.ok(clone.endsWith(`clone -- https://github.com/acme-co/acme-salesforce.git ${dir}`), clone);
    // Every git config the join wrote was this clone's own.
    const writes = calls.filter((c) => c.startsWith('git config'));
    assert.ok(writes.length >= 6, writes.join('\n'));
    for (const w of writes) assert.ok(w.startsWith('git config --local '), w);
    assert.equal(gitIn(dir, 'config', '--local', 'user.name'), 'acme-bot');
    assert.equal(gitIn(dir, 'config', '--local', 'user.email'), '7+acme-bot@users.noreply.github.com');
    assert.equal(gitIn(dir, 'config', '--local', CLONE_ACCOUNT_KEY), 'acme-bot');
    assert.match(gitIn(dir, 'config', '--local', '--get-all', 'credential.helper'), /acc\.githubAccount/);
    assert.equal(gitIn(dir, 'config', '--local', JOINED_KEY), 'true');
    assert.equal(readFileSync(g.file, 'utf8'), '', 'the global git config is untouched');
    assert.equal(isJoined(run, dir), true);
    assert.equal(githubIdentity(SF_CONFIG as never, dir, fakeRunner(gh(['acme-bot'])))!.joined, true);
  } finally {
    g.restore();
  }
});

test('the identity falls back to the login when GitHub gives no name, and a failed answer still names the account', () => {
  assert.deepEqual(accountIdentity(fakeRunner(gh(['jordan-kim'])), 'jordan-kim'), { name: 'Jordan Kim', email: '42+jordan-kim@users.noreply.github.com' });
  assert.deepEqual(accountIdentity(fakeRunner({}), 'jordan-kim'), { name: 'jordan-kim', email: 'jordan-kim@users.noreply.github.com' });
});

test('a clone that fails takes away the folder it made, and says why', () => {
  const dir = join(tempDir('join-'), 'acme-salesforce');
  assert.throws(() => joinProject({ address: ADDRESS, dir, run: cloning(source(), gh(['jordan-kim']), [], true) }), (e: AccError) => e.code === 'git' && /Authentication failed/.test(e.message));
  assert.equal(existsSync(dir), false);
});

test('a repo set up here isn\'t joined, and one with no settings yet joins with no project name', () => {
  const g = ownGlobal();
  try {
    assert.equal(isJoined(run, makeRepo()), false);
    const dir = join(tempDir('join-'), 'bare');
    assert.equal(joinProject({ address: ADDRESS, dir, run: cloning(makeRepo(), gh(['jordan-kim'])) }).project, null);
    assert.match(gitIn(dir, 'config', '--local', '--get-all', 'credential.helper'), /echo jordan-kim/, 'with no settings, the account falls back to the joiner\'s');
  } finally {
    g.restore();
  }
});

test('each person\'s own steps are Setup steps, and the team\'s heading names them', () => {
  const ids = STEPS.map((s) => s.id);
  for (const id of OWN_STEPS) assert.ok(ids.includes(id), id);
  assert.deepEqual([...OWN_STEPS], ['A4.plugin', 'B2.identity', 'B2.account', 'B2.credentials', 'B6.org-match', 'B10.merge-floors', 'B14.tickets']);
  assert.ok(!OWN_STEPS.includes('B1.orgs'), 'listing the orgs is the project\'s');
  assert.equal(TEAM_STEPS_TITLE, 'Set up by your team');
});

/** A Salesforce project someone else set up, joined: its clone marked, with the joiner's own identity. */
function joinedRepo(identity = true): string {
  const repo = makeRepo({ '.acc/config.json': JSON.stringify(SF_CONFIG, null, 2) });
  for (const b of ['production', 'uat', 'dev']) gitIn(repo, 'branch', b);
  gitIn(repo, 'config', JOINED_KEY, 'true');
  if (identity) {
    gitIn(repo, 'config', 'user.name', 'Jordan Kim');
    gitIn(repo, 'config', 'user.email', '42+jordan-kim@users.noreply.github.com');
  } else {
    gitIn(repo, 'config', '--unset', 'user.name');
    gitIn(repo, 'config', '--unset', 'user.email');
  }
  return repo;
}

const steps = (repo: string, fixtures: Record<string, RunResult>, ids: string[]) =>
  Object.fromEntries(runSteps(makeContext(repo, fakeRunner(fixtures), { ...process.env, GIT_CONFIG_NOSYSTEM: '1' }), 'project', ids).map(({ step, result }) => [step.id, result]));

test('in a joined clone the commit identity is the person\'s own, and one with none fails with a fix for that clone only', () => {
  const r = steps(joinedRepo(), {}, ['B2.identity'])['B2.identity']!;
  assert.equal(r.status, 'pass', r.detail);
  assert.match(r.detail, /Jordan Kim <42\+jordan-kim@users\.noreply\.github\.com>, your own, in this clone only/);
  const none = steps(joinedRepo(false), {}, ['B2.identity'])['B2.identity']!;
  assert.equal(none.status, 'fail');
  assert.match(none.fix!, /git config --local user\.name/);
  assert.doesNotMatch(none.fix!, /--global/);
});

test('a joined Salesforce project asks for no Production login: the org step passes without it', () => {
  const r = steps(joinedRepo(), {
    'sf org display -o Acme Production': sf(null, 1),
    'sf org display -o Acme UAT': sf({ instanceUrl: 'https://acme--uat.sandbox.my.salesforce.com' }),
    'sf org display -o Acme Dev': sf({ instanceUrl: 'https://acme--dev.sandbox.my.salesforce.com' }),
  }, ['B6.org-match'])['B6.org-match']!;
  assert.equal(r.status, 'pass', r.detail);
  assert.ok(r.detail.startsWith(`production: ${PRODUCTION_NOT_HERE}`), r.detail);
});

test('Share how to join copies the address and three steps, with no person\'s name and no secret; none without a repo', () => {
  const text = joinText(SF_CONFIG as never)!;
  assert.match(text, /https:\/\/github\.com\/acme-co\/acme-salesforce/);
  assert.equal(text.split('\n').filter((l) => /^\d\. /.test(l)).length, 3);
  assert.match(text, /Install the Agent Command Center extension/);
  assert.match(text, /Run "Join a team project"/);
  assert.match(text, /Paste the repo's address/);
  for (const secret of [SF_CONFIG.github.account, SF_CONFIG.commitIdentity.name, SF_CONFIG.commitIdentity.email, 'token', 'password']) assert.ok(!text.toLowerCase().includes(secret.toLowerCase()), secret);
  assert.equal(joinText({ github: null }), null);
});
