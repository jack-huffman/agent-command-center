// acc's step channel at the CLI (T-65): each long command prints exactly what it printed before steps were
// reported, with ACC_STEPS or without, and only with it does acc write the steps file. The plain output of
// each command is pinned as it was before the channel, with its commits, folders and session ids made
// stable. acc runs from '../src/main.ts', through cli().

import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { fakeClaude, IGNORE, trustingHome } from '../../core/test/dispatch-support.ts';
import { run } from '../../core/src/exec.ts';
import { GENERIC_CONFIG, gitIn, makeRepo, SF_CONFIG, tempDir } from '../../core/test/support.ts';
import { cli } from './support.ts';

const acc = cli(fileURLToPath(new URL('../src/main.ts', import.meta.url)));

/** Stand-in sf, gh and claude on PATH: sf's deploy and its check pass, gh signs in and opens pull request 9. */
function fakes(): string {
  const bin = join(tempDir('fake-tools-'), 'bin');
  mkdirSync(bin);
  const tool = (name: string, script: string) => { writeFileSync(join(bin, name), `#!/bin/sh\n${script}`); chmodSync(join(bin, name), 0o755); };
  // sf lists a checkout's components into the file it's told, and deploys or checks with success.
  tool('sf', `if [ "$1 $2 $3" = "project generate manifest" ]; then
  while [ $# -gt 0 ]; do case "$1" in --output-dir) out="$2" ;; --name) name="$2" ;; esac; shift; done
  printf '<?xml version="1.0" encoding="UTF-8"?><Package xmlns="http://soap.sforce.com/2006/04/metadata"><types><members>A</members><name>ApexClass</name></types><version>62.0</version></Package>' > "$out/$name.xml"
  echo '{"status":0}'
  exit 0
fi
echo '{"status":0,"result":{"id":"0Af1","success":true,"numberComponentsDeployed":1,"numberComponentsTotal":1}}'
`);
  // claude answers an analysis as \`claude -p --output-format json\` does; anything else is fakeClaude's.
  tool('claude', `echo '${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 'sess-analyst', total_cost_usd: 0.5, structured_output: ANALYSIS })}'\n`);
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
