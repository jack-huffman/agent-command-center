// acc's step channel at the CLI (T-65): each long command prints exactly what it printed before steps were
// reported, with ACC_STEPS or without, and only with it does acc write the steps file. The plain output of
// each command is pinned as it was before the channel, with its commits, folders and session ids made
// stable. acc runs from '../src/main.ts', through cli().

import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { fakeClaude, IGNORE, trustingHome } from '../../core/test/dispatch-support.ts';
import { parseConfig, type Config } from '../../core/src/config.ts';
import { run } from '../../core/src/exec.ts';
import { waiveGates } from '../../core/src/gates.ts';
import { mutate } from '../../core/src/ledger.ts';
import { repoPaths } from '../../core/src/paths.ts';
import { reviewPath } from '../../core/src/review.ts';
import { readStepEvents } from '../../core/src/steps.ts';
import { GENERIC_CONFIG, gitIn, makeRepo, SF_CONFIG, tempDir } from '../../core/test/support.ts';
import { openSteps, steps } from '../src/shared.ts';
import { cli } from './support.ts';

const acc = cli(fileURLToPath(new URL('../src/main.ts', import.meta.url)));

/** What a stand-in fails at: sf's deploy, its check-only deploy, listing one branch's components, or an analyst's answer. */
interface Fail { deploy?: true; check?: true; list?: string; analyst?: true }

/**
 * Stand-in sf, gh and claude on PATH: sf lists components, and its deploy and its check pass; gh signs in and
 * opens pull request 9; claude answers an analysis. `fail` names what fails instead.
 */
function fakes(fail: Fail = {}): string {
  const bin = join(tempDir('fake-tools-'), 'bin');
  mkdirSync(bin);
  const tool = (name: string, script: string) => { writeFileSync(join(bin, name), `#!/bin/sh\n${script}`); chmodSync(join(bin, name), 0o755); };
  const failed = `echo '{"status":1,"result":{"success":false,"details":{"componentFailures":{"fullName":"B","problem":"Invalid type: Foo"}}}}'; exit 1`;
  // sf lists a checkout's components into the file it's told, and deploys or checks with success.
  tool('sf', `if [ "$1 $2 $3" = "project generate manifest" ]; then
  while [ $# -gt 0 ]; do case "$1" in --output-dir) out="$2" ;; --name) name="$2" ;; esac; shift; done
  if [ "$name" = "${fail.list ?? ''}" ]; then echo '{"status":1,"message":"No source here"}'; exit 1; fi
  printf '<?xml version="1.0" encoding="UTF-8"?><Package xmlns="http://soap.sforce.com/2006/04/metadata"><types><members>A</members><name>ApexClass</name></types><version>62.0</version></Package>' > "$out/$name.xml"
  echo '{"status":0}'
  exit 0
fi
case " $* " in *" --dry-run "*) ${fail.check ? failed : ':'} ;; *) ${fail.deploy ? failed : ':'} ;; esac
echo '{"status":0,"result":{"id":"0Af1","success":true,"numberComponentsDeployed":1,"numberComponentsTotal":1}}'
`);
  // claude answers an analysis as \`claude -p --output-format json\` does, or with junk.
  tool('claude', fail.analyst ? 'echo "not an analysis"\n' : `echo '${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 'sess-analyst', total_cost_usd: 0.5, structured_output: ANALYSIS })}'\n`);
  tool('gh', `case "$1 $2" in\n  "auth token") echo gho ;;\n  "pr create") echo https://github.com/acme-co/acme-salesforce/pull/9 ;;\n  *) echo '[]' ;;\nesac\n`);
  return bin;
}

