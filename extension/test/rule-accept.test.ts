// A suggested rule a person accepts or dismisses on the Overview (GH-102, T-35): the built extension against
// the vscode stand-in, with acc's real reviews and suggestions folders. Once acc says it accepted one, the
// next home model doesn't hold it; a second accept comes back with acc's reason. Run after npm run build.
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { makeRepo, tempDir } from '../../packages/core/test/support.ts';
import { activate, fakeVscode, until } from './vscode.ts';

const dist = fileURLToPath(new URL('../dist/extension.js', import.meta.url));

type Tab = ReturnType<typeof fakeVscode>['panels'][number];
type Rule = { project: string; id: string; line: string };
type Msg = { type?: string; action?: string; ok?: boolean; error?: string; id?: string; task?: string; model?: { kind: string; overview: { attention: { rule?: Rule }[] } } };

const s = {} as { fake: ReturnType<typeof fakeVscode>; started: ReturnType<typeof activate>; repo: string; tab: Tab; saved: NodeJS.ProcessEnv };

/** One review's verdict, as acc review writes it, with one finding on `file` citing `rule`. */
function verdict(reviews: string, task: string, sha: string, file: string, rule: string): void {
  writeFileSync(join(reviews, `${task}-${sha}.json`), JSON.stringify({
    v: 1, task, sha, env: 'main', verdict: 'pass', summary: 's', criteria: [], findings: [{ message: 'Something is wrong here.', must: false, file, rule }],
    sessionId: `sess-${task}`, name: `Review ${task}`, at: new Date().toISOString(), durationMs: 1, costUsd: null,
  }));
}

before(async () => {
  const sandbox = realpathSync(tempDir('acc-rule-accept-'));
  const at = (...p: string[]) => join(sandbox, ...p);
  for (const d of ['home/.claude', 'state/questions', 'state/heavy', 'state/slack', 'bin']) mkdirSync(at(d), { recursive: true });
  writeFileSync(at('home', '.claude.json'), '{"projects":{}}\n');
  for (const name of ['gh', 'claude', 'sf', 'code', 'open', 'osascript', 'caffeinate']) {
    writeFileSync(at('bin', name), '#!/bin/sh\nexit 1\n');
    chmodSync(at('bin', name), 0o755);
  }
  s.saved = { ...process.env };
  Object.assign(process.env, {
    HOME: at('home'), CLAUDE_CONFIG_DIR: at('home', '.claude'), PATH: `${at('bin')}:${process.env.PATH}`, NO_COLOR: '1',
    ACC_QUESTIONS_DIR: at('state', 'questions'), ACC_HEAVY_DIR: at('state', 'heavy'), ACC_MACHINE_FILE: at('state', 'machine.json'), ACC_REPOS_FILE: at('state', 'repos.json'),
    ACC_RUNTIME_FILE: at('state', 'runtime'), ACC_SLACK_DIR: at('state', 'slack'),
  });
  delete process.env.ACC_ROLE;
  delete process.env.ACC_TASK;
  s.repo = makeRepo({ '.acc/config.json': JSON.stringify({ schema: 1, project: 'Tool', environments: [{ name: 'main', default: true }], trackers: [] }), '.gitignore': '.claude/worktrees/\n' });
  // Two findings that keep coming back, each 3 times across 3 tasks: two suggestions, so one is left after the first goes.
  const reviews = join(s.repo, '.git', 'acc', 'reviews');
  mkdirSync(reviews, { recursive: true });
  for (const [i, task] of ['T-7', 'T-8', 'T-9'].entries()) {
    verdict(reviews, task, `${i}aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`, `a${i}.ts`, 'Never hard-code a colour');
    verdict(reviews, task, `${i}bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`, `b${i}.ts`, 'Name every control accessibly');
  }
  s.fake = fakeVscode(s.repo);
  const version = (JSON.parse(readFileSync(join(dist, '..', '..', 'package.json'), 'utf8')) as { version: string }).version;
  s.started = activate(dist, s.fake, { 'acc.welcomed': true, 'acc.machineItems': { at: Date.now(), profile: 'generic', version, items: [{ id: 'A1.git', part: 'machine', title: 'git', status: 'pass', detail: '' }] } });
  const { calls, panels } = s.fake;
  await until(() => calls.contexts.get('acc.profile') === 'generic' && calls.contexts.has('acc.step.A1.git'), 60_000);
  await until(() => calls.contexts.get('acc.hasProject') === true && readdirSync(at('state', 'questions')).length > 0, 60_000);
  await calls.commands.get('acc.open.home')!('overview');
  s.tab = panels[0]!;
  s.tab.receive!({ type: 'ready' });
});

after(() => {
  s.started?.stop();
  delete createRequire(import.meta.url).cache[dist];
  for (const k of Object.keys(process.env)) if (!(k in s.saved)) delete process.env[k];
  Object.assign(process.env, s.saved);
});

const since = (from: number): Msg[] => s.tab.posted.slice(from) as Msg[];
/** The suggested rules the last home model holds. */
const rulesIn = (msgs: Msg[]): Rule[] => (msgs.filter((m) => m.type === 'state' && m.model?.kind === 'home').at(-1)?.model?.overview.attention ?? []).flatMap((a) => (a.rule ? [a.rule] : []));

/** What the page sends for a person's Confirm, and acc's reply, with every message the page got meanwhile. */
async function confirm(rule: Rule): Promise<{ done: Msg; msgs: Msg[] }> {
  const from = s.tab.posted.length;
  s.tab.receive!({ type: 'rule-accept', project: rule.project, id: rule.id, line: rule.line, title: `Add the rule: ${rule.line}`, check: 'none' });
  const done = () => since(from).find((m) => m.type === 'rule-done');
  await until(() => !!done(), 60_000);
  return { done: done()!, msgs: since(from) };
}

test('an accepted suggestion is gone from the next home model; a second accept shows acc\'s reason, the edge case of a page drawn before it went (T-35)', { timeout: 120_000 }, async () => {
  const shown = rulesIn(s.tab.posted as Msg[]);
  assert.equal(shown.length, 2, 'two suggestions to begin with');
  const [first] = shown;
  const { done, msgs } = await confirm(first!);
  assert.deepEqual([done.action, done.ok, done.id], ['rule-accept', true, first!.id], done.error ?? 'acc refused');
  assert.match(done.task ?? '', /^T-\d+$/, 'acc says which task it added');
  // The last home model sent before acc's reply, or with it, no longer holds the accepted suggestion.
  const after = rulesIn(msgs);
  assert.ok(msgs.some((m) => m.type === 'state'), 'a home model followed the accept');
  assert.deepEqual(after.map((r) => r.id), shown.slice(1).map((r) => r.id), 'only the other suggestion is left');
  // A page drawn before it went can still send Confirm: acc refuses, and says why in words the page shows.
  const again = await confirm(first!);
  assert.equal(again.done.ok, false);
  assert.match(again.done.error ?? '', new RegExp(`^No rule is suggested as ${first!.id} now\\.`), 'acc\'s reason comes back');
  assert.doesNotMatch(again.done.error ?? '', /\bacc [a-z]/, 'in the Command Center\'s words: what to run is a process, not an acc command');
  assert.match(again.done.error ?? '', /"See the suggested rules"/);
  assert.deepEqual(rulesIn(s.tab.posted as Msg[]).map((r) => r.id), shown.slice(1).map((r) => r.id), 'and nothing came back');
});
