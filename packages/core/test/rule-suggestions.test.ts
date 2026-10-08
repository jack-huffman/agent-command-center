import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseConfig } from '../src/config.ts';
import { run } from '../src/exec.ts';
import { readLedger } from '../src/ledger.ts';
import { repoPaths, type RepoPaths } from '../src/paths.ts';
import { knownKinds, parseReview, readVerdicts, reviewPrompt, type Finding } from '../src/review.ts';
import {
  acceptSuggestion, checkHint, dismissSuggestion, draftRuleTask, findingKey, groupFindings, readFindings, readSuggestionRecords, ruleHead, type Suggestion, suggestRules, wordingText,
} from '../src/rule-suggestions.ts';
import { GENERIC_CONFIG, makeRepo, tempDir } from './support.ts';

const config = parseConfig(JSON.parse(JSON.stringify(GENERIC_CONFIG))).config!;
let clock = new Date('2026-10-08T12:00:00Z');
const now = () => clock;

/**
 * Every cite of "Look at UI changes before shipping them" in this repo's own reviews, with the task and file
 * each was on: copied from .git/acc/reviews on 2026-10-08 (GH-102). They're this repo's rule strings and hold
 * no personal details. 13 findings, 12 places, 10 tasks.
 */
const LOOK_AT_UI: [task: string, file: string, rule: string][] = [
  ['GH-28', 'extension/src/sidebar.ts', 'CLAUDE.md: Look at UI changes before shipping them'],
  ['GH-33', 'extension/scripts/fixtures.ts', 'Look at UI changes before shipping them'],
  ['GH-32', 'extension/webview/main.ts', 'CLAUDE.md: Look at UI changes before shipping them (npm run build, npm run screenshot, read the PNGs)'],
  ['GH-41', 'dist/screenshots/ticket-light-1000.png', 'CLAUDE.md: look at UI changes before shipping them'],
  ['GH-41', 'dist/screenshots/ticket-dark-1000.png', 'CLAUDE.md: Look at UI changes before shipping them (npm run build, npm run screenshot, read the PNGs)'],
  ['GH-46', 'extension/scripts/screenshot.ts', 'CLAUDE.md: look at UI changes before shipping them'],
  ['GH-52', 'extension/scripts/fixtures.ts', 'CLAUDE.md: look at UI changes before shipping them (npm run build, npm run screenshot, read the PNGs); tests can\'t see a broken layout'],
  ['GH-52', 'extension/scripts/fixtures.ts', 'CLAUDE.md: Look at UI changes before shipping them: npm run build, then npm run screenshot, then read the PNGs in dist/screenshots/. Tests can\'t see a broken layout.'],
  ['GH-83', 'extension/webview/styles.css', 'CLAUDE.md: Look at UI changes before shipping them: npm run build, then npm run screenshot, then read the PNGs'],
  ['GH-76', 'extension/webview/styles.css', 'Look at UI changes before shipping them (CLAUDE.md)'],
  ['GH-76', 'extension/scripts/fixtures.ts', 'Look at UI changes before shipping them (CLAUDE.md)'],
  ['GH-95', 'docs/DECISIONS.md', 'Look at UI changes before shipping them (CLAUDE.md)'],
  ['GH-108', 'extension/scripts/fixtures/setup.ts', 'Look at UI changes before shipping them (CLAUDE.md)'],
];

/** The same rules' other real cites (same provenance): decisions, rules joined with ';', the task's own. */
const OTHER_CITES = {
  d072: ['D-072', 'D-072', 'D-072'],
  gh94: ['Every rule gets a check before anyone relies on it; find a free oracle', 'Generated docs are checked in CI and in a unit test; a check must prove it ran'],
  keepToTask: ['Task: keep changes to what the task asks; mention other fixes instead of making them', 'Keep changes to what the task asks'],
};

interface Review { task: string; sha?: string; at?: string; findings: Partial<Finding>[] }