/** A Salesforce repo on a bare origin: production, uat and dev, with one new class on dev. */
function sfRepo(): { dir: string; base: string } {
  const origin = tempDir('origin-');
  run('git', ['init', '-q', '--bare', origin]);
  const dir = realpathSync(makeRepo({
    '.acc/config.json': JSON.stringify(SF_CONFIG),
    'sfdx-project.json': JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] }),
    'force-app/main/default/classes/A.cls': 'public class A {}\n',
  }));
  gitIn(dir, 'branch', '-M', 'production');
  gitIn(dir, 'remote', 'add', 'origin', origin);
  for (const b of ['uat', 'dev']) gitIn(dir, 'branch', b);
  gitIn(dir, 'checkout', '-q', 'dev');
  mkdirSync(join(dir, 'force-app/main/default/classes'), { recursive: true });
  writeFileSync(join(dir, 'force-app/main/default/classes/B.cls'), 'public class B {}\n');
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'dev: B');
  gitIn(dir, 'push', '-q', 'origin', 'production', 'uat', 'dev');
  return { dir, base: gitIn(dir, 'rev-parse', 'production').trim() };
}

/** Output made stable: each commit a short sha names, the repo's folder, a session's id and a promotion's time. */
function stable(text: string, dir: string): string {
  const shas = gitIn(dir, 'log', '--all', '--format=%H').trim().split('\n').filter(Boolean);
  let s = text.split(dir).join('<repo>');
  for (const sha of shas) s = s.split(sha.slice(0, 7)).join('<sha>');
  return s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<session>').replace(/\d{8}-\d{4}/g, '<stamp>');
}

/** A command run twice in two copies of one fixture: without ACC_STEPS, then with it. */
function both(make: () => { dir: string; args: string[]; env?: NodeJS.ProcessEnv }) {
  const plain = make();
  const a = acc(plain.dir, plain.args, undefined, plain.env);
  const stepped = make();
  const file = join(tempDir('steps-'), 'steps.jsonl');
  const b = acc(stepped.dir, stepped.args, undefined, { ...stepped.env, ACC_STEPS: file });
  return {
    plain: { code: a.code, out: stable(a.out, plain.dir), err: stable(a.err, plain.dir) },
    stepped: { code: b.code, out: stable(b.out, stepped.dir), err: stable(b.err, stepped.dir) },
    events: existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { kind: string; id?: string; state?: string; ok?: boolean }) : [],
  };
}

/** An analysis that's ready to build. */
const ANALYSIS = {
  verdict: 'ready', summary: 'Adds a changelog.',
  requirements: { goal: 'A changelog.', criteria: ['CHANGELOG.md has one entry'], assumptions: [], outOfScope: [] },
  questions: [], findings: [{ area: 'Docs', detail: 'There is no changelog.', source: 'the repo' }],
  approach: { plan: ['Add CHANGELOG.md'], files: [{ path: 'CHANGELOG.md', change: 'add', why: 'the changelog' }], refactors: [], risks: [], tests: [], size: 'S' },
  split: [],
};

/** A generic repo with one task to do, T-1. */
function generic(config: unknown = GENERIC_CONFIG): string {
  const dir = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify(config), ...IGNORE }));
  assert.equal(acc(dir, ['add', 'Write the changelog', '--brief', 'Add CHANGELOG.md with one entry.']).code, 0);
  return dir;
}

