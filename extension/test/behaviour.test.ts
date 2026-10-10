import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { Script } from 'node:vm';
import type { HomeModel } from '../src/model/home.ts';
import { isFromWebview } from '../src/model/messages.ts';
import { type BehaviourReport, behaviourData, behaviourPage, CASES, caseFailed, dumpedBehaviour, HELPERS, judgeBehaviour, judgeMutants, MUTANTS, occurrences } from '../scripts/behaviour.ts';
import { FONTS, sampleModel } from '../scripts/screenshot.ts';

const webview = join(import.meta.dirname, '..', 'webview');
const now = Date.UTC(2026, 9, 10, 12);
const models = () => ({ tasks: sampleModel('tasks', now, 'dark'), overview: sampleModel('overview-landing', now, 'dark') });
const ok = (n = 1): BehaviourReport => ({ checks: Array.from({ length: n }, (_, i) => ({ what: `check ${i}`, ok: true })), error: null, sent: [{ type: 'ready' }] });

test('a case passes on a report whose every check held, and its checks are counted', () => {
  const r = judgeBehaviour([{ name: 'a', report: ok(3) }, { name: 'b', report: ok(2) }]);
  assert.deepEqual(r, { failures: [], checks: 5 });
});

test('a run fails on no cases, a case that wrote no report, one that checked nothing, and one stopped on an element it couldn\'t find', () => {
  assert.deepEqual(judgeBehaviour([]).failures, ['No case was run.']);
  assert.deepEqual(judgeBehaviour([{ name: 'a', report: null }]).failures, ['a: the page wrote no report']);
  assert.deepEqual(judgeBehaviour([{ name: 'a', report: { ...ok(0) } }]).failures, ['a: checked nothing']);
  // Not found is a failure, never a skip: the checks before it held, and the case still fails.
  assert.deepEqual(judgeBehaviour([{ name: 'a', report: { ...ok(2), error: 'not found: .fold-toggle' } }]).failures, ['a: stopped: not found: .fold-toggle']);
});

test('a failed check fails its case, saying what it found; one that held says nothing', () => {
  const report: BehaviourReport = { checks: [{ what: 'Escape closes it', ok: false, detail: 'true' }, { what: 'it opens', ok: true }], error: null, sent: [] };
  assert.deepEqual(judgeBehaviour([{ name: 'esc', report }]).failures, ['esc: Escape closes it (found true)']);
  assert.equal(caseFailed(report), true);
  assert.equal(caseFailed(ok()), false);
  // A page that wrote nothing hasn't been seen to fail: it can't count as catching a mutant.
  assert.equal(caseFailed(null), false);
});

test('a message the page sent that the extension wouldn\'t take fails the case, by the extension\'s own check', () => {
  const report = { ...ok(), sent: [{ type: 'ready' }, { type: 'rule-accept', project: '/r', id: 'not an id' }] };
  const r = judgeBehaviour([{ name: 'a', report }]);
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0]!, /^a: the page sent a message the extension wouldn't take: \{"type":"rule-accept"/);
});

test('the report is read from the page Chrome dumped, and a page that never wrote one gives none', () => {
  const report = ok(2);
  assert.deepEqual(dumpedBehaviour(`<body><main></main><script type="application/json" id="acc-behaviour">${JSON.stringify(report)}</script></body>`), report);
  assert.equal(dumpedBehaviour('<body><main></main></body>'), null);
});

test('a mutant is caught only when every case it names ran and failed; one that no longer fits its source, or names nothing, fails the run', () => {
  const m = MUTANTS[0]!;
  const failed: BehaviourReport = { ...ok(), checks: [{ what: 'Escape closes it', ok: false }] };
  const runs = (report: BehaviourReport | null) => m.kills.map((name) => ({ name, report }));
  assert.deepEqual(judgeMutants([{ mutant: m, applied: 1, runs: runs(failed) }]), []);
  assert.match(judgeMutants([{ mutant: m, applied: 1, runs: runs(ok()) }])[0]!, /passed with the behaviour broken/);
  assert.match(judgeMutants([{ mutant: m, applied: 1, runs: runs(null) }])[0]!, /wrote no report/);
  assert.match(judgeMutants([{ mutant: m, applied: 0, runs: [] }])[0]!, /0 times, not once/);
  assert.match(judgeMutants([{ mutant: m, applied: 2, runs: [] }])[0]!, /2 times, not once/);
  assert.deepEqual(judgeMutants([{ mutant: { ...m, kills: [] }, applied: 1, runs: [] }]), [`Mutant "${m.name}" names no case.`]);
  assert.deepEqual(judgeMutants([]), ['No mutant was run.']);
});