let shaN = 0;
/** One verdict in the reviews folder, as acc review writes it. */
function writeVerdict(reviews: string, r: Review): string {
  mkdirSync(reviews, { recursive: true });
  const sha = r.sha ?? createHash('sha1').update(`${r.task}:${shaN++}`).digest('hex');
  const at = r.at ?? clock.toISOString();
  writeFileSync(join(reviews, `${r.task}-${sha}.json`), JSON.stringify({
    v: 1, task: r.task, sha, env: 'main', verdict: 'pass', summary: 's', criteria: [],
    findings: r.findings.map((f) => ({ message: 'Something is wrong here.', must: false, ...f })), sessionId: `sess-${r.task}-${sha.slice(0, 4)}`, name: `Review ${r.task}`, at, durationMs: 1, costUsd: null,
  }));
  return sha;
}

/** A clone with a ledger and reviews folder, for accepting and dismissing. */
function clone(files: Record<string, string> = {}): RepoPaths {
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG), ...files });
  return repoPaths(dir, run);
}

/** A tick of the clock, so each review comes after the last. */
const tick = () => { clock = new Date(clock.getTime() + 60_000); };

/** Writes one review per [task, file, rule] in order, a minute apart. */
function cite(paths: Pick<RepoPaths, 'reviews'>, rows: [string, string, string | null, Partial<Finding>?][]): void {
  for (const [task, file, rule, extra] of rows) {
    tick();
    writeVerdict(paths.reviews, { task, findings: [{ file, ...(rule ? { rule } : {}), ...extra }] });
  }
}