/** Each long command, with what it printed before steps were reported, and the first step it reports. */
const CASES: { name: string; make: () => { dir: string; args: string[]; env?: NodeJS.ProcessEnv }; code: number; out: string; err: string; first: string; ok: boolean }[] = [
  {
    name: 'deploy',
    make: () => { const { dir, base } = sfRepo(); return { dir, args: ['deploy', 'dev', '--since', base], env: { PATH: `${fakes()}:${process.env.PATH}` } }; },
    code: 0,
    out: 'Dev (Acme Dev): dev from <sha> to <sha>\n  1 to deploy, tests: RunLocalTests\n    force-app/main/default/classes/B.cls\n✓ Deployed 1 file(s) from dev at <sha> to Dev (job 0Af1).\n',
    err: '',
    first: 'branch',
    ok: true,
  },
  {
    name: 'promote',
    make: () => { const { dir } = sfRepo(); return { dir, args: ['promote', 'dev', '--to', 'uat'], env: { PATH: `${fakes()}:${process.env.PATH}` } }; },
    code: 0, out: 'Dev (dev at <sha>) → UAT (uat at <sha>)\n  1 to bring over\n    force-app/main/default/classes/B.cls\nOpened pull request #9  https://github.com/acme-co/acme-salesforce/pull/9\nIt merges only when a person merges it. Deploy after that with acc deploy.\n', err: 'Building promote/dev-to-uat-<stamp> from uat\nValidating against UAT (Acme UAT). Nothing is saved to the org.\nPushing promote/dev-to-uat-<stamp>\n', first: 'branches', ok: true,
  },
  {
    name: 'dispatch',
    make: () => { const dir = generic(); return { dir, args: ['dispatch', 'T-1'], env: { PATH: `${fakeClaude().bin}:${process.env.PATH}`, HOME: trustingHome(dir) } }; },
    code: 0, out: 'T-1 → ↻ Running\n  worktree: <repo>/.claude/worktrees/T-1\n  branch:   task/T-1-write-the-changelog\n  name:     Tool · T-1 Write the changelog · builder\n  model:    claude-opus-5-5\n  effort:   the model\'s default\n  where:    This Mac\n  agent:    background session bg1. Watch it with: claude attach bg1\n  packet:   <repo>/.git/acc/packets/T-1.md\n', err: '', first: 'task', ok: true,
  },
  {
    name: 'land',
    make: () => ({ dir: generic(), args: ['land', 'T-1'] }),
    code: 1, out: '', err: '✗ T-1 is todo. A task lands from review, once its review has passed.\n', first: 'task', ok: false,
  },
  {
    name: 'analyze',
    make: () => ({ dir: generic(), args: ['analyze', 'T-1'], env: { PATH: `${fakes()}:${process.env.PATH}` } }),
    code: 0, out: '✓ Ready to build: Adds a changelog.\n\nAcceptance criteria\n  - CHANGELOG.md has one entry\n\nWhat is there now\n  - Docs: There is no changelog.  the repo\n\nApproach\n  - Add CHANGELOG.md\n\nSize S. Session sess-analyst.\n', err: 'Analyzing T-1. The analyst reads the ticket and the code, and changes nothing. Session <session>, named Tool · T-1 Write the changelog · analysis.\n', first: 'task', ok: true,
  },
  {
    name: 'setup baseline',
    make: () => { const { dir } = sfRepo(); return { dir, args: ['setup', 'baseline'], env: { PATH: `${fakes()}:${process.env.PATH}` } }; },
    code: 0, out: 'Wrote <repo>/manifest/baseline-package.xml: 1 components of 1 types, from production, uat, dev.\nCommit it on every environment\'s branch, so each is retrieved with the same list.\n', err: 'Listing the components on production\nListing the components on uat\nListing the components on dev\n', first: 'fetch', ok: true,
  },
  {
    name: 'setup branches',
    make: () => ({ dir: generic({ ...GENERIC_CONFIG, environments: [{ name: 'main', default: true }, { name: 'staging', promotesTo: ['main'] }] }), args: ['setup', 'branches'] }),
    code: 0, out: '  ✓ staging          made locally; push it when you\'re happy with it\n', err: 'Making staging\n', first: 'fetch', ok: true,
  },
  {
    name: 'setup lists',
    make: () => ({ dir: sfRepo().dir, args: ['setup', 'lists'] }),
    code: 0, out: 'Wrote <repo>/manifest/environment-specific.txt with 0 environment-specific paths.\nWrote <repo>/manifest/known-drift.txt with 0 known-drift paths.\n  dev: 1 other difference from production that neither list explains: real drift, or work in progress. force-app/main/default/classes/B.cls\nRead both lists before committing them: each line keeps a file out of promotions (environment-specific) or out of drift checks (known drift).\n', err: '', first: 'fetch', ok: true,
  },
  {
    name: 'setup readme',
    make: () => ({ dir: generic(), args: ['setup', 'readme'] }),
    code: 0, out: 'Added an environments section to <repo>/README.md. Keep it the same on every non-production branch.\n', err: '', first: 'readme', ok: true,
  },
];

