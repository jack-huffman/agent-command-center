// An environment branch that moved by anything but acc's merge (GH-69): orange on the Overview, counted as
// needing you, once per repo and branch, with Compare on GitHub and Seen, until a person has seen it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BranchMove } from '../../packages/core/src/branches.ts';
import { moveLook } from '../src/model/branches.ts';
import { homeModel } from '../src/model/home.ts';
import { PAGE_COMMANDS } from '../src/model/messages.ts';
import { needsYouCount } from '../src/model/overview.ts';
import type { HubLike } from '../src/model/shared.ts';
import { hub } from './support.ts';

const home = (h: HubLike) => homeModel({ hub: h, section: 'overview', boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set() } });
const withMoves = (branchMoves: (root: string) => BranchMove[], base = hub()): HubLike => ({ ...base, agents: [], branchMoves });
const items = (m: ReturnType<typeof home>) => m.overview.attention.filter((a) => a.key.startsWith('branch-move:'));
const move = (branch: string, commits: string[]): BranchMove => ({ branch, from: 'aaaaaaa1111', to: 'bbbbbbb2222', at: '2026-10-09T12:00:00Z', commits });

test('a moved environment branch is one orange item under Needs you, naming the commits, with Compare on GitHub first and Seen; the badge counts it', () => {
  const quiet = home(withMoves(() => []));
  assert.equal(items(quiet).length, 0, 'nothing moved: nothing');
  const moved = home(withMoves(() => [move('devbox', ['bbbbbbb Hotfix, see #12', 'ccccccc Bump'])]));
  const [item] = items(moved);
  assert.equal(items(moved).length, 1);
  assert.deepEqual([item!.look.label, item!.look.icon, item!.look.tone], ['Needs you: devbox moved by 2 commits that aren\'t acc\'s merges', 'git-branch', 'orange']);
  assert.equal(item!.title, 'devbox moved on GitHub');
  assert.match(item!.detail, /^Acme · devbox moved from aaaaaaa to bbbbbbb by 2 commits that aren't acc's merges: bbbbbbb Hotfix, see #12, ccccccc Bump\. Look before anything builds on it\.$/);
  assert.equal(item!.tip, 'bbbbbbb Hotfix, see #12\nccccccc Bump', 'every commit in full, on hover');
  assert.deepEqual(item!.actions.map((a) => [a.label, a.command, a.ref.project, a.ref.env, !!a.primary]), [['Compare on GitHub', 'acc.branches.open', '/r', 'devbox', true], ['Seen', 'acc.branches.seen', '/r', 'devbox', false]]);
  assert.equal(needsYouCount(moved.overview), needsYouCount(quiet.overview) + 1, 'it needs a person');
  assert.ok(PAGE_COMMANDS.includes('acc.branches.open') && PAGE_COMMANDS.includes('acc.branches.seen'), 'the page may ask for both');
  // A rewrite: git couldn't list what came in.
  const rewritten = items(home(withMoves(() => [move('devbox', [])])))[0]!;
  assert.equal(rewritten.look.label, 'Needs you: devbox was rewritten');
  assert.match(rewritten.detail, /git couldn't list how: a force push or a rewrite/);
  assert.equal(rewritten.tip, undefined);
  // A hub that can't say, as before GH-69, shows none.
  assert.equal(items(home({ ...hub(), agents: [] })).length, 0);
});

test('without a GitHub section there\'s nothing to compare, so Seen comes first; two projects on one repo get one item per branch between them', () => {
  const base = hub();
  const noGithub: HubLike = { ...withMoves(() => [move('devbox', ['x Hotfix'])], base), projects: [{ ...base.projects[0]!, config: { ...base.projects[0]!.config, github: null } }] };
  assert.deepEqual(items(home(noGithub))[0]!.actions.map((a) => [a.label, !!a.primary]), [['Seen', true]]);
  const second = { ...base.projects[0]!, name: 'Acme UAT', root: '/r2' };
  const two = home({ ...withMoves(() => [move('devbox', ['x Hotfix']), move('sandbox', ['y Bump'])], base), projects: [base.projects[0]!, second] });
  assert.deepEqual(items(two).map((a) => [a.project, a.title]), [['Acme', 'devbox moved on GitHub'], ['Acme', 'sandbox moved on GitHub']], 'one repo, one item per branch');
});

test('moveLook says how many commits, and that a branch was rewritten when git couldn\'t list them', () => {
  assert.equal(moveLook(move('main', ['a x'])).label, 'Needs you: main moved by 1 commit that isn\'t acc\'s merges');
  assert.equal(moveLook(move('main', ['a x', 'b y'])).label, 'Needs you: main moved by 2 commits that aren\'t acc\'s merges');
  assert.equal(moveLook(move('main', [])).label, 'Needs you: main was rewritten');
});