/** Every file under a folder, with a hash of its bytes. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out[p] = createHash('sha256').update(readFileSync(p)).digest('hex');
    }
  };
  walk(dir);
  return out;
}

// ---------------------------------------------------------------- grouping

test('every real phrasing of one rule gives one key, a decision groups by its id, and two rules joined differently stay apart (GH-102)', () => {
  const heads = LOOK_AT_UI.map(([, , rule]) => ruleHead(rule));
  assert.ok(heads.length >= 13, `${heads.length} cases`);
  assert.deepEqual([...new Set(heads.map((h) => h.text.toLowerCase()))], ['look at ui changes before shipping them']);
  assert.deepEqual([...new Set(LOOK_AT_UI.map(([, , rule]) => findingKey({ rule, message: '', kind: null })!.words.join(' ')))], ['look ui change shipping']);
  assert.equal(heads.filter((h) => h.source === 'CLAUDE.md').length, 12, 'each cite that names CLAUDE.md says so');

  const d = OTHER_CITES.d072.map((rule, i) => ({ id: `GH-70@aaaaaa${i}#1`, task: 'GH-70', sha: `aaaaaa${i}`, at: `2026-10-07T00:0${i}:00Z`, sessionId: 's', name: null, message: 'm', must: false, file: `f${i}.ts`, line: null, rule, kind: null }));
  const dg = groupFindings(d);
  assert.equal(dg.length, 1);
  assert.equal(dg[0]!.key.decision, 'D-072');
  assert.equal(ruleHead('D-012: acc writes; every window reads').decision, 'D-012');

  const [a, b] = OTHER_CITES.gh94.map((rule) => findingKey({ rule, message: '', kind: null })!);
  assert.notDeepEqual(a!.words, b!.words);
  assert.equal(groupFindings(OTHER_CITES.gh94.map((rule, i) => ({ ...d[0]!, id: `GH-94@b#${i}`, task: 'GH-94', rule }))).length, 2);
  const [k1, k2] = OTHER_CITES.keepToTask.map((rule) => findingKey({ rule, message: '', kind: null })!.words.join(' '));
  assert.equal(k1, k2, 'the task\'s own rule, cited with and without "Task:", is one rule');
});

test('findings that cite no rule group by close wording, ignoring paths, identifiers and numbers; unrelated ones stay apart (GH-102)', () => {
  const base = { sha: 'c0ffee1', sessionId: 's', name: null, must: false, line: null, rule: null, kind: null };
  const cases = [
    { id: 'T-1@c#1', task: 'T-1', at: '2026-10-01T00:00:00Z', file: 'src/a.ts', message: 'The new `sampleFoo` fixture was inserted between sampleBar\'s doc comment and its function at line 470. Move it.' },
    { id: 'T-2@c#1', task: 'T-2', at: '2026-10-02T00:00:00Z', file: 'src/b.ts', message: 'The new `sampleBaz` fixture was inserted between sampleQux\'s doc comment and its function at line 12.' },
    { id: 'T-3@c#1', task: 'T-3', at: '2026-10-03T00:00:00Z', file: 'extension/scripts/fixtures/c.ts', message: 'The new sampleZed fixture was inserted between sampleWye\'s doc comment and its function (fixtures/c.ts:88).' },
    { id: 'T-4@c#1', task: 'T-4', at: '2026-10-04T00:00:00Z', file: 'src/d.ts', message: 'The merge queue retries forever when GitHub is down.' },
    { id: 'T-5@c#1', task: 'T-5', at: '2026-10-05T00:00:00Z', file: 'docs/DESIGN.md', message: 'DESIGN.md section 9 still describes the old hold.' },
  ].map((c) => ({ ...base, ...c }));
  assert.equal(cases.length, 5, `${cases.length} cases`);
  assert.doesNotMatch(wordingText(cases[0]!), /sample|470|src/, 'identifiers, code and numbers are left out');
  const g = groupFindings(cases);
  assert.deepEqual(g.map((x) => x.findings.map((f) => f.task)), [['T-1', 'T-2', 'T-3'], ['T-4'], ['T-5']]);
  assert.equal(g[0]!.by, 'wording');
  assert.match(g[0]!.id, /^w-[0-9a-f]{6}$/);
  // A kind the reviewer named groups across wordings that share nothing else.
  const kinds = groupFindings([
    { ...cases[3]!, kind: 'UI change not screenshotted' }, { ...cases[4]!, kind: 'UI change not screenshotted' },
  ]);
  assert.equal(kinds.length, 1);
});

test('a group is offered only at 3 findings across 2 tasks, counted once per task and file (GH-102)', () => {
  const rule = 'Every public command has a help line';
  const offers = (rows: [string, string, string][]) => {
    const paths = { root: tempDir(), reviews: join(tempDir(), 'reviews'), suggestions: join(tempDir(), 'rules') };
    cite(paths, rows);
    return suggestRules(paths);
  };
  assert.equal(offers([['T-1', 'a.ts', rule], ['T-2', 'b.ts', rule]]).length, 0, 'two across two tasks');
  assert.equal(offers([['T-1', 'a.ts', rule], ['T-1', 'b.ts', rule], ['T-1', 'c.ts', rule]]).length, 0, 'three in one task');
  const three = offers([['T-1', 'a.ts', rule], ['T-1', 'b.ts', rule], ['T-2', 'a.ts', rule]]);
  assert.equal(three.length, 1, 'three across two tasks');
  assert.deepEqual([three[0]!.findings, three[0]!.tasks, three[0]!.kind], [3, 2, 'rule']);
  // GH-9 and GH-12's shape: each task's later review says the same thing on the same file. That's two places.
  assert.equal(offers([['GH-9', 'cli.test.ts', OTHER_CITES.keepToTask[0]!], ['GH-9', 'cli.test.ts', OTHER_CITES.keepToTask[0]!], ['GH-12', 'cli.test.ts', OTHER_CITES.keepToTask[0]!], ['GH-12', 'cli.test.ts', OTHER_CITES.keepToTask[1]!]]).length, 0);
});

test('the real reviews\' "Look at UI changes" cites make one check suggestion: 12 findings across 10 tasks, each linked to its review (GH-102)', () => {
  const paths = clone({ 'CLAUDE.md': '# Working here\n\n- Look at UI changes before shipping them: `npm run build`, then\n  `npm run screenshot`, then read the PNGs.\n' });
  cite(paths, LOOK_AT_UI.map(([task, file, rule]) => [task, file, rule]));
  const [s, ...rest] = suggestRules(paths);
  assert.equal(rest.length, 0);
  assert.deepEqual([s!.kind, s!.written, s!.findings, s!.tasks, s!.line], ['check', 'CLAUDE.md', 12, 10, 'Look at UI changes before shipping them.']);
  assert.equal(s!.sources.length, 13, 'one source per finding');
  assert.equal(s!.sources.filter((x) => !x.counted).length, 1, 'GH-52\'s second review on the same file isn\'t counted again');
  for (const x of s!.sources) {
    assert.match(x.task, /^GH-\d+$/);
    assert.match(x.sha, /^[0-9a-f]{40}$/);
    assert.ok(x.at && x.sessionId.startsWith(`sess-${x.task}-`), 'each source carries its review\'s date and reviewer session');
  }
  assert.equal(s!.hint, 'gate');
});

test('a rule already written in .acc/rules.md or CLAUDE.md, or named by its cite, is offered as a check; one written nowhere as a rule (GH-102)', () => {
  const rule = 'Never hard-code a colour';
  const rows: [string, string, string][] = [['T-1', 'a.css', rule], ['T-2', 'b.css', rule], ['T-3', 'c.css', rule]];
  const none = clone();
  cite(none, rows);
  const asRule = suggestRules(none)[0]!;
  assert.deepEqual([asRule.kind, asRule.written, asRule.line, asRule.hint], ['rule', null, 'Never hard-code a colour.', 'lint']);
  for (const [file, text] of [['.acc/rules.md', '- Never hard-code a colour: use a theme token.\n'], ['AGENTS.md', 'Some words.\n\n* never hard-code a colour\n']] as const) {
    const p = clone({ [file]: text });
    cite(p, rows);
    const s = suggestRules(p)[0]!;
    assert.deepEqual([s.kind, s.written], ['check', file]);
  }
  const named = clone();
  cite(named, rows.map(([t, f]) => [t, f, `${rule} (~/.claude/CLAUDE.md)`]));
  assert.deepEqual([suggestRules(named)[0]!.kind, suggestRules(named)[0]!.written], ['check', '~/.claude/CLAUDE.md']);
});

test('the check hint reads the rule\'s words, and is only a hint (GH-102)', () => {
  const cases: [string, ReturnType<typeof checkHint>][] = [
    ['Never hard-code a colour', 'lint'], ['Tests catch stubs', 'test'], ['Every fixture is pinned', 'test'], ['A check must prove it ran', 'gate'],
    ['Look at UI changes before shipping them', 'gate'], ['Keep changes to what the task asks', null],
  ];
  assert.ok(cases.length > 0);
  for (const [text, want] of cases) assert.equal(checkHint(text), want, text);
});

// ---------------------------------------------------------------- the drafted task

test('the drafted task holds the line, the check when asked for, and every finding it came from (GH-102)', () => {
  const paths = clone();
  cite(paths, [['T-1', 'a.ts', 'Never hard-code a colour'], ['T-2', 'b.ts', 'Never hard-code a colour'], ['T-3', 'c.ts', 'Never hard-code a colour']]);
  const s = suggestRules(paths)[0] as Suggestion;
  const plain = draftRuleTask(s, { check: 'none' });
  assert.equal(plain.source.kind, 'manual');
  assert.equal(plain.title, 'Add the rule: Never hard-code a colour');
  assert.match(plain.brief!, /^> Never hard-code a colour\.$/m);
  assert.match(plain.brief!, /`\.acc\/rules\.md` has the line above/);
  assert.doesNotMatch(plain.brief!, /checks the rule/);
  for (const x of s.sources) assert.ok(plain.brief!.includes(`${x.task}, review of ${x.sha.slice(0, 7)}`) && plain.brief!.includes(x.sessionId), 'each source, with its reviewer session');
  const withCheck = draftRuleTask(s, { line: 'Colours come from theme tokens', check: 'lint', note: 'See theme.css.' });
  assert.match(withCheck.brief!, /^> Colours come from theme tokens\.$/m);
  assert.match(withCheck.brief!, /- \[ \] A lint checks the rule and fails when it's broken/);
  assert.match(withCheck.brief!, /`\.acc\/rules\.md` names that check beside the rule/);
  assert.match(withCheck.brief!, /## Notes\n\nSee theme\.css\./);
  assert.throws(() => draftRuleTask(s, { line: '   ' }), /line is empty/);
  assert.throws(() => draftRuleTask(s, { check: 'fuzz' as never }), /--check is/);
  assert.throws(() => draftRuleTask({ ...s, kind: 'check', written: 'CLAUDE.md' }, { check: 'none' }), /its task is the check/);
  const check = draftRuleTask({ ...s, kind: 'check', written: 'CLAUDE.md', hint: null });
  assert.match(check.brief!, /already a rule \(CLAUDE\.md\)/);
  assert.match(check.brief!, /A lint, test or gate checks the rule/);
  assert.doesNotMatch(check.brief!, /has the line above/, 'a rule already written gets no new line');
});

// ---------------------------------------------------------------- a person acts

test('working out the suggestions writes nothing: the ledger, events, .acc/ and the rules store are byte for byte the same (GH-102)', () => {
  const paths = clone({ '.acc/rules.md': '- Something else entirely.\n' });
  cite(paths, LOOK_AT_UI.map(([task, file, rule]) => [task, file, rule]));
  mkdirSync(paths.suggestions, { recursive: true });
  writeFileSync(paths.ledger, JSON.stringify({ v: 1, seq: 0, tasks: [] }));
  writeFileSync(paths.events, '');
  const before = { ...snapshot(paths.stateDir), ...snapshot(join(paths.root, '.acc')) };
  assert.ok(Object.keys(before).length >= 15, 'the snapshot covers the files');
  for (let i = 0; i < 3; i++) suggestRules(paths, { all: true });
  readFindings(paths);
  assert.deepEqual({ ...snapshot(paths.stateDir), ...snapshot(join(paths.root, '.acc')) }, before);
  assert.equal(readFileSync(join(paths.root, '.acc', 'rules.md'), 'utf8'), '- Something else entirely.\n');
});

test('accepting adds exactly one To do task by a person, records it, and the suggestion goes; only a person can (GH-102)', () => {
  const paths = clone();
  cite(paths, [['T-1', 'a.ts', 'Never hard-code a colour'], ['T-2', 'b.ts', 'Never hard-code a colour'], ['T-3', 'c.ts', 'Never hard-code a colour']]);
  const s = suggestRules(paths)[0]!;
  assert.throws(() => acceptSuggestion(paths, config, s.id, {}, 'orchestrator', 'autopilot', now), /Only a person/);
  assert.equal(existsSync(paths.ledger), false, 'a refusal adds nothing');
  assert.throws(() => acceptSuggestion(paths, config, 'r-000000', {}, 'human', 'human:pat', now), /No rule is suggested as r-000000/);
  const r = acceptSuggestion(paths, config, s.id, { check: 'lint' }, 'human', 'human:pat', now);
  const tasks = readLedger(paths.ledger).tasks;
  assert.deepEqual(tasks.map((t) => [t.id, t.state, t.source.kind, t.history[0]!.actor, t.history[0]!.by]), [[r.task, 'todo', 'manual', 'human', 'human:pat']]);
  assert.match(tasks[0]!.brief, /A lint checks the rule/);
  assert.deepEqual(readSuggestionRecords(paths).map((x) => [x.id, x.outcome, x.task, x.places.length]), [[s.id, 'accepted', r.task, 3]]);
  assert.deepEqual(suggestRules(paths), [], 'accepted, it\'s gone');
  assert.equal(existsSync(join(paths.root, '.acc', 'rules.md')), false, 'acc never writes .acc/rules.md');
  assert.throws(() => acceptSuggestion(paths, config, s.id, {}, 'human', 'human:pat', now), /No rule is suggested/, 'it can\'t be accepted twice');
});

test('a dismissed suggestion stays dismissed until its finding comes back 3 more times; an accepted rule comes back as a check (GH-102)', () => {
  const rule = 'Never hard-code a colour';
  const paths = clone();
  cite(paths, [['T-1', 'a.ts', rule], ['T-2', 'b.ts', rule], ['T-3', 'c.ts', rule]]);
  const s = suggestRules(paths)[0]!;
  dismissSuggestion(paths, s.id, 'human:pat', now);
  assert.deepEqual(suggestRules(paths), []);
  assert.deepEqual(suggestRules(paths, { all: true }).map((x) => 'hidden' in x && [x.hidden.outcome, x.hidden.more]), [['dismissed', 3]]);
  // A later review of the same task and file isn't a new place.
  cite(paths, [['T-3', 'c.ts', rule]]);
  assert.deepEqual(suggestRules(paths), []);
  cite(paths, [['T-4', 'a.ts', rule], ['T-5', 'a.ts', rule]]);
  assert.deepEqual(suggestRules(paths), [], 'two more: still hidden');
  cite(paths, [['T-6', 'a.ts', rule]]);
  const back = suggestRules(paths);
  assert.deepEqual(back.map((x) => [x.id, x.kind, x.findings, x.again?.outcome]), [[s.id, 'rule', 6, 'dismissed']], 'three more: back, saying it was dismissed');
  assert.throws(() => dismissSuggestion(paths, 'r-000000', 'human:pat', now), /No rule is suggested/);

  // Accepted as a rule, it comes back 3 more times: now it's offered as a check.
  acceptSuggestion(paths, config, s.id, {}, 'human', 'human:pat', now);
  assert.deepEqual(suggestRules(paths), []);
  cite(paths, [['T-7', 'a.ts', rule], ['T-8', 'a.ts', rule], ['T-9', 'a.ts', rule]]);
  assert.deepEqual(suggestRules(paths).map((x) => [x.kind, x.again?.outcome, x.written]), [['check', 'accepted', null]]);
  assert.match(draftRuleTask(suggestRules(paths)[0]!).brief!, /accepted as a rule before/);
});

// ---------------------------------------------------------------- the verdicts it reads

test('the verdicts are read the same way everywhere: a review under way and a file that can\'t be read are skipped (GH-102)', () => {
  const reviews = join(tempDir(), 'reviews');
  writeVerdict(reviews, { task: 'T-1', findings: [{ rule: 'x' }] });
  writeFileSync(join(reviews, 'T-1.running.json'), JSON.stringify({ sessionId: 's', sha: 'abc', startedAt: 'now', pid: 1 }));
  writeFileSync(join(reviews, 'T-2-bad.json'), '{ not json');
  writeFileSync(join(reviews, 'T-3-feed.json'), JSON.stringify({ task: 'T-9', sha: 'beef', at: 'x', findings: [] }));
  assert.deepEqual(readVerdicts({ reviews }).map((v) => v.task), ['T-1']);
  assert.deepEqual(readFindings({ reviews }).map((f) => f.id.replace(/@.*#/, '#')), ['T-1#1']);
  assert.deepEqual(readVerdicts({ reviews: join(tempDir(), 'none') }), []);
});

test('a finding\'s kind is kept from the reviewer, and the reviewer is given the kinds to reuse (GH-102)', () => {
  const out = JSON.stringify({ session_id: 's', structured_output: { verdict: 'pass', summary: 's', client: 'c', criteria: [], findings: [{ message: 'm', must: false, kind: '  UI change not screenshotted ' }, { message: 'n', must: false, kind: '' }] } });
  assert.deepEqual(parseReview(out).verdict.findings, [{ message: 'm', must: false, kind: 'UI change not screenshotted' }, { message: 'n', must: false }]);
  const reviews = join(tempDir(), 'reviews');
  writeVerdict(reviews, { task: 'T-1', findings: [{ kind: 'UI change not screenshotted' }, { kind: 'Builder note numbers wrong' }] });
  writeVerdict(reviews, { task: 'T-2', findings: [{ kind: 'UI change not screenshotted' }] });
  assert.deepEqual(knownKinds({ reviews }), ['UI change not screenshotted', 'Builder note numbers wrong']);
  const task = { id: 'T-3', title: 't', brief: '', run: null } as never;
  const p = reviewPrompt({ task, config, envName: 'main', envBranch: 'main', sha: 'abc1234', packet: 'p', diff: '', stat: '', checks: [], rules: null, kinds: knownKinds({ reviews }) });
  assert.match(p.prompt, /## Kinds of finding earlier reviews named\n\n- UI change not screenshotted\n- Builder note numbers wrong/);
  assert.match(p.system, /Reuse one of the kinds/);
});