test('each long command prints what it printed before, with ACC_STEPS or without, and writes steps only with it (T-65)', () => {
  let checked = 0;
  for (const c of CASES) {
    const r = both(c.make);
    assert.deepEqual(r.plain, { code: c.code, out: c.out, err: c.err }, `${c.name}: its plain output`);
    assert.deepEqual(r.stepped, r.plain, `${c.name}: the same with ACC_STEPS`);
    assert.equal(r.events[0]?.id, c.first, `${c.name}: its first step`);
    assert.deepEqual([r.events.at(-1)?.kind, r.events.at(-1)?.ok], ['result', c.ok], `${c.name}: its result last`);
    checked++;
  }
  assert.equal(checked, CASES.length);
  assert.ok(checked >= 1);
});

// ---------------------------------------------------------------- each command's steps, in order

/**
 * A command run with ACC_STEPS: its exit code, and its trail, each step as it ended ("deploy failed") and
 * the result last ("result failed"). A step's start comes before its end, and a skipped step has none.
 */
function trail(dir: string, args: string[], env: NodeJS.ProcessEnv = {}): { code: number; trail: string[]; notes: Record<string, string> } {
  const file = join(tempDir('steps-'), 'steps.jsonl');
  const r = acc(dir, args, undefined, { ...env, ACC_STEPS: file });
  const events = readStepEvents(existsSync(file) ? readFileSync(file, 'utf8') : '');
  const started = new Set<string>();
  const out: string[] = [];
  const notes: Record<string, string> = {};
  for (const e of events) {
    if (e.kind === 'result') { out.push(`result ${e.ok ? 'ok' : 'failed'}`); continue; }
    if (e.state === 'started') { started.add(e.id); continue; }
    if (e.state !== 'skipped') assert.ok(started.has(e.id), `${e.id} ended without starting`);
    out.push(`${e.id} ${e.state}`);
    if (e.note) notes[e.id] = e.note;
  }
  return { code: r.code, trail: out, notes };
}

const withFakes = (fail: Fail = {}) => ({ PATH: `${fakes(fail)}:${process.env.PATH}` });

test('deploy reports its steps in order, and one whose deploy fails stops there with sf\'s failure, then a failed result', () => {
  const ok = sfRepo();
  assert.deepEqual(trail(ok.dir, ['deploy', 'dev', '--since', ok.base], withFakes()).trail,
    ['branch done', 'changes done', 'ready done', 'checkout done', 'deploy done', 'record done', 'updates done', 'result ok']);
  const bad = sfRepo();
  const r = trail(bad.dir, ['deploy', 'dev', '--since', bad.base], withFakes({ deploy: true }));
  assert.equal(r.code, 1);
  assert.deepEqual(r.trail, ['branch done', 'changes done', 'ready done', 'checkout done', 'deploy failed', 'result failed']);
  assert.equal(r.notes.deploy, 'B: Invalid type: Foo');
});

test('promote reports its steps in order, and one whose check fails in the org stops at the check, with no pull request', () => {
  assert.deepEqual(trail(sfRepo().dir, ['promote', 'dev', '--to', 'uat'], withFakes()).trail,
    ['branches done', 'changes done', 'ready done', 'build done', 'check done', 'push done', 'open done', 'record done', 'result ok']);
  const r = trail(sfRepo().dir, ['promote', 'dev', '--to', 'uat'], withFakes({ check: true }));
  assert.equal(r.code, 1);
  assert.deepEqual(r.trail, ['branches done', 'changes done', 'ready done', 'build done', 'check failed', 'result failed']);
  // A check skipped is said, not left out.
  assert.deepEqual(trail(sfRepo().dir, ['promote', 'dev', '--to', 'uat', '--skip-validate'], withFakes()).trail.slice(4, 5), ['check skipped']);
});

