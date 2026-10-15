// The tidy-up offer on the Overview (GH-104): blue, once per repo, never counted as needing you.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { homeModel } from '../src/model/home.ts';
import { needsYouCount } from '../src/model/overview.ts';
import type { HubLike } from '../src/model/shared.ts';
import { PAGE_COMMANDS } from '../src/model/messages.ts';
import { hub, root } from './support.ts';

type Tidy = ReturnType<NonNullable<HubLike['tidy']>>;
const home = (h: HubLike) => homeModel({ hub: h, section: 'overview', boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set() } });
const withTidy = (tidy: (root: string) => Tidy, base = hub()): HubLike => ({ ...base, agents: [], tidy });
const tidyItems = (m: ReturnType<typeof home>) => m.overview.attention.filter((a) => a.key.startsWith('tidy:'));

test('a repo with a tidy-up due shows one blue item with Draft tidy-up and Not now, and the badge doesn\'t move', () => {
  const quiet = home(withTidy(() => ({ due: false, count: 7, every: 8, ledger: '/r/.git/acc/ledger.json' })));
  const due = home(withTidy(() => ({ due: true, count: 8, every: 8, ledger: '/r/.git/acc/ledger.json' })));
  assert.equal(tidyItems(quiet).length, 0, 'not due: nothing');
  const items = tidyItems(due);
  assert.equal(items.length, 1);
  const [item] = items;
  assert.deepEqual([item!.look.label, item!.look.icon, item!.look.tone, item!.title, item!.project], ['Tidy-up due', 'wand', 'blue', 'Tidy up after 8 merges', 'Acme']);
  assert.match(item!.detail, /^Acme · 8 tasks merged since the last tidy-up\. A tidy-up finds duplicated helpers and comments that contradict the code in the files they changed, and changes no behaviour\.$/);
  assert.deepEqual(item!.actions.map((a) => [a.label, a.command, a.ref.project, !!a.primary]), [['Draft tidy-up', 'acc.tidy.draft', '/r', true], ['Not now', 'acc.tidy.skip', '/r', false]]);
  assert.equal(needsYouCount(due.overview), needsYouCount(quiet.overview), 'an offer, not something that needs you');
  assert.ok(PAGE_COMMANDS.includes('acc.tidy.draft') && PAGE_COMMANDS.includes('acc.tidy.skip'), 'the page may ask for both');
  // A hub that can't say, as before GH-104, shows none.
  assert.equal(tidyItems(home({ ...hub(), agents: [] })).length, 0);
});

test('two projects on one repo\'s ledger get one offer between them; two repos get one each', () => {
  const base = hub();
  const second = { ...base.projects[0]!, name: 'Acme UAT', root: '/r2' };
  const two = (ledgerOf: (root: string) => string) => home({ ...withTidy((root) => ({ due: true, count: 9, every: 8, ledger: ledgerOf(root) }), base), projects: [base.projects[0]!, second] });
  assert.deepEqual(tidyItems(two(() => '/r/.git/acc/ledger.json')).map((a) => a.project), ['Acme'], 'one ledger, one item');
  assert.deepEqual(tidyItems(two((root) => `${root}/.git/acc/ledger.json`)).map((a) => a.project), ['Acme', 'Acme UAT']);
});

test('the hub asks git for a done task\'s branch, so a task merged in git with no pull request brings up the offer, and keeps the answers until the ledger is read again', () => {
  const src = readFileSync(join(root, 'src/hub.ts'), 'utf8');
  assert.match(src, /const inEnvironment = rememberInEnvironment\(branchInEnvironment\(runSync, p\.root\), this\.tasks\.get\(p\.root\)\?\.inEnvironment \?\? new Map\(\)\);\n\s+return \{ \.\.\.tidyDue\(ledger, p\.config, this\.repoTidy\.get\(p\.ledgerPath\) \?\? null, inEnvironment\)/);
  assert.match(src, /this\.tasks\.set\(p\.root, \{ stamp, ledger, rows, inEnvironment: new Map\(\) \}\)/, 'a fresh read of the ledger drops the answers');
});