test('each mutant\'s change is in its webview source exactly once, changes it, and names cases that exist', () => {
  assert.ok(MUTANTS.length >= CASES.length, 'a mutant for each case at least');
  const names = new Set(CASES.map((c) => c.name));
  for (const m of MUTANTS) {
    const src = readFileSync(join(webview, m.file), 'utf8');
    assert.equal(occurrences(src, m.find), 1, `${m.name}: its change should be in ${m.file} once`);
    assert.notEqual(m.find, m.replace, `${m.name} changes nothing`);
    assert.ok(m.kills.length > 0, `${m.name} names no case`);
    for (const k of m.kills) assert.ok(names.has(k), `${m.name} names ${k}, which isn't a case`);
  }
  assert.equal(occurrences('abc', ''), 0, 'an empty change is in no source');
});

test('every case is named by a mutant that breaks what it checks, so none passes on a stub', () => {
  const killed = new Set(MUTANTS.flatMap((m) => m.kills));
  assert.deepEqual(CASES.filter((c) => !killed.has(c.name)).map((c) => c.name), []);
  assert.equal(new Set(CASES.map((c) => c.name)).size, CASES.length, 'two cases share a name');
});

test('the cases cover what the ticket lists: Escape, the backdrop, focus back, a redraw under it, a fold, Show all, Previous and Next, and Accept', () => {
  const said = CASES.map((c) => c.name).join('\n');
  for (const [modal, what] of [['task', /Escape/], ['task', /backdrop/], ['task', /focus back to its card, found again after the board redrew/], ['task', /new board model under it leaves it open, scrolled and typed in/], ['task', /fold/],
    ['detail', /Escape/], ['detail', /backdrop/], ['detail', /new model under it leaves it open/], ['detail', /Show all opens the whole list/], ['detail', /Previous and Next/], ['detail', /Accept/]] as const) {
    assert.ok(CASES.some((c) => c.name.startsWith(`${modal} modal`) && what.test(c.name)), `no ${modal} modal case for ${what}\n${said}`);
  }
});

test('what the cases expect comes from the same fixtures the pages draw: ten rules, each Accept a message the extension takes, a list longer than its page shows', () => {
  const d = behaviourData(models(), now);
  assert.equal(d.rules.length, 10);
  assert.ok(d.rules.every((r) => isFromWebview(r.accept)), 'every Accept the cases expect is one the extension takes');
  assert.deepEqual(Object.keys(d.rules[1]!.accept), ['type', 'project', 'id', 'line', 'title', 'check']);
  assert.ok((d.rules[1]?.sources ?? 0) > 4, 'the second rule has more reviews than its fold shows');
  assert.deepEqual(d.list, { key: 'needs-you', title: 'Needs you', shown: 5, total: 17 });
  assert.equal(d.rulesOpens, '{"kind":"rules"}');
  assert.deepEqual([d.task.key, (d.task.message.model as { kind: string }).kind, d.task.peek], ['ACME-12', 'ticket', '/Users/me/code/acme-service#ACME-12']);
  // The Tasks board the cases open holds the card they click.
  assert.ok(JSON.stringify(models().tasks).includes('"ACME-12"'));
});

test('an Overview with no list longer than its page fails the oracle, not the cases', () => {
  const m = models();
  const home = m.overview as HomeModel;
  const overview: HomeModel = { ...home, overview: { ...home.overview, landing: [] } };
  assert.throws(() => behaviourData({ ...m, overview }, now), /no list with more than its page shows/);
});

test('each case\'s page is script the browser can parse: its helpers and case, with no string from the model able to close it', () => {
  const d = behaviourData(models(), now);
  for (const c of CASES) {
    const html = behaviourPage(c, c.page === 'tasks' ? models().tasks : models().overview, d, FONTS);
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]!);
    assert.equal(inline.length, 1, `${c.name}: one inline script`);
    assert.doesNotThrow(() => new Script(inline[0]!), `${c.name}: its script parses`);
    for (const h of HELPERS) assert.ok(inline[0]!.includes(`const ${h.name} = `), `${c.name}: has ${h.name}`);
    assert.ok(inline[0]!.includes('const RUN = async function'), `${c.name}: has its case`);
    // No type annotation survives into the page: Node stripped them.
    assert.doesNotMatch(inline[0]!, /: Probe\b|<HTMLDialogElement>/);
  }
  assert.match(behaviourPage(CASES[0]!, { kind: 'home', title: '</script><b>' } as never, d, FONTS), /\\u003c\/script>\\u003cb>/);
});

test('a run of every tab checks the modals\' behaviour too, and --behaviour runs it alone', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'scripts', 'screenshot.ts'), 'utf8');
  assert.match(src, /const behaviour = positionals\.length \? 0 : await behaviourRun\(chrome\);/);
  assert.match(src, /if \(values\.behaviour\) \{[\s\S]*?return behaviourRun\(chrome\);/);
  assert.match(src, /return behaviour;\n\}/);
});
