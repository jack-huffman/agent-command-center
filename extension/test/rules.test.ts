// Rules suggested by review findings that keep coming back (GH-102), in Needs you.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { homeModel } from '../src/model/home.ts';
import { isFromWebview } from '../src/model/messages.ts';
import { needsYouCount } from '../src/model/overview.ts';
import { ruleCard } from '../src/model/rules.ts';
import { openReview, ruleArgs } from '../src/rules.ts';
import { sampleSuggestions } from '../scripts/fixtures/rules.ts';
import { hub, pageSource, row } from './support.ts';

const model = (suggest: boolean) => {
  const base = hub();
  const rows = [row('AV-1', 'blocked', 'blocked')];
  return homeModel({ hub: { ...base, agents: [], taskRows: () => rows, ...(suggest ? { suggestions: () => sampleSuggestions() } : {}) }, section: 'overview', boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set() } });
};

test('each suggestion waits in Needs you in a neutral tone with an icon and a label, after the orange items, and never in the badge (GH-102)', () => {
  const m = model(true);
  const items = m.overview.attention;
  const rules = items.filter((a) => a.rule);
  assert.deepEqual(rules.map((a) => [a.look.label, a.look.icon, a.look.tone, a.title, a.detail]), [
    ['Rule suggested', 'law', 'neutral', 'A review finding keeps coming back', 'Acme · Add it as a rule?'],
    ['Check suggested', 'beaker', 'neutral', 'A written rule keeps being broken', 'Acme · Already a rule (CLAUDE.md). It keeps coming back: add a check'],
  ]);
  assert.ok(items.findIndex((a) => a.rule) > items.findLastIndex((a) => a.look.tone === 'orange'), 'after everything orange');
  assert.equal(needsYouCount(m.overview), needsYouCount(model(false).overview), 'the badge is the same without them');
  assert.equal(m.nav[0]!.count, model(false).nav[0]!.count);
});

test('a card carries the drafted line, its counts, the check to begin with, and one link per review it came from (GH-102)', () => {
  const [rule, check] = sampleSuggestions();
  const c = ruleCard('/r', rule!);
  assert.deepEqual([c.line, c.findings, c.tasks, c.must, c.check, c.title], ['Colours come from the theme, never a literal.', 4, 3, 1, 'lint', 'Add the rule: Colours come from the theme, never a literal']);
  assert.equal(c.sources.length, rule!.sources.length, 'one link per finding');
  assert.deepEqual(c.sources.map((s) => [s.task, s.sha, s.where]), rule!.sources.map((s) => [s.task, s.sha, `${s.file}:${s.line}`]));
  const k = ruleCard('/r', check!);
  assert.deepEqual([k.kind, k.written, k.check, k.sources.filter((s) => !s.counted).length], ['check', 'CLAUDE.md', 'gate', 1]);
  assert.equal(ruleCard('/r', { ...rule!, hint: null }).check, 'none', 'no hint: the toggle starts off');
  assert.equal(ruleCard('/r', { ...check!, hint: null }).check, 'any', 'a rule already written always asks for a check');
});

test('the page\'s accept, dismiss and open-review messages are checked, and only accept and dismiss reach acc, each as a person\'s (GH-102)', () => {
  const accept = { type: 'rule-accept', project: '/r', id: 'r-4c0f1e', line: 'Colours come from the theme.', title: 'Add the rule', check: 'lint' };
  const cases: [unknown, boolean][] = [
    [accept, true], [{ ...accept, note: 'See theme.css.' }, true], [{ ...accept, id: 'r-4c0f1' }, false], [{ ...accept, id: '../x' }, false],
    [{ ...accept, line: '  ' }, false], [{ ...accept, line: 'x'.repeat(301) }, false], [{ ...accept, check: 'fuzz' }, false], [{ ...accept, title: '' }, false],
    [{ type: 'rule-dismiss', project: '/r', id: 'w-00aa11' }, true], [{ type: 'rule-dismiss', project: '/r', id: 'x-00aa11' }, false],
    [{ type: 'rule-open-review', project: '/r', task: 'GH-28', sha: '9f1488a9a1933c7a769457b9b2d7b5f75ce4a00a' }, true],
    [{ type: 'rule-open-review', project: '/r', task: '../GH-28', sha: '9f1488a' }, false], [{ type: 'rule-open-review', project: '/r', task: 'GH-28', sha: 'zz/..' }, false],
  ];
  assert.ok(cases.length > 0);
  for (const [m, ok] of cases) assert.equal(isFromWebview(m), ok, JSON.stringify(m));
  assert.deepEqual(ruleArgs({ ...accept, note: ' --as orchestrator ' } as never), ['rules', 'accept', 'r-4c0f1e', '--line=Colours come from the theme.', '--title=Add the rule', '--check=lint', '--note=--as orchestrator', '--json'], 'each text is joined to its option, so none is read as one');
  assert.deepEqual(ruleArgs({ type: 'rule-dismiss', project: '/r', id: 'r-4c0f1e' }), ['rules', 'dismiss', 'r-4c0f1e', '--json']);
});

test('the card opens the draft on Accept, and only Confirm sends it (GH-102)', () => {
  const src = pageSource('rules.ts');
  assert.match(src, /button\('Accept…', 'check', \(\) => \{ remember\(/, 'Accept only opens the draft');
  assert.equal((src.match(/type: 'rule-accept'/g) ?? []).length, 1, 'one place sends an accept: Confirm');
  assert.match(src, /button\('Confirm', 'pass', \(\) => \{[\s\S]*?type: 'rule-accept'/);
});

test('a finding\'s Open the review opens its reviewer\'s session page, from a suggested rule or a task page (T-53); edge cases: no session, or a project not open, open nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acc-open-review-'));
  mkdirSync(join(dir, 'reviews'));
  const verdict = (task: string, sha: string, sessionId: string) => writeFileSync(join(dir, 'reviews', `${task}-${sha}.json`), JSON.stringify({ v: 1, task, sha, env: 'devbox', verdict: 'changes', summary: 's', criteria: [], findings: [], sessionId, name: `Acme · ${task} · review`, at: '2026-10-15T10:00:00Z', durationMs: 1, costUsd: null }));
  verdict('T-9', 'abc1234', 'rv-9');
  verdict('T-8', 'abc1234', '');
  const project = { root: '/r', ledgerPath: join(dir, 'ledger.json') };
  const h = { project: (r: string) => (r === '/r' ? project : undefined), ledger: () => ({ tasks: [{ id: 'T-9', run: { worktree: '/r.worktrees/T-9' } }] }) } as unknown as Parameters<typeof openReview>[0];
  const opened: unknown[][] = [];
  const pages = { open: (...a: unknown[]) => { opened.push(a); } } as unknown as Parameters<typeof openReview>[1];
  openReview(h, pages, { project: '/r', task: 'T-9', sha: 'abc1234' });
  assert.equal(opened.length, 1);
  assert.equal(opened[0]![0], 'rv-9');
  assert.deepEqual(opened[0]![1], { cwd: '/r.worktrees/T-9', kind: 'background', startedAt: Date.parse('2026-10-15T10:00:00Z'), sessionId: 'rv-9', name: 'Acme · T-9 · review' });
  openReview(h, pages, { project: '/r', task: 'T-8', sha: 'abc1234' });
  openReview(h, pages, { project: '/elsewhere', task: 'T-9', sha: 'abc1234' });
  openReview(h, pages, { project: '/r', task: 'T-9', sha: 'fff0000' });
  assert.equal(opened.length, 1, 'a verdict with no session, a project not open and a commit with no verdict open nothing');
  rmSync(dir, { recursive: true, force: true });
});