test('dispatch reports its steps in order, and one whose builder won\'t start fails at the start, after its worktree is made', () => {
  const ok = generic();
  assert.deepEqual(trail(ok, ['dispatch', 'T-1'], { PATH: `${fakeClaude().bin}:${process.env.PATH}`, HOME: trustingHome(ok) }).trail,
    ['task done', 'files skipped', 'worktree done', 'setup done', 'packet done', 'start done', 'record done', 'result ok']);
  const bad = generic();
  const bin = join(tempDir('no-claude-'), 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\necho "Not signed in" >&2\nexit 1\n');
  chmodSync(join(bin, 'claude'), 0o755);
  const r = trail(bad, ['dispatch', 'T-1'], { PATH: `${bin}:${process.env.PATH}`, HOME: trustingHome(bad) });
  assert.equal(r.code, 1);
  assert.deepEqual(r.trail, ['task done', 'files skipped', 'worktree done', 'setup done', 'packet done', 'start failed', 'result failed']);
  assert.match(r.notes.start!, /Claude Code didn't start the agent: Not signed in/);
});

/** A generic repo on a bare origin with T-1 in review on its own branch, its check waived and its review passed. */
function reviewed(): string {
  const raw = { ...GENERIC_CONFIG, github: { repo: 'acme/tool', account: 'jordan-kim' }, gates: { required: ['test'], commands: { test: 'true' } }, strayFiles: { required: false } };
  const origin = tempDir('origin-');
  run('git', ['init', '-q', '--bare', origin]);
  const dir = generic(raw);
  const base = gitIn(dir, 'branch', '--show-current').trim();
  gitIn(dir, 'remote', 'add', 'origin', origin);
  gitIn(dir, 'push', '-q', 'origin', base);
  gitIn(dir, 'checkout', '-q', '-b', 'task/T-1-write-the-changelog');
  writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n');
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'T-1: changelog');
  gitIn(dir, 'checkout', '-q', base);
  const config = parseConfig(raw).config as Config;
  const paths = repoPaths(dir, run);
  const now = () => new Date('2026-10-16T12:00:00Z');
  // The ledger is written when a change is recorded, so this one is.
  mutate(paths, now, (l, emit) => {
    const t = l.tasks[0]!;
    Object.assign(t, { state: 'review', environment: base, run: { branch: 'task/T-1-write-the-changelog', worktree: dir } });
    emit({ type: 'task.updated', task: t.id, actor: 'human', by: 'human:test', data: { state: 'review' } });
  });
  const sha = gitIn(dir, 'rev-parse', 'task/T-1-write-the-changelog').trim();
  waiveGates(paths, config, { sha, env: config.environments[0]!, gates: ['test'], reason: 'a test', by: 'human:t', now });
  mkdirSync(paths.reviews, { recursive: true });
  writeFileSync(reviewPath(paths, 'T-1', sha), JSON.stringify({ v: 1, task: 'T-1', sha, env: base, verdict: 'pass', summary: 'Adds a changelog.', sessionId: 's', at: now().toISOString(), durationMs: 1, costUsd: null, criteria: [], findings: [] }));
  return dir;
}

test('land reports its steps in order, and one whose push is refused fails at the push, with no pull request', () => {
  assert.deepEqual(trail(reviewed(), ['land', 'T-1'], withFakes()).trail,
    ['task done', 'github done', 'find done', 'push done', 'pr done', 'conflicts done', 'record done', 'update done', 'result ok']);
  const bad = reviewed();
  gitIn(bad, 'remote', 'set-url', 'origin', join(tempDir('gone-'), 'nowhere'));
  const r = trail(bad, ['land', 'T-1'], withFakes());
  assert.equal(r.code, 1);
  assert.deepEqual(r.trail, ['task done', 'github done', 'find done', 'push failed', 'result failed']);
  assert.match(r.notes.push!, /git push refused task\/T-1-write-the-changelog/);
});

test('analyze reports its steps in order, and one whose analyst answers junk fails at reading it, after the analyst ran', () => {
  assert.deepEqual(trail(generic(), ['analyze', 'T-1'], withFakes()).trail, ['task done', 'gather done', 'analyze done', 'read done', 'save done', 'result ok']);
  const r = trail(generic(), ['analyze', 'T-1'], withFakes({ analyst: true }));
  assert.notEqual(r.code, 0);
  assert.deepEqual(r.trail, ['task done', 'gather done', 'analyze done', 'read failed', 'result failed']);
});

test('setup baseline reports a step a branch, and one branch that can\'t be listed fails there and stops the rest', () => {
  assert.deepEqual(trail(sfRepo().dir, ['setup', 'baseline'], withFakes()).trail, ['fetch done', 'list-production done', 'list-uat done', 'list-dev done', 'write done', 'result ok']);
  const r = trail(sfRepo().dir, ['setup', 'baseline'], withFakes({ list: 'uat' }));
  assert.equal(r.code, 1);
  assert.deepEqual(r.trail, ['fetch done', 'list-production done', 'list-uat failed', 'result failed']);
});

test('setup branches reports a step a branch it makes, and one that can\'t be made fails while the next is still made', () => {
  const config = { ...GENERIC_CONFIG, environments: [{ name: 'main', default: true }, { name: 'staging', promotesTo: ['main'] }, { name: 'qa', promotesTo: ['staging'] }] };
  assert.deepEqual(trail(generic(config), ['setup', 'branches']).trail, ['fetch done', 'make-staging done', 'make-qa done', 'result ok']);
  // A branch named staging/x leaves no room for a branch named staging.
  const dir = generic(config);
  gitIn(dir, 'branch', 'staging/x');
  const r = trail(dir, ['setup', 'branches']);
  assert.equal(r.code, 1);
  assert.deepEqual(r.trail, ['fetch done', 'make-staging failed', 'make-qa done', 'result failed']);
});

test('setup lists reports a step a branch it compares, and lists that can\'t be written fail at the write', () => {
  assert.deepEqual(trail(sfRepo().dir, ['setup', 'lists']).trail, ['fetch done', 'compare-uat done', 'compare-dev done', 'write done', 'result ok']);
  // A file named manifest leaves no room for the folder the lists go in.
  const { dir } = sfRepo();
  writeFileSync(join(dir, 'manifest'), 'not a folder\n');
  const r = trail(dir, ['setup', 'lists']);
  assert.notEqual(r.code, 0);
  assert.deepEqual(r.trail, ['fetch done', 'compare-uat done', 'compare-dev done', 'write failed', 'result failed']);
});

test('setup readme reports its one step, and a README that can\'t be read fails it', () => {
  assert.deepEqual(trail(generic(), ['setup', 'readme']).trail, ['readme done', 'result ok']);
  const dir = generic();
  rmSync(join(dir, 'README.md'), { force: true });
  mkdirSync(join(dir, 'README.md'));
  assert.deepEqual(trail(dir, ['setup', 'readme']).trail, ['readme failed', 'result failed']);
});

test('a command that reports no steps writes no steps file, ACC_STEPS or not', () => {
  const dir = generic();
  const file = join(tempDir('steps-'), 'steps.jsonl');
  assert.equal(acc(dir, ['list'], undefined, { ACC_STEPS: file }).code, 0);
  assert.equal(existsSync(file), false);
});

test('openSteps opens this run\'s steps from ACC_STEPS and takes the variable out, so nothing acc starts writes to the file; without it, steps() reports nowhere', () => {
  const file = join(tempDir('steps-'), 'steps.jsonl');
  const env: NodeJS.ProcessEnv = { ACC_STEPS: file };
  const s = openSteps(env);
  assert.equal(env.ACC_STEPS, undefined, 'gone from the environment children get');
  assert.equal(steps(), s);
  s.start('a', 'A');
  assert.equal(readStepEvents(readFileSync(file, 'utf8')).length, 1);
  const none = openSteps({});
  assert.equal(none.on, false);
  assert.equal(steps(), none);
});
