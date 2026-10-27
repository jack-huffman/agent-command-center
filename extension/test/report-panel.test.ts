// Report a problem's tab (T-118), in the built extension against the vscode stand-in and a stand-in gh on PATH:
// the command opens the tab with what's attached scrubbed and runs nothing on GitHub; Post runs gh issue create
// on the Command Center's repo with the body on stdin and shows the new issue's link; where gh's account can't
// reach the repo, the tab says so and Copy the issue text puts it on the clipboard. Run after npm run build.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { makeRepo } from '../../packages/core/test/support.ts';
import { RELEASES_REPO } from '../src/model/about.ts';
import { REPORT_COMMAND, type ReportModel } from '../src/model/report.ts';
import { activate, fakeVscode, sandboxEnv, until } from './vscode.ts';

const dist = fileURLToPath(new URL('../dist/extension.js', import.meta.url));
const ISSUE = `https://github.com/${RELEASES_REPO}/issues/12`;

type Tab = ReturnType<typeof fakeVscode>['panels'][number];
const s = {} as { fake: ReturnType<typeof fakeVscode>; started: ReturnType<typeof activate>; repo: string; at: (...p: string[]) => string; restore: () => void };

before(async () => {
  // gh: an issue's create keeps its arguments and its stdin, and prints the link; with the denied file there, it can't reach the repo.
  const { at, restore } = sandboxEnv('acc-report-', (name, at) => (name === 'gh' ? [
    'if [ "$1 $2" = "issue create" ]; then',
    `  printf '%s\\n' "$@" > '${at('gh-args')}'`,
    `  cat > '${at('gh-stdin')}'`,
    `  if [ -f '${at('gh-denied')}' ]; then echo "GraphQL: Could not resolve to a Repository with the name '${RELEASES_REPO}'." >&2; exit 1; fi`,
    `  echo '${ISSUE}'; exit 0`,
    'fi',
    'exit 1',
    '',
  ].join('\n') : 'exit 1\n'));
  s.at = at;
  s.restore = restore;
  s.repo = makeRepo({ '.acc/config.json': JSON.stringify({ schema: 1, project: 'Globex Field Service', profile: 'generic', environments: [{ name: 'main', default: true }], trackers: [] }) });
  s.fake = fakeVscode(s.repo);
  s.started = activate(dist, s.fake, { 'acc.welcomed': true });
  await until(() => s.fake.calls.contexts.get('acc.hasProject') === true, 60_000, 'the project');
});

after(() => {
  s.started?.stop();
  delete createRequire(import.meta.url).cache[dist];
  s.restore();
});

const latest = (tab: Tab): ReportModel | undefined => (tab.posted as { type?: string; model?: ReportModel }[]).filter((m) => m.type === 'state' && m.model?.kind === 'report').at(-1)?.model;

/** Report a problem, as the Command Palette runs it: its tab, ready, and the draft it shows. */
async function open(): Promise<{ tab: Tab; draft: ReportModel }> {
  await s.fake.calls.commands.get(REPORT_COMMAND.id)!();
  const tab = s.fake.panels.find((p) => p.viewType === 'acc.report')!;
  assert.ok(tab, 'the command opens its own tab');
  tab.receive!({ type: 'ready' });
  await until(() => !!latest(tab), 20_000, 'the draft');
  return { tab, draft: latest(tab)! };
}

test('Report a problem opens its tab with what\'s attached, scrubbed, and runs nothing on GitHub before Post', async () => {
  const { tab, draft } = await open();
  assert.equal(tab.title, 'Report a problem');
  assert.ok(tab.html.includes('data-view="report"'), 'the tab draws the report page');
  assert.ok(!existsSync(s.at('gh-args')), 'gh was not asked for an issue');
  for (const line of ['- VSCode: 1.105.1', '- The project\'s profile: generic', '- Setup: ']) assert.ok(draft.attached.includes(line), `${line} isn't in:\n${draft.attached}`);
  assert.ok(!draft.attached.includes(s.repo) && !draft.attached.includes('Globex Field Service'), draft.attached);
});

test('Post runs gh issue create on the Command Center\'s repo with the body on stdin, and the tab shows the link', async () => {
  const { tab } = await open();
  const body = '### What happened\n\nIt broke at /Users/someone, as typed\n';
  tab.receive!({ type: 'report-post', title: 'It broke', body });
  await until(() => latest(tab)?.url === ISSUE, 20_000, 'the link');
  assert.deepEqual(readFileSync(s.at('gh-args'), 'utf8').trim().split('\n'), ['issue', 'create', '--repo', RELEASES_REPO, '--title', 'It broke', '--body-file', '-']);
  assert.equal(readFileSync(s.at('gh-stdin'), 'utf8'), body, 'the body as the page showed it, on stdin');
  assert.equal(latest(tab)!.look?.label, 'Posted');
});

test('where gh\'s account can\'t reach the repo, the tab says so, and Copy the issue text puts it on the clipboard (edge case)', async () => {
  writeFileSync(s.at('gh-denied'), '');
  const { tab } = await open();
  tab.receive!({ type: 'report-post', title: 'T', body: 'B' });
  await until(() => latest(tab)?.copy === true, 20_000, 'Copy the issue text');
  assert.equal(latest(tab)!.look?.tone, 'orange');
  assert.match(latest(tab)!.look!.label, /can't reach the Command Center's repo/);
  tab.receive!({ type: 'report-copy', text: 'T\n\nB' });
  await until(() => s.fake.calls.copied.includes('T\n\nB'), 5_000, 'the clipboard');
  // A message the tab can't send, such as an empty title, posts nothing.
  const before = readFileSync(s.at('gh-stdin'), 'utf8');
  tab.receive!({ type: 'report-post', title: '', body: 'other' });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(readFileSync(s.at('gh-stdin'), 'utf8'), before);
});
